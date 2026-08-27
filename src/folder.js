/**
 * Folder naming and the ownership boundary.
 *
 * Every app in the suite shares ONE Cloudinary account. The folder an asset sits
 * in is the only thing separating one app from another, and one user from
 * another inside an app. Get this wrong and a delete reaches someone else's
 * files, so the rules here are deliberately strict.
 */

/**
 * Sanitise one path segment.
 *
 * Byte-for-byte the behaviour the apps have used since the beginning — do not
 * "improve" it. Existing folders on Cloudinary were named by this exact
 * transformation, and any change stops `legacyOwnerPrefix` matching real
 * folders, which would silently make old assets undeletable.
 */
export function sanitizeSegment(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * The folder new uploads go to: `<prefix>/<owner id>`.
 *
 * Keyed on the owner's IMMUTABLE ID, never their display name. The original
 * design used `sanitized-display-name || id`, which has two failure modes that
 * only show up in production:
 *
 *   1. A user renames themselves. Their folder changes, every asset they
 *      already own falls outside the new prefix, and they can never delete it
 *      again — a slow leak of permanent orphans.
 *   2. TWO USERS WITH THE SAME DISPLAY NAME SHARE A FOLDER. Google account
 *      names are not unique; two people called Jane Smith both resolve to
 *      `CookBook/Jane-Smith`, and each then passes the ownership check on the
 *      other's assets. That is a live IDOR, not a theoretical one.
 *
 * @param {string} prefix app namespace, e.g. 'CookBook'
 * @param {{ id: string }} owner
 */
export function ownerFolder(prefix, { id } = {}) {
  if (!prefix) throw new Error('[aspiro-media] a folder prefix is required');
  if (!id) throw new Error('[aspiro-media] an owner id is required');
  const segment = sanitizeSegment(String(id));
  if (!segment) throw new Error('[aspiro-media] owner id sanitised to nothing');
  return `${prefix}/${segment}`;
}

/**
 * The folder an app used BEFORE it moved to id-keyed folders.
 *
 * Returned so a delete can still reach assets uploaded under the old scheme.
 * Nothing new is ever written here.
 */
export function legacyOwnerPrefix(prefix, { id, name } = {}) {
  const segment = sanitizeSegment(name) || (id ? sanitizeSegment(String(id)) : '');
  return segment ? `${prefix}/${segment}` : null;
}

/**
 * Every folder prefix a delete may legitimately target for this owner.
 *
 * Returns trailing-slash-terminated prefixes, because `startsWith` without the
 * slash would let `CookBook/12` match `CookBook/123/...` — a different user.
 *
 * @param {string} prefix
 * @param {{ id: string, name?: string }} owner
 * @param {{ includeLegacyName?: boolean }} [options] pass true for an app that
 *   has assets predating the move to id-keyed folders.
 * @returns {string[]}
 */
export function ownedPrefixes(prefix, owner = {}, { includeLegacyName = false } = {}) {
  const prefixes = [`${ownerFolder(prefix, owner)}/`];

  if (includeLegacyName) {
    const legacy = legacyOwnerPrefix(prefix, owner);
    if (legacy && !prefixes.includes(`${legacy}/`)) prefixes.push(`${legacy}/`);
  }

  return prefixes;
}

/**
 * Whether a public id sits inside one of the given prefixes.
 * The single check every delete path must pass through.
 */
export function isOwnedBy(publicId, prefixes = []) {
  if (typeof publicId !== 'string' || !publicId) return false;
  return prefixes.some((p) => typeof p === 'string' && p && publicId.startsWith(p));
}
