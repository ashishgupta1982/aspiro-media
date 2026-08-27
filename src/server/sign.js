import { configureCloudinary } from './config.js';

/**
 * Build the signed upload payload for a direct browser upload.
 *
 * Returns BOTH the signature and the exact field set the browser must post.
 * That pairing is the whole point, and it exists because of a real bug:
 *
 *   Cloudinary validates the signature against every parameter it receives
 *   except `file`, `api_key` and `resource_type`. Send one more than you signed
 *   — a stray `quality: 'auto'`, say — and the upload is rejected as "Invalid
 *   Signature". One app in the suite documented this in a comment; another did
 *   exactly it and its photo upload never worked once.
 *
 * By returning `fields`, the caller never assembles the form itself, so the set
 * that was signed and the set that is sent cannot drift apart.
 */
export function buildSignedUpload({
  folder,
  publicId,
  format,
  resourceType = 'image',
  params = {},
}) {
  const cloudinary = configureCloudinary();

  // Everything here is signed. `undefined` entries are dropped rather than
  // signed as the string "undefined".
  const signedParams = {
    folder,
    ...(publicId ? { public_id: publicId } : {}),
    ...(format ? { format } : {}),
    ...params,
    timestamp: Math.round(Date.now() / 1000),
  };

  for (const key of Object.keys(signedParams)) {
    if (signedParams[key] === undefined || signedParams[key] === null) delete signedParams[key];
  }

  const signature = cloudinary.utils.api_sign_request(
    signedParams,
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    // `api_key` and `signature` are sent but never signed — that is Cloudinary's
    // rule, not a shortcut.
    fields: { ...signedParams, api_key: process.env.CLOUDINARY_API_KEY, signature },
    folder,
    publicId: publicId || null,
    resourceType,
  };
}

/** A random, collision-resistant public id under an app-chosen label. */
export function generatePublicId(label = 'upload') {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
