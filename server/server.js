require("dotenv").config();

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const rateLimit   = require("express-rate-limit");

// ── Helpers ───────────────────────────────────────────────────────────────────
const { createEmbedding }              = require("./helpers/embedding");
const { generate }                     = require("./helpers/llmManager");
const { initializeQdrant,
        searchGlobalLegalContext }      = require("./helpers/qdrant");

function getClientIp(req) {
    let ip = req.ip || req.socket?.remoteAddress || "";

    // Strip IPv6-mapped IPv4 prefix (e.g., "::ffff:127.0.0.1" -> "127.0.0.1")
    if (ip.startsWith("::ffff:")) {
        ip = ip.replace("::ffff:", "");
    }

    // Standardize IPv6 local loopback to IPv4
    if (ip === "::1") {
        ip = "127.0.0.1";
    }

    return ip;
}

// ── DB + Routes ───────────────────────────────────────────────────────────────
const { initDB, pool } = require("./db");
const jwt          = require("jsonwebtoken");
const authRouter   = require("./routes/auth");
const chatRouter   = require("./routes/chat");

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

INTENT AND TONE:
- For general legal questions, provide an objective, authoritative, and educational summary of the law using ONLY the provided context.
- The UI already displays a permanent legal disclaimer, so DO NOT add your own legal disclaimers or state that you are an AI/not an attorney UNLESS the user is actively asking for advice on a specific personal situation, asking what action they should take, or asking you to predict a case outcome.

CRITICAL BOUNDARIES:
1. Provide objective legal INFORMATION only. NEVER provide tailored legal advice.
2. Never tell the user what they "should", "must", or "need to" do regarding their personal circumstances.
3. If the user asks for advice on a specific personal legal crisis or asks you to predict a specific court outcome, gracefully decline by stating that you cannot provide legal advice or strategy for specific situations.
4. Always cite your matching context source citations inline when outputting legal details.
5. Absolute Factual Grounding: If the retrieved database context lacks clear evidence to answer the user's question, state plainly that you cannot locate sufficient supporting documentation in the indexed dataset. Do NOT rely on your general training data to make up laws, rules, or citations.`;

// ── Validation ────────────────────────────────────────────────────────────────

function sanitize(str, maxLen = 2000) {
    if (typeof str !== "string") return "";
    return str.trim().slice(0, maxLen);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// (generateWithRetry removed in favor of llmManager fallback)

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

// Enable proxy trusting (essential for accurate IP detection)
app.set("trust proxy", 1);

// Security headers (hide X-Powered-By, set CSP, etc.)
app.use(helmet());

// CORS — origins loaded from CORS_ORIGIN env var
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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

// Auth + Chat routes
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/legal/ask
// Accepts: JSON { question: string }
// Returns: { success, answer }
//
// Dual-intent routing:
//   1. Casual chat → direct LLM response (no Qdrant lookup)
//   2. Legal query → embed → Qdrant search → contextual LLM response
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/legal/guest-status", async (req, res) => {
    try {
        const ip = getClientIp(req);
        const limitResult = await pool.query(
            "SELECT message_count FROM vl_guest_limits WHERE ip = $1", 
            [ip]
        );
        let count = 0;
        if (limitResult.rows.length > 0) {
            count = limitResult.rows[0].message_count;
        }
        res.status(200).json({ usage: count, limit: 4 });
    } catch (err) {
        console.error("[GUEST STATUS] error", err);
        res.status(500).json({ usage: 0, limit: 4 });
    }
});

