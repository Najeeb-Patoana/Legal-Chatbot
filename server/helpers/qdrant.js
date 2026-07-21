const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
    url:    process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

// Changed to -v2 so it creates a fresh database with the new 384 dimensions
const COLLECTION = "us-legal-knowledge-v2";

async function initializeQdrant() {
    const collections = await qdrant.getCollections();
    if (!collections.collections.some((c) => c.name === COLLECTION)) {
        await qdrant.createCollection(COLLECTION, {
            // CRITICAL: Updated to 384 to match the local MiniLM model
            vectors: { size: 384, distance: "Cosine" },
        });
        console.log(`[Qdrant] Created collection '${COLLECTION}'.`);
    } else {
        console.log(`[Qdrant] Collection '${COLLECTION}' already exists.`);
    }
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**

 * @param {Array<{id: string, vector: number[], payload: object}>} chunkPoints
 */
async function storeChunks(chunkPoints) {
    await qdrant.upsert(COLLECTION, { points: chunkPoints });
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 *
 * @param {number[]} queryVector  Embedding of the user's question
 * @param {number}   [limit=15]   Max results to return
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