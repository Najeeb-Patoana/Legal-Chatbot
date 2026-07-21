const Groq = require("groq-sdk");

let groqClient = null;

function getClient() {
    if (!groqClient) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate text using Groq with internal retries.
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {number} temperature
 * @returns {Promise<{ success: boolean, provider: string, model: string, answer: string }>}
 */
async function generate(prompt, systemInstruction, temperature = 0.1) {
    const maxRetries = 2;
    const model = "llama-3.3-70b-versatile";
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
                provider: "Groq",
                model,
                answer: response.choices[0].message.content
            };
        } catch (err) {
            const status = err?.status ?? err?.response?.status ?? 500;
            
            const isRecoverable = status === 429 || status >= 500;
            
            if (isRecoverable && attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
                console.log(`[LLM] Groq Rate limit/Server error (${status}) — retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`);
                await sleep(delay);
            } else {
                const safeErr = new Error(`Groq API failed with status ${status}`);
                safeErr.status = status;
                safeErr.isRecoverable = isRecoverable;
                safeErr.originalError = err;
                throw safeErr;
            }
        }
    }
}

module.exports = { generate };
