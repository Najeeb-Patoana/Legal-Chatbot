const { QdrantClient } = require("@qdrant/js-client-rest");
const { randomUUID } = require("crypto");

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

const COLLECTION = "pdf-docs";

// ── Payload index ─────────────────────────────────────────────────────────────

/**
 * Create (or confirm) a keyword payload index on the `documentId` field.
 * Qdrant Cloud REQUIRES this index before the field can be used in a filter.
 * Safe to call multiple times — "already exists" errors are silently ignored.
 */
async function ensurePayloadIndex() {
    try {
        await qdrant.createPayloadIndex(COLLECTION, {
            field_name: "documentId",
            field_schema: "keyword",
        });
    } catch (err) {
        // 400 / 409 = index already exists → fine
        const status = err?.status ?? err?.response?.status ?? 0;
        const msg = (err?.message ?? "").toLowerCase();
        const isExpected = status === 409 || status === 400 ||
            msg.includes("already") || msg.includes("conflict") ||
            msg.includes("exists");
        if (!isExpected) {
            // Log only the first line — never the full error that may include URLs / keys
            console.warn("[Qdrant] Payload index warning:", msg.split("\n")[0]);
        }
    }
}

/**
 * Called once at server startup.
 * Verifies the collection is reachable and ensures the payload index is ready.
 */
async function initializeQdrant() {
    // Verify the collection exists
    const info = await qdrant.getCollection(COLLECTION);
    if (!info) throw new Error(`Collection '${COLLECTION}' not found. Run GET /create-collection first.`);

    // Ensure the payload index is in place before any request arrives
    await ensurePayloadIndex();
    console.log(`[Qdrant] Collection '${COLLECTION}' ready with payload index.`);
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * Store chunk embeddings for a document.
 * Payload: { documentId, chunkIndex, text }
 *
 * The payload index is confirmed BEFORE the upsert so the filter works immediately.
 */
async function storeChunks(documentId, chunkEmbeddings) {
    // Ensure index is present before writing — belt-and-suspenders
    await ensurePayloadIndex();

    const points = chunkEmbeddings.map((item, index) => ({
        id: randomUUID(),
        vector: item.embedding,
        payload: {
            documentId,
            chunkIndex: index,
            text: item.text,
        },
    }));

    await qdrant.upsert(COLLECTION, { points });
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Find the top-k most relevant chunks for a question, scoped to one document.
 * Uses a Qdrant payload filter — chunks from other PDFs are never returned.
 */
async function searchChunks(documentId, queryVector, limit = 5) {
    const results = await qdrant.search(COLLECTION, {
        vector: queryVector,
        limit,
        with_payload: true,
        filter: {
            must: [
                {
                    key: "documentId",
                    match: { value: documentId },
                },
            ],
        },
    });

    return results.map((r) => r.payload.text);
}

module.exports = { qdrant, COLLECTION, storeChunks, searchChunks, initializeQdrant };
