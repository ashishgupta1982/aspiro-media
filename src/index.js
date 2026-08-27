/**
 * @aspiro/media — core.
 *
 * Everything exported here is pure and dependency-free, so it is safe to import
 * from client components, server routes and standalone scripts alike. Anything
 * needing the Cloudinary SDK lives behind `@aspiro/media/server`; anything
 * touching the DOM lives behind `@aspiro/media/client`.
 */
export {
  isCloudinaryUrl,
  extractPublicId,
  extractFormat,
  extractResourceType,
  transformUrl,
} from './url.js';

export {
  sanitizeSegment,
  ownerFolder,
  legacyOwnerPrefix,
  ownedPrefixes,
  isOwnedBy,
} from './folder.js';

export { isLikelyImageFile } from './file.js';
