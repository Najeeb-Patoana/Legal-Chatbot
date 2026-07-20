require("dotenv").config();

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const rateLimit   = require("express-rate-limit");
const multer      = require("multer");
const fs          = require("fs");
const pdfParse    = require("pdf-parse");
const { randomUUID } = require("crypto");

// ── Helpers ───────────────────────────────────────────────────────────────────
const { ai, createEmbedding }                              = require("./helpers/embedding");
const { chunkText }                                        = require("./helpers/chunking");
const { storeChunks, searchChunks, qdrant,
        COLLECTION, initializeQdrant }                     = require("./helpers/qdrant");


const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

const PORT = parseInt(process.env.PORT ?? "3000", 10);


// ── Validation ────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(str) {
    return typeof str === "string" && UUID_RE.test(str.trim());
}

function sanitize(str, maxLen = 2000) {
    if (typeof str !== "string") return "";
    return str.trim().slice(0, maxLen);
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/** Map any internal error to a safe, user-facing message.
 *  NEVER expose: API keys, stack traces, internal URLs, or library internals. */
function safeErrorMessage(err) {
    const status = err?.status ?? err?.response?.status ?? 500;

    if (status === 429)
        return "API rate limit reached. Please wait 30 seconds and try again.";
    if (status === 413)
        return "File is too large. Maximum size is 10 MB.";
    if (status === 400 || status === 422)
        return err?.publicMessage ?? "Invalid request.";

    // Generic — never echo the raw message which might contain keys/URLs
    return "An error occurred while processing your request.";
}

function sendError(res, status, publicMessage) {
    return res.status(status).json({ success: false, message: publicMessage });
}

function cleanupFile(path) {
    if (path) fs.unlink(path, () => {});
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

// Security headers (hide X-Powered-By, set CSP, etc.)
app.use(helmet());

// CORS — origins loaded from CORS_ORIGIN env var
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    optionsSuccessStatus: 200,
}));

// Body size limit — reject oversized JSON bodies early
app.use(express.json({ limit: "1mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Upload: slow path (embedding many chunks) — 10 uploads per 10 minutes
const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many uploads. Please wait before uploading again." },
    skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1", // no limit on localhost dev
});

// Ask: fast path — 60 questions per minute
const askLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many questions. Please slow down." },
});

