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
 * @param {Function} [options.onProgress] (percent 0-100) => void. Supplying this
 *   switches the upload to XMLHttpRequest, the only way to observe upload
 *   progress in a browser — fetch reports nothing until the response arrives.
 *   Worth it for anything large: a phone uploading a video or a scanned PDF
 *   otherwise sits on a dead-looking spinner for the whole transfer.
 * @returns {Promise<{url, publicId, format, bytes, width, height, resourceType}>}
 */
export async function uploadDirect(file, { signatureUrl, signal, signatureInit, onProgress } = {}) {
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

  // Only the progress path uses XHR. fetch stays the default so apps already
  // on it keep exactly the behaviour they have.
  const result = onProgress
    ? await postWithProgress(uploadUrl, formData, onProgress, signal)
    : await postWithFetch(uploadUrl, formData, signal);

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

async function postWithFetch(uploadUrl, formData, signal) {
  const res = await fetch(uploadUrl, { method: 'POST', body: formData, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || 'Cloudinary upload failed');
  }
  return res.json();
}

function postWithProgress(uploadUrl, formData, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Upload was aborted'));

    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.addEventListener('progress', (event) => {
      // Not every transfer reports a total; report nothing rather than NaN.
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      cleanup();
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error(`Upload failed (${xhr.status}) with an unreadable response`));
      }
      if (xhr.status === 200) resolve(body);
      else reject(new Error(body?.error?.message || `Cloudinary upload failed (${xhr.status})`));
    });

    xhr.addEventListener('error', () => { cleanup(); reject(new Error('Network error during upload')); });
    xhr.addEventListener('abort', () => { cleanup(); reject(new Error('Upload was aborted')); });

    xhr.open('POST', uploadUrl);
    xhr.send(formData);
  });
}
