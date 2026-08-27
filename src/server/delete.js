import { configureCloudinary } from './config.js';
import { isOwnedBy } from '../folder.js';

const BATCH_SIZE = 100; // Cloudinary's per-call cap for delete_resources

/**
 * Delete assets the caller owns, and refuse anything else.
 *
 * Two rules are enforced here rather than left to each app:
 *
 *   1. EVERY id is checked against the owner's prefixes. Public ids are
 *      discoverable from any visible image URL, so without this check any
 *      signed-in user could delete anyone else's assets by pasting an id.
 *   2. Images and videos are deleted in SEPARATE calls with the right
 *      `resource_type`. Deleting a video as an image reports success and
 *      removes nothing — a silent no-op that leaves the asset billing forever.
 *
 * @param {object}   options
 * @param {string[]} options.publicIds       image public ids
 * @param {string[]} [options.videoPublicIds] video public ids
 * @param {string[]} options.prefixes        from `ownedPrefixes()`
 * @returns {Promise<{deleted: object, notFound: string[], rejected: string[]}>}
 */
export async function deleteOwned({ publicIds = [], videoPublicIds = [], prefixes = [] } = {}) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    throw new Error('[aspiro-media] deleteOwned requires at least one owned prefix');
  }

  const cloudinary = configureCloudinary();

  const images = (Array.isArray(publicIds) ? publicIds : []).filter((id) => typeof id === 'string');
  const videos = (Array.isArray(videoPublicIds) ? videoPublicIds : []).filter((id) => typeof id === 'string');

  const ownedImages = images.filter((id) => isOwnedBy(id, prefixes));
  const ownedVideos = videos.filter((id) => isOwnedBy(id, prefixes));

  const rejected = [
    ...images.filter((id) => !isOwnedBy(id, prefixes)),
    ...videos.filter((id) => !isOwnedBy(id, prefixes)),
  ];

  if (rejected.length > 0) {
    console.warn(`[aspiro-media] refused ${rejected.length} id(s) outside the owner's folders`);
  }

  const deleted = {};
  const notFound = [];

  for (const [ids, resourceType] of [[ownedImages, 'image'], [ownedVideos, 'video']]) {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const result = await cloudinary.api.delete_resources(batch, {
        resource_type: resourceType,
        type: 'upload',
      });
      Object.assign(deleted, result.deleted || {});
      notFound.push(...(result.not_found || []));
    }
  }

  return { deleted, notFound, rejected };
}

/**
 * Delete everything under a folder prefix.
 *
 * For apps whose ownership check lives on the RECORD rather than the folder —
 * Tutor App deletes a revision list's whole folder once it has confirmed the
 * list belongs to the caller. `prefixes` is still required, so a bug upstream
 * cannot hand this another app's folder.
 *
 * @param {string} folderPath
 * @param {object} options
 * @param {string[]} options.prefixes  from `ownedPrefixes()`
 * @param {boolean} [options.invalidate=false] purge the CDN as well as deleting
 *   the asset. Without it a deleted file keeps being served from cache until it
 *   expires — which matters when the file is someone's exam paper rather than a
 *   decorative image. Costs an invalidation against the Cloudinary plan.
 */
export async function deleteFolder(folderPath, { prefixes = [], invalidate = false } = {}) {
  if (!folderPath) throw new Error('[aspiro-media] deleteFolder requires a folder path');
  if (!isOwnedBy(`${folderPath}/`, prefixes)) {
    throw new Error(`[aspiro-media] refusing to delete ${folderPath}: outside the owner's folders`);
  }

  const cloudinary = configureCloudinary();
  const deleted = {};
  const notFound = [];

  // Cloudinary matches this as a literal prefix, so without the trailing slash
  // `.../exam-1` would also sweep `.../exam-10`.
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  for (const resourceType of ['image', 'video', 'raw']) {
    const result = await cloudinary.api.delete_resources_by_prefix(prefix, {
      resource_type: resourceType,
      type: 'upload',
      ...(invalidate ? { invalidate: true } : {}),
    });
    Object.assign(deleted, result.deleted || {});
    notFound.push(...(result.not_found || []));
  }

  // Cloudinary keeps the (now empty) folder node around; remove it so the
  // console does not fill with empty per-exam folders.
  try {
    await cloudinary.api.delete_folder(prefix);
  } catch {
    // Non-fatal: the folder may be gone already, or still settling.
  }

  return { deleted, notFound };
}
