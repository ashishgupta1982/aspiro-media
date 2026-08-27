const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/i;

/**
 * Whether a picked or dropped file should be treated as an image.
 *
 * `file.type` alone is not enough. Mobile photos — iOS HEIC especially — often
 * arrive with an empty MIME type or a generic `application/octet-stream`, and
 * sometimes with an extension-less name like "image". Rejecting those turns a
 * perfectly good photo into an error the user cannot explain.
 *
 * So: trust a clear image MIME, then the extension, and otherwise let anything
 * that is not explicitly a NON-image through for Cloudinary to validate and
 * convert. Genuine non-images (PDFs, video) carry an explicit type and are
 * still rejected here.
 */
export function isLikelyImageFile(file) {
  if (!file) return false;
  const type = file.type || '';
  if (type.startsWith('image/')) return true;
  if (IMAGE_EXTENSIONS.test(file.name || '')) return true;
  if (!type || type === 'application/octet-stream') return true;
  return false;
}
