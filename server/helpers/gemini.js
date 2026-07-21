const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate text using Gemini with internal retries.
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {number} temperature
 * @returns {Promise<{ success: boolean, provider: string, model: string, answer: string }>}
 */
async function generate(prompt, systemInstruction, temperature = 0.1) {
    const maxRetries = 3;
    const model = "gemini-2.5-flash-lite";
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model,
                config: {
                    systemInstruction,
                    temperature,
                },
                contents: prompt,
            });
            
            return {
                success: true,
                provider: "Gemini",
                model,
                answer: response.text
            };
        } catch (err) {
            const status = err?.status ?? err?.response?.status ?? 500;
            
            // Recoverable errors: 429 (Rate Limit), Timeout, 500, 502, 503, 504
            const isRecoverable = status === 429 || status >= 500;
            
            if (isRecoverable && attempt < maxRetries) {
                // Exponential backoff for retries
                const delays = [5000, 10000, 20000];
                const delay = delays[attempt] || 20000;
                
                console.log(`[LLM] Gemini Rate limit/Server error (${status}) — retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`);
                await sleep(delay);
            } else {
                const safeErr = new Error(`Gemini API failed with status ${status}`);
                safeErr.status = status;
                safeErr.isRecoverable = isRecoverable;
                safeErr.originalError = err;
                throw safeErr;
            }
        }
    }
}

module.exports = { generate };
