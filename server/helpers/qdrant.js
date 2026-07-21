const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
    url:    process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

const COLLECTION = "us-legal-knowledge";

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Ensure the legal knowledge collection exists.
 * Called once at server startup and by each worker before ingestion.
 * Safe to call multiple times — skips creation if the collection is already present.
 */
async function initializeQdrant() {
    const collections = await qdrant.getCollections();
    if (!collections.collections.some((c) => c.name === COLLECTION)) {
        await qdrant.createCollection(COLLECTION, {
            vectors: { size: 3072, distance: "Cosine" },
        });
        console.log(`[Qdrant] Created collection '${COLLECTION}'.`);
    } else {
        console.log(`[Qdrant] Collection '${COLLECTION}' already exists.`);
    }
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * Upsert pre-built vector points into the collection.
 * Each element in `chunkPoints` must have: { id, vector, payload }.
 * Workers are responsible for building their own payloads with
 * documentType, citation, text, and any extra metadata fields.
 *
 * @param {Array<{id: string, vector: number[], payload: object}>} chunkPoints
 */
async function storeChunks(chunkPoints) {
    await qdrant.upsert(COLLECTION, { points: chunkPoints });
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Global (unfiltered) semantic search across the entire legal knowledge base.
 * Returns the top-k payload objects — the caller never sees raw scores.
 *
 * @param {number[]} queryVector  Embedding of the user's question
 * @param {number}   [limit=5]    Max results to return
 * @returns {Promise<object[]>}   Array of payload objects
 */
async function searchGlobalLegalContext(queryVector, limit = 15) {
    const results = await qdrant.search(COLLECTION, {
        vector: queryVector,
        limit,
        with_payload: true,
    });
    return results.map((r) => ({ ...r.payload, _score: r.score }));
}

module.exports = { initializeQdrant, storeChunks, searchGlobalLegalContext };
