const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**

 * @param {string} text
 * @param {number} [maxRetries=4]
 * @returns {Promise<number[]>} embedding vector
 */
async function createEmbedding(text, maxRetries = 4) {
    if (!text || typeof text !== "string" || !text.trim()) {
        throw Object.assign(new Error("Empty text passed to createEmbedding"), { status: 400 });
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await ai.models.embedContent({
                model:    "gemini-embedding-2",
                contents: text.trim(),
            });
            await sleep(250); // throttle between consecutive calls
            return response.embeddings[0].values;
        } catch (err) {
            const status = err?.status ?? err?.response?.status ?? 500;

            if (status === 429 && attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s
                console.log(`[Embedding] Rate limit — retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`);
                await sleep(delay);
            } else {
                // Re-throw with only the status attached — never the raw message
                const safe = new Error("Embedding request failed.");
                safe.status = status;
                throw safe;
            }
        }
    }
}

module.exports = { ai, createEmbedding };
