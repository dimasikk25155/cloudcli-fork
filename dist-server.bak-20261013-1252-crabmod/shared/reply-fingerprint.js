/**
 * Fingerprint of an assistant reply, computed the same way on the client and
 * the server. Reply chips are tied to the reply the user is looking at: the
 * client sends this fingerprint, the server compares it with the tail of its
 * transcript and refuses to generate chips for a different reply.
 *
 * Not a security hash — FNV-1a 32-bit plus length is plenty to tell two
 * replies apart, and it works in non-secure browser contexts (plain http over
 * Tailscale) where crypto.subtle is missing.
 */
export function replyFingerprint(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    let hash = 0x811c9dc5;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${normalized.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}
//# sourceMappingURL=reply-fingerprint.js.map