const { OpenAI } = require("openai");

// Initialize dynamically when called so missing keys don't crash startup if not using this provider as primary
let openaiClient = null;

function getClient() {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate text using OpenAI with internal retries.
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {number} temperature
 * @returns {Promise<{ success: boolean, provider: string, model: string, answer: string }>}
 */
async function generate(prompt, systemInstruction, temperature = 0.1) {
    const maxRetries = 2;
    const model = "gpt-4o-mini";
    const client = getClient();
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await client.chat.completions.create({
                model,
                temperature,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: prompt }
                ],
            });
            
            return {
                success: true,
                provider: "OpenAI",
                model,
                answer: response.choices[0].message.content
            };
        } catch (err) {
            const status = err?.status ?? err?.response?.status ?? 500;
            
            const isRecoverable = status === 429 || status >= 500;
            
            if (isRecoverable && attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
                console.log(`[LLM] OpenAI Rate limit/Server error (${status}) — retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`);
                await sleep(delay);
            } else {
                const safeErr = new Error(`OpenAI API failed with status ${status}`);
                safeErr.status = status;
                safeErr.isRecoverable = isRecoverable;
                safeErr.originalError = err;
                throw safeErr;
            }
        }
    }
}

module.exports = { generate };
