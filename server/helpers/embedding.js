const { pipeline } = require('@huggingface/transformers');

let extractorPromise = null;

async function getExtractor() {
    if (!extractorPromise) {
        console.log("[Embedding] Loading local model into memory...");
        // 'all-MiniLM-L6-v2' is the gold standard for fast, local semantic search (384 dimensions)
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            dtype: 'q8' // 8-bit quantization: smaller RAM footprint, great accuracy
        });
    }
    return extractorPromise;
}

/**
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} embedding vector (384 dimensions)
 */
async function createEmbedding(text) {
    if (!text || typeof text !== "string" || !text.trim()) {
        throw Object.assign(new Error("Empty text passed to createEmbedding"), { status: 400 });
    }

    const extractor = await getExtractor();

    // pooling: 'mean' averages token vectors into a sentence vector
    // normalize: true is required for Cosine similarity in Qdrant
    const output = await extractor(text.trim(), { pooling: 'mean', normalize: true });

    // Convert the Float32Array to a standard JavaScript array
    return Array.from(output.data);
}

module.exports = { createEmbedding };