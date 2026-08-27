import { v2 as cloudinary } from 'cloudinary';

let configured = false;

/**
 * Configure the SDK from the environment, once per process.
 *
 * Every app in the suite uses the same three variable names, so this needs no
 * per-app configuration. Calling it repeatedly is free.
 */
export function configureCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    configured = true;
  }
  return cloudinary;
}

/**
 * Whether all three credentials are present.
 *
 * Worth checking explicitly before signing: without them the SDK produces a
 * signature that Cloudinary rejects, and the user sees "upload failed" rather
 * than anything pointing at a missing environment variable.
 */
export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

export { cloudinary };