app.post("/api/legal/ask", askLimiter, async (req, res) => {
    try {
        const question = sanitize(req.body?.question, 1000);

        if (!question) {
            return sendError(res, 400, "Question cannot be empty.");
        }
        // if (question.length < 2) {
        //     return sendError(res, 400, "Question is too short.");
        // }

        console.log(`[ASK] New query (${question.length} chars)`);

        // ── Guest Limit Enforcement ────────────────────────────────────────
        const authHeader = req.headers.authorization;
        let isAuthenticated = false;
        let currentGuestUsage = undefined;
        const GUEST_LIMIT = 4;

        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                jwt.verify(token, process.env.JWT_SECRET);
                isAuthenticated = true;
            } catch (err) {
                // Ignore invalid token, treat as guest
            }
        }

        if (!isAuthenticated) {
            // Extract normalized IP address
            const ip = getClientIp(req);
            console.log(`[GUEST LIMIT DEBUG] Client IP: "${ip}"`);
            const limitResult = await pool.query(
                "SELECT message_count FROM vl_guest_limits WHERE ip = $1", 
                [ip]
            );
            
            let count = 0;
            if (limitResult.rows.length > 0) {
                count = limitResult.rows[0].message_count;
            }
            
            if (count >= GUEST_LIMIT) {
                return sendError(res, 403, "Free limit reached. Please sign in to continue.");
            }
            
            await pool.query(
                `INSERT INTO vl_guest_limits (ip, message_count) 
                 VALUES ($1, 1) 
                 ON CONFLICT (ip) DO UPDATE SET message_count = vl_guest_limits.message_count + 1, last_request = NOW()`,
                [ip]
            );
            currentGuestUsage = count + 1;
        }

        // ── Intent 1: Casual chat ─────────────────────────────────────────
        if (isCasualChat(question)) {
            console.log("[ASK] Detected casual chat — skipping Qdrant.");

            const chatResponse = await generate(question, systemInstruction, 0.7);

            return res.status(200).json({
                success: true,
                answer:  chatResponse.answer,
                guestUsage: currentGuestUsage,
                guestLimit: GUEST_LIMIT
            });
        }

        // ── Intent 2: Legal query ─────────────────────────────────────────
        console.log("[ASK] Legal query — embedding…");
        const queryVector = await createEmbedding(question);

        console.log("[ASK] Searching knowledge base…");
        const contextPayloads = await searchGlobalLegalContext(queryVector, 15);

        // Build structured context block
        let contextBlock = "";

        if (contextPayloads.length > 0) {
            console.log(`[ASK] Retrieved ${contextPayloads.length} items. Scores: ${contextPayloads.map(p => Number(p._score).toFixed(3)).join(', ')}`);
            
            contextBlock = contextPayloads
                .map((p, i) => {
                    const type     = p.documentType || "Unknown";
                    const citation = p.citation     || "No citation";
                    const text     = p.text         || "";
                    const score    = p._score ? ` (Score: ${Number(p._score).toFixed(3)})` : "";
                    return `--- RETRIEVED ITEM ${i + 1}${score} ---\n[Type]: ${type}\n[Citation]: ${citation}\n\n${text}`;
                })
                .join("\n\n");
        }

        const prompt = contextBlock
            ? `The following legal context was retrieved from an authoritative indexed database. Use ONLY this context to answer the user's question. Cite the [Citation] values inline.\n\n${contextBlock}\n\n---\nUser Question: ${question}`
            : `No matching legal context was found in the indexed database for this query.\n\nUser Question: ${question}`;

        console.log("[ASK] Generating answer…");
        const aiResponse = await generate(prompt, systemInstruction, 0.1);

        console.log("[ASK] Done.");
        return res.status(200).json({
            success: true,
            answer:  aiResponse.answer,
            guestUsage: currentGuestUsage,
            guestLimit: GUEST_LIMIT
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
    // Initialize PostgreSQL schema
    try {
        await initDB();
    } catch (err) {
        console.error("[Server] DB init failed:", err.message);
        process.exit(1);
    }

    // Initialize Qdrant
    try {
        console.log("[Server] Connecting to Qdrant…");
        await initializeQdrant();
    } catch (err) {
        console.warn("[Server] Qdrant not ready at startup:", err.message?.split("\n")[0]);
        console.warn("[Server] The collection will be created on first ingestion run.");
    }

    app.listen(PORT, () => {
        console.log(`US Legal Knowledge Base server  -->  http://localhost:${PORT}`);
        console.log("  POST /api/legal/ask       -- ask a legal question or chat");
        console.log("  POST /api/auth/register   -- create account");
        console.log("  POST /api/auth/login      -- login");
        console.log("  POST /api/auth/google     -- Google OAuth");
        console.log("  GET  /api/chat/sessions   -- list chat history");
        console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
    });
}

start();
