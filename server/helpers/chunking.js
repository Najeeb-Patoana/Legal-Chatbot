/**
 
 *
 * @param {string} text       Raw text extracted from pdf-parse
 * @param {number} targetWords Target words per chunk (default 600)
 * @param {number} minWords    Minimum words to keep a chunk (default 25)
 * @returns {string[]}
 */
function chunkText(text, targetWords = 600, minWords = 25) {
    // ── 1. Split into paragraphs ──────────────────────────────────────────────
    const paragraphs = text
        .split(/\n{2,}/)            // blank-line boundaries
        .map((p) => p.replace(/\n/g, " ").trim())  // flatten internal newlines
        .filter((p) => p.length > 0);

    const chunks = [];
    let buffer = "";
    let bufferWords = 0;

    const flush = () => {
        const trimmed = buffer.trim();
        if (trimmed.split(/\s+/).length >= minWords) {
            chunks.push(trimmed);
        }
        buffer = "";
        bufferWords = 0;
    };

    for (const para of paragraphs) {
        const words = para.split(/\s+/).length;

        // If this single paragraph is already very large, split by sentence
        if (words > targetWords * 1.5) {
            // Flush whatever we have first
            if (buffer) flush();

            // Sentence-level split
            const sentences = para.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [para];
            let sentBuf = "";
            let sentWords = 0;

            for (const sent of sentences) {
                const sw = sent.split(/\s+/).length;
                if (sentWords + sw > targetWords && sentBuf) {
                    const t = sentBuf.trim();
                    if (t.split(/\s+/).length >= minWords) chunks.push(t);
                    sentBuf = sent;
                    sentWords = sw;
                } else {
                    sentBuf += " " + sent;
                    sentWords += sw;
                }
            }
            if (sentBuf.trim().split(/\s+/).length >= minWords) {
                chunks.push(sentBuf.trim());
            }
            continue;
        }

        // Would adding this paragraph overflow the target?
        if (bufferWords + words > targetWords && buffer) {
            flush();
        }

        buffer += (buffer ? "\n\n" : "") + para;
        bufferWords += words;
    }

    flush(); // flush remaining content

    return chunks;
}

module.exports = { chunkText };
