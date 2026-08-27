# @aspiro/media

Shared Cloudinary media handling for the Aspiro app suite: signed direct
uploads, ownership-scoped deletion, and the URL helpers everything else depends
on.

Sibling to [`@aspiro/auth`](https://github.com/ashishgupta1982/aspiro-auth).
Install it; don't clone another app.

## Why this exists

Six apps each grew their own Cloudinary layer — about 2,000 lines across 25
files. Most of it was the same code with a different string in it: the folder
helper differed across three apps by a single literal and some comments. But
where the copies *did* drift, they drifted on the two things that fail silently.

**Public-id extraction.** Three implementations, each wrong in a different way.
One could not cross the slashes in a foldered public id, so it returned `null`
for every asset and deletion silently removed nothing — 1,636 orphaned files and
128 MB before anyone noticed. Another required a version segment. A third folded
transformation segments into the id.

**The signed-vs-sent invariant.** Cloudinary validates the signature against
every parameter it receives. Send one you did not sign and the upload is
rejected. One app documented this carefully in a comment; another appended an
unsigned `quality` param and its photo upload never worked once, from the day it
shipped.

Both are now impossible rather than documented — see `uploadDirect` below.

## Install

```jsonc
// package.json
"dependencies": {
  "@aspiro/media": "https://github.com/ashishgupta1982/aspiro-media/archive/refs/tags/v0.4.0.tar.gz",
  "cloudinary": "^2.10.0"
}
```

Pin the tag. Never `github:owner/repo` — npm rewrites that to `git+ssh://`,
which fails on Vercel.

This package ships no React, so it needs no `transpilePackages` and no Tailwind
content glob.

## Entry points

| Import | Contains | Safe in the browser |
|---|---|---|
| `@aspiro/media` | URL + folder + file helpers, all pure | yes |
| `@aspiro/media/server` | signing, the route factory, deletion, server-side upload | no — pulls the SDK |
| `@aspiro/media/client` | `uploadDirect`, `extractFrames` | browser only |
| `@aspiro/media/presets` | opt-in transformations | yes |

Keep the split. Importing `/server` from a component drags the Cloudinary SDK
into the client bundle.

## Environment

```
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

All six apps already use these exact names, so there is nothing to migrate.

## The ownership model

One Cloudinary account serves every app. **The folder is the only boundary** —
between apps, and between users inside an app. Two rules follow.

**1. Folders are keyed on an immutable id, never a display name.**

The original helper used `sanitized-display-name || id`. That has two failure
modes which only appear in production:

- A user renames themselves, their folder changes, and every asset they already
  own falls outside the new prefix — undeletable, orphaned forever.
- **Two users with the same display name share a folder.** Google account names
  are not unique. Two people called Jane Smith both resolve to
  `CookBook/Jane-Smith`, and each then passes the ownership check on the other's
  files. A live IDOR.

`ownerFolder()` therefore takes an id and refuses to run without one.

**2. Existing assets stay reachable.** Nothing is renamed — renaming would mean
rewriting every stored URL across 15 collections, non-transactionally, with
broken images as the failure mode. Instead
`ownedPrefixes(..., { includeLegacyName: true })` returns *both* the id folder
and the old name-derived one, so new uploads land in the id folder while old
files remain deletable. Drop the flag once an app has no legacy assets left.

### Who the owner is differs; the algorithm does not

- **CookBook, DoIt, RunCoach, Tutor App** — the owner is the signed-in user.
- **GolfSoc** — the owner is a *society*, and membership is verified first.
  Society assets are collaborative by design: the event organiser must be able
  to replace a photo another member uploaded. Per-user folders would break that.

Both are "resolve an owner, derive a folder from verified data, prefix-check
every delete". That is why `createSignatureHandler` takes a `resolveOwner` hook
rather than assuming a session shape.

## Uploading

### The route

```js
// pages/api/cloudinary-signature.js
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { createSignatureHandler } from '@aspiro/media/server';
import { ownerFolder } from '@aspiro/media';
import { STORE_LIMIT } from '@aspiro/media/presets';
import { checkRate } from '../../utils/rateLimiter';

export default createSignatureHandler({
  label: 'recipe',
  params: { transformation: STORE_LIMIT },
  rateLimit: (id) => checkRate(id, 'STANDARD_API'),
  resolveOwner: async (req, res) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return null; }

    const id = session.userId || session.user?.id;
    if (!id) { res.status(401).json({ error: 'No user ID in session' }); return null; }

    return { id, folder: ownerFolder('CookBook', { id }) };
  },
});
```

`resolveOwner` returns `null` **after sending its own response** to deny. Return
`{ id, folder }` to allow.

### The client

```js
import { uploadDirect } from '@aspiro/media/client';

