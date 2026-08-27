import { isCloudinaryConfigured } from './config.js';
import { buildSignedUpload, generatePublicId } from './sign.js';

/**
 * Build the `/api/.../cloudinary-signature` route for an app.
 *
 * The one thing this factory does NOT decide is who the caller is or what they
 * are allowed to write to. That is `resolveOwner`'s job, and it stays in the
 * app because it is the only part that genuinely differs:
 *
 *   - CookBook, DoIt, RunCoach, Tutor App — the owner is the signed-in user.
 *   - GolfSoc — the owner is a society, and membership must be verified first.
 *     A society's assets are collaborative by design: the event organiser has
 *     to be able to replace a photo another member uploaded.
 *
 * Everything after that point — rate limiting, config checks, folder assembly,
 * signing, and the response shape — is identical everywhere, so it lives here.
 *
 * @param {object}   options
 * @param {Function} options.resolveOwner  async (req, res) => { folder, id } | null.
 *   Return null (having sent your own response) to deny. Throw to 500.
 * @param {string}   [options.label]       public-id prefix, e.g. 'recipe'.
 * @param {string}   [options.format]      signed format. Defaults to 'jpg'.
 * @param {string}   [options.resourceType] 'image' | 'video' | 'raw'.
 * @param {object|Function} [options.params] extra SIGNED upload params, e.g.
 *   `{ transformation: 'c_limit,w_1600,q_auto,f_auto' }`. Anything put here is
 *   signed and sent; nothing else ever is.
 * @param {Function} [options.rateLimit]   (ownerId) => ({ allowed: boolean }).
 */
export function createSignatureHandler({
  resolveOwner,
  label = 'upload',
  format = 'jpg',
  resourceType = 'image',
  params,
  rateLimit,
} = {}) {
  if (typeof resolveOwner !== 'function') {
    throw new Error('[aspiro-media] createSignatureHandler needs a resolveOwner function');
  }

  return async function cloudinarySignatureHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    if (!isCloudinaryConfigured()) {
      // Deliberately explicit: a missing env var is by far the most common
      // cause of "uploads stopped working", and it is invisible otherwise.
      console.error('[aspiro-media] Cloudinary env vars missing');
      return res.status(500).json({ error: 'Cloudinary is not configured' });
    }

    let owner;
    try {
      owner = await resolveOwner(req, res);
    } catch (error) {
      console.error('[aspiro-media] resolveOwner threw:', error?.message || error);
      return res.status(500).json({ error: 'Failed to resolve upload target' });
    }

    // A denial normally means resolveOwner already sent its own response — a 401
    // for "not signed in", a 403 for "not a member of this society". Check both
    // flags: `headersSent` is the standard signal and is set as soon as the
    // response starts, while `writableEnded` only becomes true once it is fully
    // finished. Testing just one of them can overwrite a reply that was already
    // on its way, turning a precise 401 into a generic 403.
    if (!owner) {
      if (res.headersSent || res.writableEnded) return undefined;
      return res.status(403).json({ error: 'Not allowed' });
    }
    if (!owner.folder) {
      console.error('[aspiro-media] resolveOwner returned no folder');
      return res.status(500).json({ error: 'Failed to resolve upload target' });
    }

    if (rateLimit && owner.id) {
      const { allowed } = (await rateLimit(owner.id)) || {};
      if (!allowed) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
      }
    }

    const extraParams = typeof params === 'function' ? await params(req, owner) : params;

    try {
      const payload = buildSignedUpload({
        folder: owner.folder,
        publicId: generatePublicId(label),
        format,
        resourceType,
        params: extraParams || {},
      });
      return res.status(200).json(payload);
    } catch (error) {
      console.error('[aspiro-media] failed to sign upload:', error?.message || error);
      return res.status(500).json({ error: 'Failed to generate upload signature' });
    }
  };
}
