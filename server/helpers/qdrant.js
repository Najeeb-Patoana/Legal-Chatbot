const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
    url:    process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
    timeout: 60000, 
});

const COLLECTION = "us-legal-knowledge-v2";

// ── Initialization ────────────────────────────────────────────────────────────

async function initializeQdrant() {
    const collections = await qdrant.getCollections();
    if (!collections.collections.some((c) => c.name === COLLECTION)) {
        await qdrant.createCollection(COLLECTION, {
            vectors: { size: 384, distance: "Cosine" },
        });
        console.log(`[Qdrant] Created collection '${COLLECTION}'.`);
    } else {
        console.log(`[Qdrant] Collection '${COLLECTION}' already exists.`);
    }
}

// ── Store (WITH AUTO-RETRY) ───────────────────────────────────────────────────

/**
 * Upsert pre-built vector points into the collection.
 * Includes automatic retries for unstable global network connections.
 */
async function storeChunks(chunkPoints, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await qdrant.upsert(COLLECTION, { points: chunkPoints });
            return; // Success! Exit the function.
        } catch (error) {
            console.warn(`[Qdrant] Upload attempt ${attempt}/${maxRetries} failed: ${error.message}`);
            
            if (attempt === maxRetries) {
                // If we failed 5 times in a row, then throw the error
                throw new Error(`Failed to upload to Qdrant after ${maxRetries} attempts.`);
            }
            
            // Exponential backoff: Wait 2s, then 4s, then 6s before retrying
            const delay = attempt * 2000;
            console.log(`[Qdrant] Waiting ${delay/1000} seconds before retrying...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

async function searchGlobalLegalContext(queryVector, limit = 15) {
    const results = await qdrant.search(COLLECTION, {
        vector: queryVector,
        limit,
        with_payload: true,
    });
    return results.map((r) => ({ ...r.payload, _score: r.score }));
}

module.exports = { initializeQdrant, storeChunks, searchGlobalLegalContext };