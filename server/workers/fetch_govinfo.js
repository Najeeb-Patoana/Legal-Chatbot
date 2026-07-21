/**
 * GovInfo USCODE Ingestion Worker
 * ────────────────────────────────
 * Standalone script: `node workers/fetch_govinfo.js`
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const fs                                   = require("fs");
const path                                 = require("path");
const { createEmbedding }                  = require("../helpers/embedding");
const { chunkText }                        = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const GOVINFO_BASE  = "https://api.govinfo.gov";
const API_KEY       = process.env.GOVINFO_API_KEY;
const BATCH_SIZE    = 25; 

// File to keep track of what we already finished!
const PROGRESS_FILE = path.resolve(__dirname, "govinfo_progress.json");

if (!API_KEY) {
    console.error("════════════════════════════════════════════════════════════");
    console.error("  ERROR: GOVINFO_API_KEY is not set in .env");
    process.exit(1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Progress Tracking Helpers ─────────────────────────────────────────────────

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const data = fs.readFileSync(PROGRESS_FILE, "utf-8");
            return new Set(JSON.parse(data));
        } catch (e) {
            return new Set();
        }
    }
    return new Set();
}

function saveProgress(completedSet) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(Array.from(completedSet), null, 2));
}

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
    startDate.setFullYear(startDate.getFullYear() - 1); 
    const startStr = startDate.toISOString().split("T")[0] + "T00:00:00Z";

    let url = `${GOVINFO_BASE}/collections/USCODE/${startStr}?pageSize=100&offsetMark=*&api_key=${API_KEY}`;
    console.log("[GovInfo] Fetching USCODE package list…");

    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 60000 });
            if (data.packages) packages.push(...data.packages);
            if (data.nextPage) {
                url = data.nextPage + `&api_key=${API_KEY}`;
                await sleep(300);
            } else {
                url = null;
            }
        } catch (err) {
            console.warn(`[GovInfo] Error fetching packages: ${err.message}`);
            break; 
        }
    }
    return packages;
}

async function fetchPackageGranules(packageId) {
    const granules = [];
    let url = `${GOVINFO_BASE}/packages/${packageId}/granules?offsetMark=*&pageSize=100&api_key=${API_KEY}`;
    let page = 1;

    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 60000 });
            const pageGranules = data.granules || [];
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
    return granules;
}

async function processGranule(granule, packageId) {
    const granuleId = granule.granuleId;
    const htmUrl = `${GOVINFO_BASE}/packages/${packageId}/granules/${granuleId}/htm?api_key=${API_KEY}`;

    try {
        const { data: html } = await axios.get(htmUrl, { timeout: 60000, responseType: "text" });
        const citation = extractCitation(html, granuleId);
        const cleanText = stripHtml(html);

        if (cleanText.length < 80) return null;

        return { granuleId, packageId, title: granule.title || "", citation, text: cleanText };
    } catch (err) {
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
            allChunks.push({ section: sec, text: chunks[i], chunkIndex: i, totalChunks: chunks.length });
        }
    }

    console.log(`[GovInfo] -> Generated ${allChunks.length} chunks. Embedding locally...`);

    let batch = [];
    let stored = 0;

    for (let i = 0; i < allChunks.length; i++) {
        const item = allChunks[i];
        const sec = item.section;

        try {
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
        } catch (err) {
            console.warn(`[GovInfo] Embed error for ${sec.granuleId} chunk ${item.chunkIndex}: ${err.message}`);
        }
    }

    if (batch.length > 0) {
        await storeChunks(batch);
        stored += batch.length;
    }

    console.log(`[GovInfo] ✓ Successfully pushed ${stored} chunks to Qdrant.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════════");
    console.log("  GovInfo USCODE Ingestion Worker");
    console.log("═══════════════════════════════════════════════\n");

    await initializeQdrant();

    const completedPackages = loadProgress();
    console.log(`[GovInfo] Loaded progress: ${completedPackages.size} packages already completed.`);

    const packages = await fetchUSCodePackages();
    if (packages.length === 0) {
        console.log("[GovInfo] No packages found. Exiting.");
        return;
    }

    for (let i = 0; i < packages.length; i++) {
        const packageId = packages[i].packageId;
        console.log(`\n[GovInfo] ── Processing Package ${i + 1}/${packages.length}: ${packageId} ──`);

        // Checkpoint Logic: Skip if we already finished this package!
        if (completedPackages.has(packageId)) {
            console.log(`[GovInfo] Skipping ${packageId} — already processed!`);
            continue;
        }

        try {
            const granules = await fetchPackageGranules(packageId);
            console.log(`[GovInfo] Downloading ${granules.length} laws/sections…`);
            
            const packageSections = [];
            for (const granule of granules) {
                const section = await processGranule(granule, packageId);
                if (section) packageSections.push(section);
                await sleep(50); 
            }

            await embedAndStore(packageSections);
            
            // Mark as done and save progress!
            completedPackages.add(packageId);
            saveProgress(completedPackages);
            
        } catch (err) {
            console.warn(`[GovInfo] Package ${packageId} error: ${err.message}`);
        }
    }

    console.log("\n[GovInfo] All packages finished successfully!\n");
}

main().catch((err) => {
    console.error("[GovInfo] Fatal error:", err.message);
    process.exit(1);
});