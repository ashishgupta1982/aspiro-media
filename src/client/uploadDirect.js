/**
 * Upload a file straight from the browser to Cloudinary.
 *
 * The file never passes through Vercel — the server only ever issues a
 * short-lived signature — which keeps large photos and video off the serverless
 * request path entirely.
 *
 * THE IMPORTANT PART: the caller does not build the form. The signature
 * endpoint returns the exact `fields` it signed, and this function posts
 * precisely those plus the file. Cloudinary rejects any parameter it receives
 * that was not signed, so a hand-assembled form drifts out of sync with the
 * signature the moment anyone adds a param on one side only — which is exactly
 * how one app in the suite shipped a photo upload that never worked. Here the
 * signed set and the sent set are the same object, so they cannot diverge.
 *
 * @param {File|Blob} file
 * @param {object} options
 * @param {string} options.signatureUrl endpoint built by `createSignatureHandler`
 * @param {AbortSignal} [options.signal]
 * @param {RequestInit} [options.signatureInit] e.g. a POST body for the signature call
 * @returns {Promise<{url, publicId, format, bytes, width, height, resourceType}>}
 */
export async function uploadDirect(file, { signatureUrl, signal, signatureInit } = {}) {
  if (!file) throw new Error('No file provided');
  if (!signatureUrl) throw new Error('No signatureUrl provided');

  const signatureRes = await fetch(signatureUrl, {
    credentials: 'same-origin',
    signal,
    ...signatureInit,
  });

  if (!signatureRes.ok) {
    const body = await signatureRes.json().catch(() => ({}));
    throw new Error(body?.error || 'Could not start the upload');
  }

  const { uploadUrl, fields, resourceType } = await signatureRes.json();
  if (!uploadUrl || !fields) throw new Error('Malformed upload signature');

  const formData = new FormData();
  formData.append('file', file);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) formData.append(key, String(value));
  }

  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData, signal });

  if (!uploadRes.ok) {
    const body = await uploadRes.json().catch(() => ({}));
    throw new Error(body?.error?.message || 'Cloudinary upload failed');
  }

  const result = await uploadRes.json();

  return {
    url: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    resourceType: result.resource_type || resourceType || 'image',
  };
}
