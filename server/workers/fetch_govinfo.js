/**
 * GovInfo USCODE Ingestion Worker
 * ────────────────────────────────
 * Standalone script: `node workers/fetch_govinfo.js`
 *
 * Pulls US Code section granules from the GovInfo API, downloads their
 * HTML content, cleans the text, embeds it, and upserts deterministic
 * points into Qdrant.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { createEmbedding }                  = require("../helpers/embedding");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const GOVINFO_BASE  = "https://api.govinfo.gov";
const API_KEY       = process.env.GOVINFO_API_KEY;
const BATCH_SIZE    = 10;
const EMBED_DELAY   = 350;         // ms between embedding calls (rate-limit safety)

if (!API_KEY) {
    console.error("[GovInfo] GOVINFO_API_KEY is not set in .env — aborting.");
    process.exit(1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── HTML stripping ────────────────────────────────────────────────────────────

/**
 * Strip HTML tags and clean whitespace from GovInfo HTML content.
 */
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

/**
 * Extract citation path from HTML comments like:
 * <!-- expcite:TITLE 50-WAR AND NATIONAL DEFENSE!@!CHAPTER 1-...!@!Sec. 1 -->
 * <!-- itempath:/500/CHAPTER 1/Sec. 1 -->
 */
function extractCitation(html, granuleId) {
    // Try expcite comment first
    const expciteMatch = html.match(/<!--\s*expcite:(.+?)-->/);
    if (expciteMatch) {
        return expciteMatch[1].replace(/!@!/g, " > ").trim();
    }

    // Try itempath comment
    const itempathMatch = html.match(/<!--\s*itempath:(.+?)-->/);
    if (itempathMatch) {
        return itempathMatch[1].trim();
    }

    // Fallback to granuleId
    return granuleId;
}

// ── Fetch package list ────────────────────────────────────────────────────────

/**
 * Fetch recent USCODE packages from GovInfo collections endpoint.
 */
async function fetchUSCodePackages() {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const startStr = startDate.toISOString().split("T")[0] + "T00:00:00Z";

    const url = `${GOVINFO_BASE}/collections/USCODE/${startStr}?pageSize=25&offsetMark=*&api_key=${API_KEY}`;
    console.log("[GovInfo] Fetching USCODE package list…");

    const { data } = await axios.get(url, { timeout: 30000 });
    const packages = data.packages || [];
    console.log(`[GovInfo] Found ${packages.length} package(s).`);
    return packages;
}

// ── Fetch granules for a package ──────────────────────────────────────────────

/**
 * Fetch LEAF granules (actual statute sections) from a package.
 * Skips TOC, FRONTMATTER, and TOPPARENT granules.
 */
async function fetchPackageGranules(packageId) {
    const granules = [];
    let url = `${GOVINFO_BASE}/packages/${packageId}/granules?offsetMark=*&pageSize=100&api_key=${API_KEY}`;

    console.log(`[GovInfo] Fetching granules for ${packageId}…`);

    // Paginate through all granules (cap at 3 pages = 300 granules per package)
    for (let page = 0; page < 3; page++) {
        try {
            const { data } = await axios.get(url, { timeout: 30000 });
            const pageGranules = data.granules || [];

            // Only keep LEAF granules (actual section content)
            const leafGranules = pageGranules.filter(
                (g) => g.granuleClass === "LEAF"
            );
            granules.push(...leafGranules);

            console.log(`[GovInfo]   Page ${page + 1}: ${pageGranules.length} total, ${leafGranules.length} LEAF sections`);

            // Check for next page
            if (data.nextPage) {
                url = data.nextPage + `&api_key=${API_KEY}`;
                await sleep(300);
            } else {
                break;
            }
        } catch (err) {
            console.warn(`[GovInfo]   Granule page error: ${err.message?.split("\n")[0]}`);
            break;
        }
    }

    console.log(`[GovInfo]   Total LEAF granules: ${granules.length}`);
    return granules;
}

// ── Download and parse a single granule ───────────────────────────────────────

/**
 * Download the HTML content for a granule and extract clean text + citation.
 */
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
            return null; // Skip trivially short sections
        }

        return {
            granuleId,
            title:    granule.title || "",
            citation,
            text:     cleanText,
        };
    } catch (err) {
        console.warn(`[GovInfo]   Granule ${granuleId}: ${err.message?.split("\n")[0]}`);
        return null;
    }
}

// ── Embed & Store ─────────────────────────────────────────────────────────────

async function embedAndStore(sections) {
    if (sections.length === 0) {
        console.log("[GovInfo] No sections to embed.");
        return;
    }

    console.log(`\n[GovInfo] Embedding ${sections.length} section(s)…`);
    let batch = [];
    let stored = 0;

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const textForEmbedding = sec.title
            ? `${sec.title}\n\n${sec.text}`
            : sec.text;

        try {
            console.log(`[GovInfo] Embedding ${i + 1}/${sections.length}: ${sec.citation.substring(0, 60)}…`);
            const vector = await createEmbedding(textForEmbedding);

            batch.push({
                id:      generateDeterministicUUID(`govinfo-${sec.granuleId}`),
                vector,
                payload: {
                    text:         textForEmbedding,
                    documentType: "Federal Statute (US Code)",
                    citation:     sec.citation,
                    heading:      sec.title,
                    granuleId:    sec.granuleId,
                    source:       "GovInfo USCODE",
                },
            });

            if (batch.length >= BATCH_SIZE) {
                await storeChunks(batch);
                stored += batch.length;
                console.log(`[GovInfo] Stored batch (${stored} total).`);
                batch = [];
            }

            await sleep(EMBED_DELAY);
        } catch (err) {
            console.warn(`[GovInfo] Embed error for ${sec.granuleId}: ${err.message?.split("\n")[0]}`);
        }
    }

    // Flush remaining
    if (batch.length > 0) {
        await storeChunks(batch);
        stored += batch.length;
    }

    console.log(`\n[GovInfo] ✓ Ingestion complete — ${stored} section(s) stored.`);
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

    // Process up to 3 packages per run
    for (const pkg of packages.slice(0, 3)) {
        const packageId = pkg.packageId;
        console.log(`\n[GovInfo] ── Processing: ${packageId} ──`);

        try {
            const granules = await fetchPackageGranules(packageId);

            // Process up to 15 granules per package to stay within rate limits
            const toProcess = granules.slice(0, 15);
            console.log(`[GovInfo] Processing ${toProcess.length} granule(s) from ${packageId}…`);

            for (const granule of toProcess) {
                const section = await processGranule(granule, packageId);
                if (section) {
                    allSections.push(section);
                }
                await sleep(250); // respect rate limits
            }
        } catch (err) {
            console.warn(`[GovInfo] Package ${packageId} error: ${err.message?.split("\n")[0]}`);
        }
    }

    await embedAndStore(allSections);
    console.log("\n[GovInfo] Worker finished.\n");
}

main().catch((err) => {
    console.error("[GovInfo] Fatal error:", err.message?.split("\n")[0]);
    process.exit(1);
});
