/**
 * Cloudinary delivery-URL helpers.
 *
 * These are pure string functions with no dependencies, deliberately: they are
 * imported by browser code, server routes and scripts alike, and pulling the
 * `cloudinary` SDK in here would drag it into every client bundle.
 */

const CLOUDINARY_HOST = 'res.cloudinary.com';
const UPLOAD_MARKER = /\/(image|video|raw)\/upload\//;

/** A Cloudinary transformation segment looks like `c_fill,w_300` or `e_grayscale`. */
const TRANSFORMATION_SEGMENT = /^[a-z]{1,3}_[^/]+$/i;
const VERSION_SEGMENT = /^v\d+$/;

export function isCloudinaryUrl(value) {
  return typeof value === 'string' && value.includes(CLOUDINARY_HOST);
}

/**
 * Pull the public_id out of a delivery URL.
 *
 * The two things that make this harder than it looks, and that every hand-rolled
 * version in the suite got wrong in a different way:
 *
 *   1. A public_id CONTAINS SLASHES when the asset is in a folder — which is
 *      always, here. A `([^/]+)` capture cannot cross them and returns null for
 *      every foldered asset. That bug silently disabled RunCoach's frame cleanup
 *      and left 1,636 orphaned assets behind.
 *   2. The URL may carry any number of leading transformation segments AND a
 *      version segment, in that order, both optional. Assuming a version is
 *      present returns null without one; ignoring transformations folds them
 *      into the id.
 *
 * @param {string} url
 * @param {{ resourceType?: 'image'|'video'|'raw' }} [options] restrict to one
 *   resource type; by default any of the three is accepted.
 * @returns {string|null}
 */
export function extractPublicId(url, { resourceType } = {}) {
  if (typeof url !== 'string' || !url) return null;

  const marker = resourceType ? new RegExp(`/${resourceType}/upload/`) : UPLOAD_MARKER;
  const match = url.match(marker);
  if (!match) return null;

  const after = url.slice(match.index + match[0].length);
  // Strip the query string / fragment before touching the path.
  const path = after.split(/[?#]/)[0];

  const segments = path.split('/');
  while (segments.length > 1) {
    const segment = segments[0];
    if (VERSION_SEGMENT.test(segment) || TRANSFORMATION_SEGMENT.test(segment)) segments.shift();
    else break;
  }

  const id = segments.join('/').replace(/\.[a-z0-9]+$/i, '');
  return id || null;
}

/** The delivery format ('jpg', 'pdf', 'mp4'…), or null if the URL carries none. */
export function extractFormat(url) {
  if (!isCloudinaryUrl(url)) return null;
  const path = url.split(/[?#]/)[0];
  const match = path.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

/** 'image' | 'video' | 'raw'. Defaults to 'image' for anything unrecognised. */
export function extractResourceType(url) {
  if (typeof url !== 'string') return 'image';
  const match = url.match(UPLOAD_MARKER);
  return match ? match[1] : 'image';
}

/**
 * Insert a transformation segment into a delivery URL.
 *
 * No-op for non-Cloudinary URLs and for URLs that already carry a transformation,
 * so it is safe to apply blindly to whatever a document happens to hold.
 *
 * @param {string} url
 * @param {string} transform e.g. 'c_fill,w_300,f_auto,q_auto'
 */
export function transformUrl(url, transform) {
  if (!isCloudinaryUrl(url) || !transform) return url;

  const match = url.match(UPLOAD_MARKER);
  if (!match) return url;

  const head = url.slice(0, match.index + match[0].length);
  const tail = url.slice(match.index + match[0].length);

  // Already transformed? Leave it alone rather than stacking a second segment.
  // Note this tests for ANY transformation op, not just comma-joined ones — a
  // lone `w_500/` is a transformation too, and CookBook's version missed it.
  const firstSegment = tail.split('/')[0] || '';
  if (TRANSFORMATION_SEGMENT.test(firstSegment)) return url;

  return `${head}${transform}/${tail}`;
}
