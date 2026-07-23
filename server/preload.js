const { pipeline, env } = require('@huggingface/transformers');

// This tells transformers to be patient with local file systems
env.allowLocalModels = true;

async function run() {
    console.log("Downloading the AI model. Please wait a minute...");
    try {
        await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
        console.log("Model downloaded successfully! You can now run your workers safely.");
    } catch (e) {
        console.error("Failed:", e.message);
    }
}
run();