import { configureCloudinary } from './config.js';
import { generatePublicId } from './sign.js';

/**
 * Upload a buffer from the server.
 *
 * The direct browser upload is the right path for anything a user picks — it
 * keeps the file off the serverless request entirely. This is for the cases
 * where the bytes are already on the server: an image fetched from a URL, a
 * frame rendered server-side, a file that arrived as multipart.
 */
export function uploadBuffer(buffer, {
  folder,
  publicId,
  format = 'jpg',
  resourceType = 'image',
  transformation,
  ...rest
} = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('[aspiro-media] uploadBuffer needs a Buffer');
  if (!folder) throw new Error('[aspiro-media] uploadBuffer needs a folder');

  const cloudinary = configureCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId || generatePublicId('upload'),
        format,
        resource_type: resourceType,
        ...(transformation ? { transformation } : {}),
        ...rest,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resourceType: result.resource_type,
        });
      }
    );
    stream.end(buffer);
  });
}
