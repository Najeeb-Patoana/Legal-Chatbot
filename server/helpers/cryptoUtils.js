const { createHash } = require("crypto");

/**
 * Generate a deterministic, stable UUID from any input string.
 * Uses MD5 hash formatted as a valid UUID v4 structure.
 *
 * This guarantees that re-ingesting the same document/chunk
 * always produces the same point ID → Qdrant upsert overwrites
 * instead of duplicating.
 *
 * @param {string} inputString  Stable key (e.g. citation path or case-chunk ID)
 * @returns {string}            UUID v4-formatted string
 */
function generateDeterministicUUID(inputString) {
    const hash = createHash("md5").update(inputString).digest("hex");
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        "4" + hash.substring(13, 16),                                                      // v4 version nibble
        (parseInt(hash.substring(16, 17), 16) & 0x3 | 0x8).toString(16) + hash.substring(17, 20), // variant bits
        hash.substring(20, 32),
    ].join("-");
}

module.exports = { generateDeterministicUUID };
