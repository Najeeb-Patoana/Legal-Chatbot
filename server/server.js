require("dotenv").config();

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const rateLimit   = require("express-rate-limit");

// ── Helpers ───────────────────────────────────────────────────────────────────
const { ai, createEmbedding }              = require("./helpers/embedding");
const { initializeQdrant,
        searchGlobalLegalContext }          = require("./helpers/qdrant");

// ── Config ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ── Intent Detection ──────────────────────────────────────────────────────────

/**
 * Detect whether the user's message is casual small-talk / greeting.
 * If true, skip the Qdrant vector lookup entirely.
 */
const CASUAL_PATTERNS = [
    /^\s*(h(i|ello|ey|owdy)|good\s*(morning|afternoon|evening|night)|what'?\s*s?\s*up|yo|sup|greetings)/i,
    /^\s*(how\s+are\s+you|how'?\s*s?\s*it\s+going|how\s+do\s+you\s+do|what'?\s*s?\s*good)/i,
    /^\s*(thanks?|thank\s+you|thx|ty|bye|goodbye|see\s+you|take\s+care|have\s+a\s+(good|nice|great)\s+(day|one|evening))/i,
    /^\s*(nice\s+to\s+meet\s+you|pleased\s+to\s+meet|who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do)/i,
];

function isCasualChat(text) {
    const trimmed = text.trim();
    if (trimmed.length > 120) return false;  // longer messages are likely not greetings
    return CASUAL_PATTERNS.some((re) => re.test(trimmed));
}

// ── System Instruction (UPL Guardrails) ───────────────────────────────────────

const systemInstruction = `You are a professional US Legal Information Assistant. 

INTENT ROUTING DIRECTIONS:
- If the user greets you or initiates light conversational small talk, respond warmly, naturally, and concisely as a friendly legal assistant. Do not output intense legal disclaimers for basic greetings.
- If the user asks an actual legal question, instantly switch to an objective, authoritative informational tone and adhere strictly to the legal boundaries below.

CRITICAL LEGAL DEFENSES (PREVENT UNAUTHORIZED PRACTICE OF LAW - UPL):
1. You provide objective legal INFORMATION only, NOT tailored legal advice.
2. Never dictate what tactical actions a user "should", "must", or "needs to" execute for their personal circumstances.
3. If the user presents a specific personal legal crisis or asks you to predict a court outcome, you MUST explicitly prefix your response with this exact text: "I am an AI, not a licensed attorney, and cannot provide legal advice."
4. Always cite your matching context source citations inline when outputting legal details.
5. Absolute Factual Grounding: If the retrieved database context is empty or lacks clear evidence to support the user's legal question, state plainly that you cannot locate sufficient supporting documentation in your indexed datasets. Never make up laws, rules, punishments, or citations.`;

// ── Validation ────────────────────────────────────────────────────────────────

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
    if (status === 400 || status === 422)
        return err?.publicMessage ?? "Invalid request.";

    // Generic — never echo the raw message which might contain keys/URLs
    return "An error occurred while processing your request.";
}

function sendError(res, status, publicMessage) {
    return res.status(status).json({ success: false, message: publicMessage });
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

const askLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many questions. Please slow down." },
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "US Legal Knowledge Base API" });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/legal/ask
// Accepts: JSON { question: string }
// Returns: { success, answer }
//
// Dual-intent routing:
//   1. Casual chat → direct LLM response (no Qdrant lookup)
//   2. Legal query → embed → Qdrant search → contextual LLM response
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/legal/ask", askLimiter, async (req, res) => {
    try {
        const question = sanitize(req.body?.question, 1000);

        if (!question) {
            return sendError(res, 400, "Question cannot be empty.");
        }
        if (question.length < 2) {
            return sendError(res, 400, "Question is too short.");
        }

        console.log(`[ASK] New query (${question.length} chars)`);

        // ── Intent 1: Casual chat ─────────────────────────────────────────
        if (isCasualChat(question)) {
            console.log("[ASK] Detected casual chat — skipping Qdrant.");

            const chatResponse = await ai.models.generateContent({
                model:  "gemini-2.5-flash-lite",
                config: {
                    systemInstruction,
                    temperature: 0.7,  // slightly warmer for casual chat
                },
                contents: question,
            });

            return res.status(200).json({
                success: true,
                answer:  chatResponse.text,
            });
        }

        // ── Intent 2: Legal query ─────────────────────────────────────────
        console.log("[ASK] Legal query — embedding…");
        const queryVector = await createEmbedding(question);

        console.log("[ASK] Searching knowledge base…");
        const contextPayloads = await searchGlobalLegalContext(queryVector, 5);

        // Build structured context block
        let contextBlock = "";

        if (contextPayloads.length > 0) {
            contextBlock = contextPayloads
                .map((p, i) => {
                    const type     = p.documentType || "Unknown";
                    const citation = p.citation     || "No citation";
                    const text     = p.text         || "";
                    return `--- RETRIEVED ITEM ${i + 1} ---\n[Type]: ${type}\n[Citation]: ${citation}\n\n${text}`;
                })
                .join("\n\n");
        }

        const prompt = contextBlock
            ? `The following legal context was retrieved from an authoritative indexed database. Use ONLY this context to answer the user's question. Cite the [Citation] values inline.\n\n${contextBlock}\n\n---\nUser Question: ${question}`
            : `No matching legal context was found in the indexed database for this query.\n\nUser Question: ${question}`;

        console.log("[ASK] Generating answer…");
        const aiResponse = await ai.models.generateContent({
            model:  "gemini-2.5-flash-lite",
            config: {
                systemInstruction,
                temperature: 0.1,  // strict temperature for legal responses
            },
            contents: prompt,
        });

        console.log("[ASK] Done.");
        return res.status(200).json({
            success: true,
            answer:  aiResponse.text,
        });

    } catch (err) {
        console.error(`[ASK] error status=${err?.status ?? "unknown"}`);
        const status = err?.status === 429 ? 429 : 500;
        return sendError(res, status, safeErrorMessage(err));
    }
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Endpoint not found." });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches synchronous throws and unhandled promise rejections in middleware
app.use((err, _req, res, _next) => {
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
        console.warn("[Server] The collection will be created on first ingestion run.");
    }

    app.listen(PORT, () => {
        console.log(`US Legal Knowledge Base server  -->  http://localhost:${PORT}`);
        console.log("  POST /api/legal/ask  -- ask a legal question or chat");
        console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
    });
}

start();