// ── File upload ───────────────────────────────────────────────────────────────
const upload = multer({
    dest: "uploads/",
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf")) {
            cb(null, true);
        } else {
            cb(Object.assign(new Error("Only PDF files are accepted."), { publicMessage: "Only PDF files are accepted." }));
        }
    },
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "PDF Intelligence API" });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload
// Accepts: multipart/form-data  { pdf: File }
// Parses → chunks → embeds → stores in Qdrant
// Returns: { success, message, documentId, chunkCount }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/upload", uploadLimiter, upload.single("pdf"), async (req, res) => {
    const filePath = req.file?.path;

    try {
        if (!req.file) {
            return sendError(res, 400, "No PDF file provided.");
        }

        const documentId = randomUUID();
        console.log(`[UPLOAD] start documentId=${documentId}`);

        // Parse PDF
        console.log("[UPLOAD] parsing…");
        const buffer  = fs.readFileSync(filePath);
        const pdfData = await pdfParse(buffer);

        if (!pdfData.text?.trim()) {
            cleanupFile(filePath);
            return sendError(res, 422,
                "Could not extract text from this PDF. The file may be scanned or image-based.");
        }

        // Chunk
        const chunks = chunkText(pdfData.text);
        console.log(`[UPLOAD] ${chunks.length} chunks`);

        if (chunks.length === 0) {
            cleanupFile(filePath);
            return sendError(res, 422, "No usable text content found in the PDF.");
        }

        // Embed
        console.log("[UPLOAD] embedding…");
        const chunkEmbeddings = [];
        for (let i = 0; i < chunks.length; i++) {
            console.log(`[UPLOAD] chunk ${i + 1}/${chunks.length}`);
            const embedding = await createEmbedding(chunks[i]);
            chunkEmbeddings.push({ text: chunks[i], embedding });
        }

        // Store
        console.log("[UPLOAD] storing…");
        await storeChunks(documentId, chunkEmbeddings);
        console.log(`[UPLOAD] done documentId=${documentId}`);

        cleanupFile(filePath);

        return res.status(200).json({
            success:     true,
            message:     "Document uploaded and indexed successfully.",
            documentId,
            chunkCount:  chunks.length,
        });

    } catch (err) {
        // Log only a safe summary — never the full error
        console.error(`[UPLOAD] error status=${err?.status ?? "unknown"}`);
        cleanupFile(filePath);
        const status = err?.status === 429 ? 429 : err?.status === 413 ? 413 : 500;
        return sendError(res, status, safeErrorMessage(err));
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ask
// Accepts: JSON { documentId: string, question: string }
// Embeds question ONLY, searches Qdrant, returns AI answer
// Returns: { success, answer }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/ask", askLimiter, async (req, res) => {
    try {
        const documentId = sanitize(req.body?.documentId);
        const question   = sanitize(req.body?.question, 500);

        // Strict validation — reject anything that looks wrong
        if (!documentId)            return sendError(res, 400, "documentId is required.");
        if (!isValidUUID(documentId)) return sendError(res, 400, "Invalid documentId format.");
        if (!question)              return sendError(res, 400, "Question cannot be empty.");
        if (question.length < 3)   return sendError(res, 400, "Question is too short.");

        console.log(`[ASK] start documentId=${documentId}`);
        // Do NOT log the question — it's user content

        // Embed question
        console.log("[ASK] embedding question…");
        const questionVector = await createEmbedding(question);

        // Search
        console.log("[ASK] searching…");
        const topChunks = await searchChunks(documentId, questionVector, 5);

        if (!topChunks.length) {
            return sendError(res, 404,
                "No relevant content found. Make sure the PDF was uploaded successfully.");
        }

        // Generate answer
        const context = topChunks.join("\n\n---\n\n");
        const prompt  = `You are a helpful assistant.

Answer ONLY using the context provided below.
If the answer is not in the context, respond with:
"I could not find that information in the uploaded document."

Do not invent or assume any information.

Context:
${context}

Question:
${question}`;

        console.log("[ASK] generating answer…");
        const aiResponse = await ai.models.generateContent({
            model:    "gemini-2.5-flash-lite",
            contents: prompt,
        });

        console.log("[ASK] done");
        return res.status(200).json({ success: true, answer: aiResponse.text });

    } catch (err) {
        console.error(`[ASK] error status=${err?.status ?? "unknown"}`);
        const status = err?.status === 429 ? 429 : 500;
        return sendError(res, status, safeErrorMessage(err));
    }
});

// ── Utility routes ────────────────────────────────────────────────────────────

app.get("/test-qdrant", async (_req, res) => {
    try {
        const collections = await qdrant.getCollections();
        res.json({ success: true, count: collections.collections?.length ?? 0 });
    } catch {
        sendError(res, 500, "Could not reach Qdrant.");
    }
});

app.get("/create-collection", async (_req, res) => {
    try {
        await qdrant.createCollection(COLLECTION, {
            vectors: { size: 3072, distance: "Cosine" },
        });
        // Also create the payload index immediately
        const { ensurePayloadIndex } = require("./helpers/qdrant");
        await ensurePayloadIndex();
        res.json({ success: true, message: `Collection '${COLLECTION}' created.` });
    } catch (err) {
        sendError(res, 500, "Failed to create collection.");
    }
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Endpoint not found." });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches synchronous throws and unhandled promise rejections in middleware
app.use((err, _req, res, _next) => {
    // multer file-type rejection
    if (err?.publicMessage) {
        return sendError(res, 400, err.publicMessage);
    }
    // multer size limit
    if (err?.code === "LIMIT_FILE_SIZE") {
        return sendError(res, 413, "File is too large. Maximum size is 10 MB.");
    }
    console.error("[Server] unhandled middleware error");
    return sendError(res, 500, "An unexpected error occurred.");
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
    try {
        console.log("[Server] Connecting to Qdrant…");
        await initializeQdrant();
    } catch (err) {
        console.warn("[Server] Qdrant not ready at startup:", err.message?.split("\n")[0]);
        console.warn("[Server] Ensure the collection exists — visit GET /create-collection");
    }

    app.listen(PORT, () => {
        console.log(`PDF Intelligence server  -->  http://localhost:${PORT}`);
        console.log("  POST /upload  -- index a PDF");
        console.log("  POST /ask     -- answer a question");
        console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
    });
}

start();