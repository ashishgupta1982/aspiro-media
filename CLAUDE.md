# @aspiro/media

The suite's Cloudinary layer. One account serves every app, so this package owns
the upload signature, the delete boundary and the folder scheme that keeps one
app's assets out of another's. Plain JavaScript, ESM, no React, no build step —
apps install it straight from a git tag.

## Read this first — three docs, three jobs

| You are doing | Read |
|---|---|
| Deciding how media *should* work across the suite | vault `40-Areas/Indie-Dev/10-Foundations/Foundations-Media.md` |
| Calling this package from an app | `README.md` — the API, worked examples, migration steps |
| Changing this package | this file |

**The vault holds the why, the README holds the how, and neither should be
restated here.** A copy is the thing that goes stale silently.

## Editing this package changes nothing on its own

**Apps do not consume `master`. They pin a tagged tarball**, so a fix here
reaches an app only when a tag is cut *and* that app's pin is bumped:

```jsonc
"@aspiro/media": "https://github.com/ashishgupta1982/aspiro-media/archive/refs/tags/v0.6.0.tar.gz"
```

Never `github:owner/repo` — an unpinned ref means two apps installing on
different days get different code with no record of it.

**Read the live pins rather than trusting any list**, including one written
here:

```bash
grep -h '"@aspiro/media"' ../*/package.json
```

Those pins drift, and a fix that matters — the name-collision IDOR, say — is not
deployed anywhere still sitting on an older tag. **When you fix something
security-shaped, say plainly which apps are behind it.** Bumping them is a
separate, deliberate job per app: it is a dependency change in a live product,
not housekeeping.

## Releasing

1. Change the code; add or update a test under `test/`.
2. Bump `version` in `package.json`. Patch for a fix, minor for anything an app
   can call that it could not before.
3. Commit, then `git tag vX.Y.Z && git push && git push --tags`. **The tag is
   the release** — without it the tarball URL 404s.
4. Bump the consuming app's pin only when that app is actually being worked on.

## Layout

```
src/
├── index.js      pure helpers, safe anywhere
├── folder.js     the folder scheme + ownedPrefixes
├── file.js       public-id and filename handling
├── url.js        delivery URL building
├── server/       createSignatureHandler, uploadBuffer, deletes — needs the SDK
├── client/       uploadDirect — browser only (fetch, FormData, XHR progress)
└── presets/      named transformation sets
test/             node:test, run with `npm test`
```

**Four entry points, and the split is load-bearing:** `@aspiro/media`,
`/server`, `/client`, `/presets`. Importing `/server` from a component pulls the
Cloudinary SDK into the client bundle. The only peer dependency is `cloudinary`,
and only `/server` needs it.

## Rules that must not be undone

Each of these was arrived at the expensive way.

- **Folders are keyed on the user's immutable id, never a display name.** The
  old `sanitized-name || id` scheme meant two users sharing a display name
  shared a folder and passed each other's ownership check — a live IDOR — and a
  rename orphaned everything a user had uploaded.
- **Nothing is renamed.** `ownedPrefixes(..., { includeLegacyName: true })`
  returns the id folder *and* the legacy name folder so old assets stay
  deletable. Migrating them would mean rewriting stored URLs across fifteen
  collections non-transactionally. Decided against, deliberately.
- **Never build the upload form by hand.** Cloudinary rejects any parameter it
  receives that was not signed, so a hand-assembled form drifts out of sync with
  the signature the moment anyone adds a param on one side. The route returns
  the exact `fields` it signed and `uploadDirect` posts precisely those — that
  is what makes the Invalid Signature bug unrepresentable. New upload params go
  in the route's `params`, never client-side.
- **SSRF guards stay in the apps.** v0.2.0 put `uploadFromUrl` and `safeFetch`
  in here; v0.3.0 took them back out. Fetching a URL is not a media operation,
  and one need does not justify an `@aspiro/utils`. The duplication is accepted
  — don't re-propose moving it. `uploadBuffer` (bytes in, asset out) stays,
  because that unambiguously is media.
- **The owner type varies; the algorithm does not.** That is what
  `createSignatureHandler`'s `resolveOwner` hook is for. It returns `null`
  *after sending its own response* to deny.
- **A signed transformation string is versioned by its own text.** Changing
  `documentScan` does not just look different — it breaks uploads signed against
  the old string.

## Ownership is per app, and the app's code is the record

Most apps scope to the signed-in user. Two do not, on purpose:

- **GolfSoc** stores per user at `golfsoc/<userId>/…` but scopes *deletes* to
  the app prefix, because authority comes from the `create_event` permission on
  the record — an organiser must be able to delete an event whose photo another
  member uploaded. See `golfsoc/src/lib/cloudinaryOwnership.js`.
- **Tutor App** keeps `tutor-app/<user>/<date>_<title>` folders and checks
  ownership on the record. The per-exam nesting is what makes a whole-folder
  delete safe. Don't re-key it for consistency.

Both are the same model: the folder is a namespace, the record's permission
check is the security boundary. The prefix still matters — it stops a bug here
reaching another app's files in the shared account.

## Gotchas

- **Cloudinary prefixes are case-sensitive.** Every app prefix is lowercase and
  must stay that way; existing assets do not move.
- **`npm test` is `node:test`** — no framework, no watch mode.
- **This package ships no React**, so a consuming app needs no
  `transpilePackages` entry and no Tailwind content glob for it.
