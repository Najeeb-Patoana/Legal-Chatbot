/**
 * CourtListener Judicial Opinion Ingestion Worker
 * ─────────────────────────────────────────────────
 * Standalone script: `node workers/fetch_court.js`
 *
 * Fetches recent judicial opinions from the CourtListener REST API,
 * chunks long texts, embeds each chunk, and upserts deterministic
 * points into the Qdrant legal knowledge collection.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { createEmbedding }                  = require("../helpers/embedding");
const { chunkText }                        = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const CL_BASE     = process.env.COURTLISTENER_API_URL || "https://www.courtlistener.com/api/rest/v3";
const BATCH_SIZE  = 10;
const EMBED_DELAY = 300;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── HTML stripping ────────────────────────────────────────────────────────────

/**
 * Safely strip HTML tags and decode basic entities.
 * Used when plain_text is unavailable and we fall back to html_lawbox.
 */
function stripHtml(html) {
    if (!html) return "";
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ── Fetch opinions ────────────────────────────────────────────────────────────

/**
 * Fetch a page of recent opinions from CourtListener.
 */
async function fetchOpinions(page = 1) {
    const url = `${CL_BASE}/opinions/?format=json&order_by=-date_created&page_size=20&page=${page}`;
    console.log(`[CourtListener] Fetching opinions page ${page}…`);

    const { data } = await axios.get(url, {
        timeout: 30000,
        headers: { "User-Agent": "LegalKnowledgeBot/1.0" },
    });

    return data.results || [];
}

// ── Process a single opinion ──────────────────────────────────────────────────

async function processOpinion(opinion) {
    const opinionId  = opinion.id;
    const dateFiled  = opinion.date_created?.split("T")[0] || "unknown";
    const caseName   = opinion.case_name || opinion.slug || `opinion-${opinionId}`;
    const citation   = opinion.citation?.length > 0
        ? opinion.citation.map((c) => c.cite || c).join("; ")
        : `CourtListener Opinion #${opinionId}`;

    // Get text: prefer plain_text, fall back to html_lawbox
    let text = "";
    if (opinion.plain_text && opinion.plain_text.trim().length > 100) {
        text = opinion.plain_text.trim();
    } else if (opinion.html_lawbox) {
        text = stripHtml(opinion.html_lawbox);
    } else if (opinion.html_columbia) {
        text = stripHtml(opinion.html_columbia);
    } else if (opinion.html) {
        text = stripHtml(opinion.html);
    } else if (opinion.html_with_citations) {
        text = stripHtml(opinion.html_with_citations);
    }

    if (text.length < 100) {
        console.log(`[CourtListener] Opinion ${opinionId} has insufficient text, skipping.`);
        return [];
    }

    // Chunk the opinion text
    const chunks = chunkText(text);
    console.log(`[CourtListener] Opinion ${opinionId} → ${chunks.length} chunk(s)`);

    const points = [];

    for (let i = 0; i < chunks.length; i++) {
        // Prepend structural metadata to the chunk text
        const enrichedText = `[Case: ${caseName} | ID: ${opinionId} | Filed: ${dateFiled}]\n\n${chunks[i]}`;

        try {
            const vector = await createEmbedding(enrichedText);

            points.push({
                id:      generateDeterministicUUID(`courtlistener-${opinionId}-chunk-${i}`),
                vector,
                payload: {
                    text:         enrichedText,
                    documentType: "Judicial Opinion (Case Law)",
                    citation,
                    caseId:       String(opinionId),
                    caseName,
                    dateFiled,
                    chunkIndex:   i,
                    source:       "CourtListener",
                },
            });

            await sleep(EMBED_DELAY);
        } catch (err) {
            console.warn(`[CourtListener] Embed error for opinion ${opinionId} chunk ${i}: ${err.message?.split("\n")[0]}`);
        }
    }

    return points;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════════");
    console.log("  CourtListener Judicial Opinion Ingestion");
    console.log("═══════════════════════════════════════════════\n");

    await initializeQdrant();

    const allPoints = [];

    // Fetch 2 pages of opinions (40 total, process up to 10)
    for (let page = 1; page <= 2; page++) {
        try {
            const opinions = await fetchOpinions(page);
            console.log(`[CourtListener] Page ${page}: ${opinions.length} opinion(s)`);

            for (const opinion of opinions.slice(0, 5)) { // 5 per page
                try {
                    const points = await processOpinion(opinion);
                    allPoints.push(...points);
                } catch (err) {
                    console.warn(`[CourtListener] Opinion error: ${err.message?.split("\n")[0]}`);
                }
            }

            await sleep(1000); // respect rate limits between pages
        } catch (err) {
            console.warn(`[CourtListener] Page ${page} error: ${err.message?.split("\n")[0]}`);
        }
    }

    // Batch upsert
    if (allPoints.length > 0) {
        console.log(`\n[CourtListener] Upserting ${allPoints.length} point(s) to Qdrant…`);
        for (let i = 0; i < allPoints.length; i += BATCH_SIZE) {
            const batch = allPoints.slice(i, i + BATCH_SIZE);
            await storeChunks(batch);
            console.log(`[CourtListener] Stored batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }
        console.log(`\n[CourtListener] ✓ Ingestion complete — ${allPoints.length} point(s) stored.`);
    } else {
        console.log("\n[CourtListener] No points to store.");
    }

    console.log("\n[CourtListener] Worker finished.\n");
}

main().catch((err) => {
    console.error("[CourtListener] Fatal error:", err.message?.split("\n")[0]);
    process.exit(1);
});
