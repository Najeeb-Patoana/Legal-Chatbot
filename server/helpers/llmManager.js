const gemini = require("./gemini");
const openai = require("./openai");
const groq = require("./groq");

/**
 * Generate text trying multiple providers in sequence (Gemini -> OpenAI -> Groq).
 * Will only fallback if the error is recoverable (e.g. rate limit, server error).
 * @param {string} prompt
 * @param {string} systemInstruction
 * @param {number} temperature
 * @returns {Promise<{ success: boolean, provider: string, model: string, answer: string }>}
 */
async function generate(prompt, systemInstruction, temperature = 0.1) {
    const providers = [
        { name: "Gemini", handler: gemini },
        { name: "OpenAI", handler: openai },
        { name: "Groq", handler: groq }
    ];

    let lastError = null;

    for (const provider of providers) {
        console.log(`[LLM] Using ${provider.name}`);
        try {
            const response = await provider.handler.generate(prompt, systemInstruction, temperature);
            console.log(`[LLM] ${provider.name} succeeded`);
            return response;
        } catch (error) {
            lastError = error;
            const status = error.status || "unknown";
            
            console.log(`[LLM] ${provider.name} failed (${status})`);
            
            // If the error is an unrecoverable error (e.g. invalid prompt, auth), we should not fallback
            // but instead fail immediately as requested by the requirements
            if (error.isRecoverable === false) {
                console.log(`[LLM] ${provider.name} error is not recoverable, aborting fallback.`);
                throw error;
            }
            
            if (provider.name !== providers[providers.length - 1].name) {
                console.log(`[LLM] Falling back to next provider...`);
            }
        }
    }

    console.error(`[LLM] All providers failed. Last error status: ${lastError?.status}`);
    throw lastError;
}

module.exports = { generate };
