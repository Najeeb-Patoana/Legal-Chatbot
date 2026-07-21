/**
 * GovInfo USCODE Ingestion Worker
 * ────────────────────────────────
 * Standalone script: `node workers/fetch_govinfo.js`
 *
 * Pulls US Code section granules from the GovInfo API, downloads their
 * HTML content, cleans the text, chunks it, embeds it LOCALLY (no API limits), 
 * and upserts deterministic points into Qdrant.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { createEmbedding }                  = require("../helpers/embedding");
const { chunkText }                        = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const GOVINFO_BASE  = "https://api.govinfo.gov";
const API_KEY       = process.env.GOVINFO_API_KEY;
const BATCH_SIZE    = 100; // Increased to 100: Qdrant handles large batches easily

if (!API_KEY) {
    console.error("════════════════════════════════════════════════════════════");
    console.error("  ERROR: GOVINFO_API_KEY is not set in .env");
    process.exit(1);
}

// Helper to avoid rate-limiting from the GovInfo web API (NOT for embeddings)
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── HTML stripping ────────────────────────────────────────────────────────────

function stripHtml(html) {
    if (!html) return "";
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&sect;/g, "§")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function extractCitation(html, granuleId) {
    const expciteMatch = html.match(/<!--\s*expcite:(.+?)-->/);
    if (expciteMatch) {
        return expciteMatch[1].replace(/!@!/g, " > ").trim();
    }
    const itempathMatch = html.match(/<!--\s*itempath:(.+?)-->/);
    if (itempathMatch) {
        return itempathMatch[1].trim();
    }
    return granuleId;
}

// ── Fetch package list ────────────────────────────────────────────────────────

async function fetchUSCodePackages() {
    let packages = [];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // Get last 1 year of USCODE packages
    const startStr = startDate.toISOString().split("T")[0] + "T00:00:00Z";

    let url = `${GOVINFO_BASE}/collections/USCODE/${startStr}?pageSize=100&offsetMark=*&api_key=${API_KEY}`;
    console.log("[GovInfo] Fetching USCODE package list…");

    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 30000 });
            if (data.packages) {
                packages.push(...data.packages);
            }
            if (data.nextPage) {
                url = data.nextPage + `&api_key=${API_KEY}`;
                await sleep(300);
            } else {
                url = null;
            }
        } catch (err) {
            console.warn(`[GovInfo] Error fetching packages: ${err.message}`);
            break; // Stop paginating packages on error, but keep what we have
        }
    }

    console.log(`[GovInfo] Found ${packages.length} package(s) total.`);
    return packages;
}

// ── Fetch granules for a package ──────────────────────────────────────────────

async function fetchPackageGranules(packageId) {
    const granules = [];
    let url = `${GOVINFO_BASE}/packages/${packageId}/granules?offsetMark=*&pageSize=100&api_key=${API_KEY}`;

    console.log(`[GovInfo] Fetching granules for ${packageId}…`);
    let page = 1;

    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 30000 });
            const pageGranules = data.granules || [];
            
            // Only keep LEAF granules (actual section content)
            const leafGranules = pageGranules.filter(g => g.granuleClass === "LEAF");
            granules.push(...leafGranules);

            if (data.nextPage) {
                url = data.nextPage + `&api_key=${API_KEY}`;
                page++;
                await sleep(250);
            } else {
                url = null;
            }
        } catch (err) {
            console.warn(`[GovInfo] Granule page ${page} error: ${err.message}`);
            break;
        }
    }

    console.log(`[GovInfo] Total LEAF granules for ${packageId}: ${granules.length}`);
    return granules;
}

// ── Download and parse a single granule ───────────────────────────────────────

async function processGranule(granule, packageId) {
    const granuleId = granule.granuleId;
    const htmUrl = `${GOVINFO_BASE}/packages/${packageId}/granules/${granuleId}/htm?api_key=${API_KEY}`;

    try {
        const { data: html } = await axios.get(htmUrl, {
            timeout: 30000,
            responseType: "text",
        });

        const citation = extractCitation(html, granuleId);
        const cleanText = stripHtml(html);

        if (cleanText.length < 80) {
            return null;
        }

        return {
            granuleId,
            packageId,
            title:    granule.title || "",
            citation,
            text:     cleanText,
        };
    } catch (err) {
        console.warn(`[GovInfo] Granule ${granuleId} download error: ${err.message}`);
        return null;
    }
}

// ── Embed & Store ─────────────────────────────────────────────────────────────

async function embedAndStore(sections) {
    if (sections.length === 0) {
        console.log("[GovInfo] No sections to embed.");
        return;
    }

    console.log(`\n[GovInfo] Processing and chunking ${sections.length} section(s)…`);
    let allChunks = [];

    // First chunk all sections
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

    console.log(`[GovInfo] Total chunks to embed locally: ${allChunks.length}`);

    let batch = [];
    let stored = 0;
    const startTime = Date.now();

    for (let i = 0; i < allChunks.length; i++) {
        const item = allChunks[i];
        const sec = item.section;

        try {
            if (i % 500 === 0 && i > 0) {
                const elapsed = Date.now() - startTime;
                const rate = elapsed > 0 ? i / elapsed : 1; // chunks per ms
                const remaining = (allChunks.length - i) / rate;
                const etaMins = (remaining / 60000).toFixed(1);
                console.log(`[GovInfo] Progress: ${i}/${allChunks.length} chunks. ETA: ${etaMins} mins…`);
            }

            const vector = await createEmbedding(item.text);

            batch.push({
                id: generateDeterministicUUID(`govinfo-${sec.granuleId}-chunk-${item.chunkIndex}`),
                vector,
                payload: {
                    text:         item.text,
                    documentType: "Federal Statute (US Code)",
                    citation:     sec.citation,
                    heading:      sec.title,
                    packageId:    sec.packageId,
                    granuleId:    sec.granuleId,
                    chunkIndex:   item.chunkIndex,
                    totalChunks:  item.totalChunks,
                    source:       "GovInfo USCODE",
                },
            });

            if (batch.length >= BATCH_SIZE) {
                await storeChunks(batch);
                stored += batch.length;
                batch = [];
            }
            
            // NO SLEEP NEEDED HERE: Local embedding is instant!
        } catch (err) {
            console.warn(`[GovInfo] Embed error for ${sec.granuleId} chunk ${item.chunkIndex}: ${err.message}`);
        }
    }

    if (batch.length > 0) {
        await storeChunks(batch);
        stored += batch.length;
    }

    console.log(`\n[GovInfo] ✓ Ingestion complete — ${stored} chunk(s) stored in Qdrant.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════════");
    console.log("  GovInfo USCODE Ingestion Worker");
    console.log("═══════════════════════════════════════════════\n");

    await initializeQdrant();

    const packages = await fetchUSCodePackages();
    if (packages.length === 0) {
        console.log("[GovInfo] No packages found. Exiting.");
        return;
    }

    const allSections = [];

    // Process all packages
    for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        const packageId = pkg.packageId;
        console.log(`\n[GovInfo] ── Processing Package ${i + 1}/${packages.length}: ${packageId} ──`);

        try {
            const granules = await fetchPackageGranules(packageId);

            console.log(`[GovInfo] Downloading text for ${granules.length} granule(s)…`);
            for (const granule of granules) {
                const section = await processGranule(granule, packageId);
                if (section) {
                    allSections.push(section);
                }
                await sleep(150); // Respect GovInfo web API rate limits
            }
        } catch (err) {
            console.warn(`[GovInfo] Package ${packageId} error: ${err.message}`);
        }
    }

    await embedAndStore(allSections);
    console.log("\n[GovInfo] Worker finished.\n");
}

main().catch((err) => {
    console.error("[GovInfo] Fatal error:", err.message);
    process.exit(1);
});