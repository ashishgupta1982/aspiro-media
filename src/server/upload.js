import { configureCloudinary } from './config.js';
import { generatePublicId } from './sign.js';
import { safeFetch } from './safeFetch.js';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

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

/**
 * Fetch a remote image and upload it — safely.
 *
 * The URL comes from the client in every real use of this (an AI-suggested
 * photo, a pasted link), so the fetch is guarded: http(s) only, no host that
 * resolves to a private or reserved address, and every redirect hop re-checked.
 * That guard is not optional and cannot be switched off, because the whole
 * reason this lives in the package is that one app had it and another did not.
 *
 * @param {string} url
 * @param {object} options — everything uploadBuffer takes, plus:
 * @param {number} [options.maxBytes=20MB]
 * @param {number} [options.timeoutMs=15000]
 */
export async function uploadFromUrl(url, {
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ...uploadOptions
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await safeFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'aspiro-media/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error('URL does not point to an image');
  }

  // Trust the declared length when it is there, but check the real size too —
  // Content-Length is attacker-controlled and may simply be absent.
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Image too large');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error('Image too large');
  }

  return uploadBuffer(buffer, uploadOptions);
}