const { url, publicId } = await uploadDirect(file, {
  signatureUrl: '/api/cloudinary-signature',
});
```

**Do not build the form yourself.** The route returns the exact `fields` it
signed and `uploadDirect` posts precisely those plus the file, so the signed set
and the sent set are the same object and cannot drift. Anything an upload needs
— a transformation, a format — goes in the route's `params`, where it is signed.
That is the whole mechanism preventing the Invalid Signature class of bug;
appending a param on the client reintroduces it.

## Deleting

```js
import { deleteOwned } from '@aspiro/media/server';
import { ownedPrefixes } from '@aspiro/media';

const prefixes = ownedPrefixes(
  'CookBook',
  { id: userId, name: session.user?.name },
  { includeLegacyName: true }
);

const { deleted, notFound, rejected } = await deleteOwned({
  publicIds,        // images
  videoPublicIds,   // videos — SEPARATE, see below
  prefixes,
});
```

Images and videos must be deleted in separate calls with the correct
`resource_type`. **Deleting a video as an image reports success and removes
nothing** — a silent no-op that leaves the asset billing forever. `deleteOwned`
handles the split; pass the two lists.

For apps whose ownership check lives on the record rather than the folder —
Tutor App confirms a revision list belongs to the caller, then removes the whole
folder — use `deleteFolder(path, { prefixes })`. It still requires the prefixes,
so an upstream bug cannot hand it another app's folder.

## Server-side uploads

When the bytes are already on the server — an image fetched from a URL, a frame
rendered server-side — use `uploadBuffer`:

```js
import { uploadBuffer } from '@aspiro/media/server';

await uploadBuffer(buffer, { folder, publicId, transformation: [...] });
```

**Fetching the URL is the app's job, not this package's**, and it needs an SSRF
guard: any route that fetches a user-supplied URL server-side can be pointed at
`169.254.169.254` for cloud instance metadata, or at anything else listening on
localhost. Guard the URL, then hand the bytes here. CookBook's
`src/lib/ssrfGuard.js` is the reference implementation — `assertSafeUrl` plus a
`safeFetch` that re-validates every redirect hop, because a public URL is
otherwise free to 302 straight into an internal one.

That guard deliberately stays in the apps. It is not a media concern, and there
is no shared utility package to put it in; when one exists it belongs there, not
here.

## Presets

Opt-in. Nothing here applies unless an app asks for it.

```js
import { IMAGE_PRESETS, sizedTransform, STORE_LIMIT,
         documentScanTransformations } from '@aspiro/media/presets';
import { transformUrl } from '@aspiro/media';

transformUrl(recipe.photo, IMAGE_PRESETS.card);
```

`IMAGE_PRESETS` covers `thumb` / `card` / `hero` / `og`. The `og` preset is
deliberately `f_jpg` and not `f_auto`: WhatsApp's iOS scraper is unreliable with
WebP and AVIF and shows no preview at all rather than falling back.

`documentScanTransformations()` is Tutor App's pipeline for photographed
handwritten exam papers — resize, brightness, contrast, denoise, sharpen,
greyscale, progressive JPEG. Strong and opinionated; greyscale is right for
handwriting and wrong for a recipe photo. Every parameter is overridable.

`extractFrames()` (client) pulls stills out of a video via canvas, from
RunCoach's gait analysis. Almost none of it is about running — the hard parts
are seeking reliably across browsers, knowing when a video is genuinely ready to
draw, and not hanging when it never becomes ready.

## Migrating an app

1. Add the dependency and `cloudinary`.
2. Replace the signature route with `createSignatureHandler`.
3. Replace the upload helper with `uploadDirect`, and move any extra upload
   params into the route's `params`.
4. Replace the delete route's hand-rolled prefix check with `deleteOwned`.
5. Replace local URL helpers with the shared ones. This is where the real bugs
   were, so delete the local copies rather than leaving them alongside.
6. Keep `includeLegacyName: true` until the app has no name-foldered assets.
7. Check every bare import resolves. **`next lint` does not resolve imports** — a
   missing peer dependency passes lint and fails the build.
8. Reconcile after deploying:
   `Command_Center/scripts/check-cloudinary-orphans.mjs` reports assets stored
   versus assets referenced, per app. Run it before and after — the counts should
   not move.

## As built, per app

| App | Notes |
|---|---|
| CookBook | First migration. Has legacy name-foldered assets, so `includeLegacyName: true`. |
| DoIt | Signs a `transformation` so stored images are capped at 1600px. Fetches its image-from-URL bytes behind its own SSRF guard, then calls `uploadBuffer`. |

## Tests

```bash
npm test
```

Covers the URL parsing and ownership logic, including regression tests for each
of the three historic public-id bugs and for the name-collision IDOR.
