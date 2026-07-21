/**
 * US Constitution & Amendments Ingestion Worker
 * ─────────────────────────────────────────────
 * Standalone script: `node workers/fetch_constitution.js`
 *
 * Downloads the US Constitution, Bill of Rights, and Amendments
 * using the GovInfo CDOC-110hdoc50 package.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { createEmbedding }                  = require("../helpers/embedding");
const { chunkText }                        = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

const GOVINFO_BASE  = "https://api.govinfo.gov";
const API_KEY       = process.env.GOVINFO_API_KEY;
const BATCH_SIZE    = 15;
const EMBED_DELAY   = 350;
const CONSTITUTION_PACKAGE_ID = "CDOC-110hdoc50";

if (!API_KEY) {
    console.error("[Constitution] GOVINFO_API_KEY is not set in .env — aborting.");
    process.exit(1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
        .replace(/[ \t]+/g, " ")
        .trim();
}

async function fetchGranules(packageId) {
    const granules = [];
    let url = `${GOVINFO_BASE}/packages/${packageId}/granules?offsetMark=*&pageSize=100&api_key=${API_KEY}`;

    console.log(`[Constitution] Fetching constitution granules…`);

    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 30000 });
            const pageGranules = data.granules || [];
            
            // For the Constitution document, we want the actual content, not frontmatter
            granules.push(...pageGranules.filter(g => g.granuleClass !== "FRONTMATTER" && g.granuleClass !== "TOC"));

            if (data.nextPage) {
                url = data.nextPage + `&api_key=${API_KEY}`;
                await sleep(250);
            } else {
                url = null;
            }
        } catch (err) {
            console.warn(`[Constitution] Error fetching granules: ${err.message}`);
            break;
        }
    }
    return granules;
}

async function processGranule(granule) {
    const granuleId = granule.granuleId;
    const htmUrl = `${GOVINFO_BASE}/packages/${CONSTITUTION_PACKAGE_ID}/granules/${granuleId}/htm?api_key=${API_KEY}`;

    try {
        const { data: html } = await axios.get(htmUrl, { timeout: 30000, responseType: "text" });
        const cleanText = stripHtml(html);

        if (cleanText.length < 50) return null;

        return {
            title: granule.title || "US Constitution Section",
            text: cleanText,
            granuleId
        };
    } catch (err) {
        console.warn(`[Constitution] Download error for ${granuleId}: ${err.message}`);
        return null;
    }
}

async function embedAndStore(sections) {
    if (sections.length === 0) return;

    let allChunks = [];
    for (const sec of sections) {
        const textToChunk = sec.title ? `${sec.title}\n\n${sec.text}` : sec.text;
        const chunks = chunkText(textToChunk);
        
        for (let i = 0; i < chunks.length; i++) {
            allChunks.push({
                section: sec,
                text: chunks[i],
                chunkIndex: i,
                totalChunks: chunks.length
            });
        }
    }

    console.log(`[Constitution] Total constitutional chunks to embed: ${allChunks.length}`);

    let batch = [];
    let stored = 0;

    for (let i = 0; i < allChunks.length; i++) {
        const item = allChunks[i];
        const sec = item.section;

        try {
            const vector = await createEmbedding(item.text);

            batch.push({
                id: generateDeterministicUUID(`constitution-${sec.granuleId}-chunk-${item.chunkIndex}`),
                vector,
                payload: {
                    text:         item.text,
                    documentType: "US Constitution",
                    heading:      sec.title,
                    packageId:    CONSTITUTION_PACKAGE_ID,
                    granuleId:    sec.granuleId,
                    chunkIndex:   item.chunkIndex,
                    totalChunks:  item.totalChunks,
                    source:       "GovInfo",
                },
            });

            if (batch.length >= BATCH_SIZE) {
                await storeChunks(batch);
                stored += batch.length;
                console.log(`[Constitution] Stored batch (${stored} chunks total).`);
                batch = [];
            }

            await sleep(EMBED_DELAY);
        } catch (err) {
            console.warn(`[Constitution] Embed error for chunk ${i}: ${err.message}`);
        }
    }

    if (batch.length > 0) {
        await storeChunks(batch);
        stored += batch.length;
    }

    console.log(`\n[Constitution] ✓ Ingestion complete — ${stored} constitutional chunks stored.`);
}

async function main() {
    console.log("═══════════════════════════════════════════════");
    console.log("  US Constitution Ingestion Worker");
    console.log("═══════════════════════════════════════════════\n");

    await initializeQdrant();

    const granules = await fetchGranules(CONSTITUTION_PACKAGE_ID);
    if (granules.length === 0) {
        console.log("[Constitution] No granules found for Constitution package.");
        return;
    }

    const sections = [];
    console.log(`[Constitution] Downloading ${granules.length} granule(s)…`);
    
    for (const granule of granules) {
        const section = await processGranule(granule);
        if (section) sections.push(section);
        await sleep(150);
    }

    await embedAndStore(sections);
}

main().catch((err) => {
    console.error("[Constitution] Fatal error:", err.message);
    process.exit(1);
});
