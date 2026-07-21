/**
 * CourtListener Judicial Opinion Ingestion Worker
 * ─────────────────────────────────────────────────
 * Standalone script: `node workers/fetch_court.js`
 *
 * Fetches recent judicial opinions from the CourtListener REST API,
 * chunks long texts, embeds each chunk LOCALLY (no API limits), 
 * and upserts deterministic points into the Qdrant legal knowledge collection.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { createEmbedding }                  = require("../helpers/embedding");
const { chunkText }                        = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const CL_BASE     = process.env.COURTLISTENER_API_URL || "https://www.courtlistener.com/api/rest/v3";
const CL_TOKEN    = process.env.COURTLISTENER_TOKEN;
const BATCH_SIZE  = 100; // Increased to 100: Qdrant handles large batches easily
const MAX_PAGES   = parseInt(process.env.COURTLISTENER_MAX_PAGES, 10) || 50;

if (!CL_TOKEN) {
    console.error("════════════════════════════════════════════════════════════");
    console.error("  ERROR: COURTLISTENER_TOKEN is not set in .env");
    process.exit(1);
}

// Helper to avoid rate-limiting from the CourtListener API (NOT for embeddings)
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const clApi = axios.create({
    baseURL: CL_BASE,
    timeout: 30000,
    headers: {
        "Authorization": `Token ${CL_TOKEN}`,
        "User-Agent":    "LegalKnowledgeBot/1.0",
    },
});

function stripHtml(html) {
    if (!html) return "";
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
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

async function fetchOpinions(page = 1) {
    const url = `/opinions/?format=json&order_by=-date_created&page_size=20&page=${page}`;
    console.log(`[CourtListener] Downloading opinions page ${page}/${MAX_PAGES}…`);
    const { data } = await clApi.get(url);
    return data.results || [];
}

async function processOpinion(opinion) {
    const opinionId  = opinion.id;
    const dateFiled  = opinion.date_created?.split("T")[0] || "unknown";
    const caseName   = opinion.case_name || opinion.slug || `opinion-${opinionId}`;

    let citation = `CourtListener Opinion #${opinionId}`;
    if (opinion.citation && Array.isArray(opinion.citation) && opinion.citation.length > 0) {
        citation = opinion.citation.map((c) => (typeof c === "string" ? c : c.cite || c)).join("; ");
    } else if (opinion.cluster_id) {
        citation = `Cluster #${opinion.cluster_id} — ${caseName}`;
    }

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
        return [];
    }

    const chunks = chunkText(text);
    const points = [];

    for (let i = 0; i < chunks.length; i++) {
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
                    court:        opinion.court || "Unknown Court",
                    docketNumber: opinion.docket_number || "Unknown",
                    opinionType:  opinion.type || "Unknown",
                    chunkIndex:   i,
                    totalChunks:  chunks.length,
                    source:       "CourtListener",
                },
            });
            // NO SLEEP NEEDED HERE: Local embedding is instant and has no rate limits!
        } catch (err) {
            console.warn(`[CourtListener] Embed error for opinion ${opinionId} chunk ${i}: ${err.message}`);
        }
    }
    return points;
}

async function main() {
    console.log("═══════════════════════════════════════════════");
    console.log("  CourtListener Judicial Opinion Ingestion");
    console.log("═══════════════════════════════════════════════\n");

    await initializeQdrant();

    let totalStored = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
        try {
            const opinions = await fetchOpinions(page);
            if (opinions.length === 0) break;
            
            console.log(`[CourtListener] Processing ${opinions.length} opinion(s) locally...`);
            let pagePoints = [];

            for (const opinion of opinions) {
                try {
                    const points = await processOpinion(opinion);
                    pagePoints.push(...points);
                } catch (err) {
                    console.warn(`[CourtListener] Opinion error: ${err.message}`);
                }
            }

            if (pagePoints.length > 0) {
                for (let i = 0; i < pagePoints.length; i += BATCH_SIZE) {
                    const batch = pagePoints.slice(i, i + BATCH_SIZE);
                    await storeChunks(batch);
                    totalStored += batch.length;
                    console.log(`[CourtListener] Stored batch (Total Qdrant points: ${totalStored})`);
                }
            }
            
            // Brief sleep between API page requests to respect CourtListener's servers
            await sleep(1000); 
        } catch (err) {
            console.warn(`[CourtListener] Page ${page} error: ${err.message}`);
            break;
        }
    }

    console.log(`\n[CourtListener] ✓ Ingestion complete — ${totalStored} chunk(s) stored.\n`);
}

main().catch((err) => {
    console.error("[CourtListener] Fatal error:", err.message);
    process.exit(1);
});