/**
 * GovInfo USCODE Ingestion Worker
 * ────────────────────────────────
 * Standalone script: `node workers/fetch_govinfo.js`
 *
 * Pulls recent US Code packages from the GovInfo API, downloads their
 * USLM XML, breaks each document into <section> nodes, embeds the text,
 * and upserts deterministic points into Qdrant.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios                                = require("axios");
const { DOMParser }                        = require("@xmldom/xmldom");
const xpath                                = require("xpath");
const { createEmbedding }                  = require("../helpers/embedding");
const { extractNodeText }                  = require("../helpers/chunking");
const { initializeQdrant, storeChunks }    = require("../helpers/qdrant");
const { generateDeterministicUUID }        = require("../helpers/cryptoUtils");

// ── Config ────────────────────────────────────────────────────────────────────
const GOVINFO_BASE  = "https://api.govinfo.gov";
const API_KEY       = process.env.GOVINFO_API_KEY;
const BATCH_SIZE    = 10;          // points per upsert call
const EMBED_DELAY   = 300;         // ms between embedding calls (rate-limit safety)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Fetch package list ────────────────────────────────────────────────────────

/**
 * Fetch recent USCODE packages from GovInfo collections endpoint.
 * Returns an array of { packageId, title, dateIssued, packageLink }.
 */
async function fetchUSCodePackages() {
    // Fetch from the last 12 months to get a meaningful dataset
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

// ── Fetch & parse a single package ────────────────────────────────────────────

/**
 * Given a GovInfo package summary link, fetch its details to find the
 * USLM XML download URL, then download and parse the XML.
 */
async function fetchAndParsePackage(pkg) {
    const packageId = pkg.packageId;
    console.log(`\n[GovInfo] Processing package: ${packageId}`);

    // 1. Get package summary to find download links
    const summaryUrl = `${pkg.packageLink}?api_key=${API_KEY}`;
    const { data: summary } = await axios.get(summaryUrl, { timeout: 30000 });

    // 2. Look for XML download — GovInfo provides multiple format links
    //    Try the direct XML content URL or the 'xml' download link
    let xmlUrl = null;

    if (summary.download?.xmlLink) {
        xmlUrl = summary.download.xmlLink + `?api_key=${API_KEY}`;
    } else if (summary.download?.uslmLink) {
        xmlUrl = summary.download.uslmLink + `?api_key=${API_KEY}`;
    } else {
        // Try the granules for more granular XML
        console.log(`[GovInfo] No direct XML link for ${packageId}, trying granules…`);
        return await fetchGranules(summary, packageId);
    }

    console.log(`[GovInfo] Downloading XML for ${packageId}…`);
    const { data: xmlText } = await axios.get(xmlUrl, { timeout: 60000, responseType: "text" });

    return parseSections(xmlText, packageId);
}

/**
 * Fetch individual granules (sections) from a package when no top-level XML is available.
 */
async function fetchGranules(summary, packageId) {
    const sections = [];
    const granulesUrl = summary.granulesLink
        ? `${summary.granulesLink}?pageSize=50&offsetMark=*&api_key=${API_KEY}`
        : null;

    if (!granulesUrl) {
        console.log(`[GovInfo] No granules available for ${packageId}, skipping.`);
        return sections;
    }

    const { data: granulesData } = await axios.get(granulesUrl, { timeout: 30000 });
    const granules = granulesData.granules || [];
    console.log(`[GovInfo] Found ${granules.length} granule(s) for ${packageId}.`);

    for (const granule of granules.slice(0, 20)) { // Cap at 20 granules per package
        try {
            const granuleDetail = `${granule.granuleLink}?api_key=${API_KEY}`;
            const { data: gDetail } = await axios.get(granuleDetail, { timeout: 30000 });

            let gXmlUrl = null;
            if (gDetail.download?.xmlLink) {
                gXmlUrl = gDetail.download.xmlLink + `?api_key=${API_KEY}`;
            }

            if (gXmlUrl) {
                const { data: gXml } = await axios.get(gXmlUrl, { timeout: 60000, responseType: "text" });
                const parsed = parseSections(gXml, packageId);
                sections.push(...parsed);
            }
            await sleep(200); // respect rate limits
        } catch (err) {
            console.warn(`[GovInfo] Skipping granule ${granule.granuleId}: ${err.message?.split("\n")[0]}`);
        }
    }

    return sections;
}

// ── XML Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse USLM XML and extract individual <section> nodes.
 * Each section yields: { identifier, heading, text }.
 */
function parseSections(xmlText, packageId) {
    const sections = [];

    try {
        const doc = new DOMParser({
            errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
        }).parseFromString(xmlText, "text/xml");

        // Use XPath to find all <section> elements (USLM namespace-agnostic)
        const select = xpath.useNamespaces({});
        let sectionNodes = select("//section", doc);

        // Also try with USLM namespace prefix
        if (sectionNodes.length === 0) {
            sectionNodes = select("//*[local-name()='section']", doc);
        }

        console.log(`[GovInfo] Found ${sectionNodes.length} <section> node(s) in ${packageId}.`);

        for (const node of sectionNodes) {
            // Extract @identifier (e.g., /us/usc/t17/s107)
            const identifier = node.getAttribute("identifier") || node.getAttribute("id") || "";

            // Extract heading text
            const headingNodes = xpath.select("*[local-name()='heading']", node);
            const heading = headingNodes.length > 0 ? extractNodeText(headingNodes[0]) : "";

            // Extract full text content
            const fullText = extractNodeText(node);

            if (fullText.length < 50) continue; // skip trivially short sections

            sections.push({
                identifier: identifier || `${packageId}-section-${sections.length}`,
                heading,
                text: fullText,
            });
        }
    } catch (err) {
        console.error(`[GovInfo] XML parse error for ${packageId}: ${err.message?.split("\n")[0]}`);
    }

    return sections;
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
        const textForEmbedding = sec.heading
            ? `${sec.heading}\n\n${sec.text}`
            : sec.text;

        try {
            console.log(`[GovInfo] Embedding ${i + 1}/${sections.length}: ${sec.identifier}`);
            const vector = await createEmbedding(textForEmbedding);

            batch.push({
                id:      generateDeterministicUUID(`govinfo-${sec.identifier}`),
                vector,
                payload: {
                    text:         textForEmbedding,
                    documentType: "Federal Statute (US Code)",
                    citation:     sec.identifier,
                    heading:      sec.heading,
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
            console.warn(`[GovInfo] Skipping section ${sec.identifier}: ${err.message?.split("\n")[0]}`);
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

    for (const pkg of packages.slice(0, 5)) { // Process up to 5 packages per run
        try {
            const sections = await fetchAndParsePackage(pkg);
            allSections.push(...sections);
            await sleep(500);
        } catch (err) {
            console.warn(`[GovInfo] Package error: ${err.message?.split("\n")[0]}`);
        }
    }

    await embedAndStore(allSections);
    console.log("\n[GovInfo] Worker finished.\n");
}

main().catch((err) => {
    console.error("[GovInfo] Fatal error:", err.message?.split("\n")[0]);
    process.exit(1);
});
