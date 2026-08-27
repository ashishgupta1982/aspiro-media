import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPublicId, extractFormat, extractResourceType, isCloudinaryUrl, transformUrl,
  ownerFolder, ownedPrefixes, isOwnedBy, sanitizeSegment, isLikelyImageFile,
} from '../src/index.js';

const BASE = 'https://res.cloudinary.com/demo';

test('extractPublicId crosses folder slashes', () => {
  assert.equal(
    extractPublicId(`${BASE}/image/upload/v1712/CookBook/abc123/recipe-1.jpg`),
    'CookBook/abc123/recipe-1'
  );
});

test('extractPublicId works without a version segment', () => {
  assert.equal(
    extractPublicId(`${BASE}/image/upload/CookBook/abc123/recipe-1.jpg`),
    'CookBook/abc123/recipe-1'
  );
});

test('extractPublicId strips transformation segments', () => {
  assert.equal(
    extractPublicId(`${BASE}/image/upload/c_fill,w_300/v1712/CookBook/abc/x.jpg`),
    'CookBook/abc/x'
  );
  assert.equal(
    extractPublicId(`${BASE}/image/upload/c_fill,w_300/e_grayscale/CookBook/abc/x.jpg`),
    'CookBook/abc/x'
  );
});

test('extractPublicId handles video and raw', () => {
  assert.equal(extractPublicId(`${BASE}/video/upload/v1/Runner-App/u/Videos/v1.mp4`), 'Runner-App/u/Videos/v1');
  assert.equal(extractPublicId(`${BASE}/raw/upload/v1/tutor-app/u/paper.pdf`), 'tutor-app/u/paper');
});

test('extractPublicId ignores query strings and non-Cloudinary input', () => {
  assert.equal(extractPublicId(`${BASE}/image/upload/v1/a/b.jpg?x=1`), 'a/b');
  assert.equal(extractPublicId('https://example.com/a.jpg'), null);
  assert.equal(extractPublicId(null), null);
});

test('format and resource type', () => {
  assert.equal(extractFormat(`${BASE}/image/upload/v1/a/b.JPG`), 'jpg');
  assert.equal(extractResourceType(`${BASE}/video/upload/v1/a/b.mp4`), 'video');
  assert.equal(extractResourceType('nonsense'), 'image');
  assert.equal(isCloudinaryUrl(`${BASE}/image/upload/v1/a.jpg`), true);
});

test('transformUrl inserts once and never twice', () => {
  const url = `${BASE}/image/upload/v1/a/b.jpg`;
  assert.equal(transformUrl(url, 'c_fill,w_300'), `${BASE}/image/upload/c_fill,w_300/v1/a/b.jpg`);
  // already transformed, comma-joined
  assert.equal(transformUrl(`${BASE}/image/upload/c_fill,w_300/v1/a/b.jpg`, 'c_fill,w_600'),
    `${BASE}/image/upload/c_fill,w_300/v1/a/b.jpg`);
  // already transformed, single op — the case CookBook's version missed
  assert.equal(transformUrl(`${BASE}/image/upload/w_500/v1/a/b.jpg`, 'c_fill,w_600'),
    `${BASE}/image/upload/w_500/v1/a/b.jpg`);
  assert.equal(transformUrl('https://example.com/a.jpg', 'c_fill'), 'https://example.com/a.jpg');
});

test('ownerFolder is keyed on id, never the display name', () => {
  assert.equal(ownerFolder('CookBook', { id: 'abc123', name: 'Jane Smith' }), 'CookBook/abc123');
  assert.throws(() => ownerFolder('CookBook', {}), /owner id is required/);
});

test('two users with the same name no longer collide', () => {
  const a = ownerFolder('CookBook', { id: 'user-1', name: 'Jane Smith' });
  const b = ownerFolder('CookBook', { id: 'user-2', name: 'Jane Smith' });
  assert.notEqual(a, b);
});

test('ownedPrefixes includes the legacy name folder only when asked', () => {
  const owner = { id: 'abc123', name: 'Jane Smith' };
  assert.deepEqual(ownedPrefixes('CookBook', owner), ['CookBook/abc123/']);
  assert.deepEqual(
    ownedPrefixes('CookBook', owner, { includeLegacyName: true }),
    ['CookBook/abc123/', 'CookBook/Jane-Smith/']
  );
});

test('ownedPrefixes does not duplicate when the name is empty', () => {
  const owner = { id: 'abc123', name: '   ' };
  assert.deepEqual(ownedPrefixes('CookBook', owner, { includeLegacyName: true }), ['CookBook/abc123/']);
});

test('sanitizeSegment matches the historic behaviour exactly', () => {
  assert.equal(sanitizeSegment('Jane Smith'), 'Jane-Smith');
  assert.equal(sanitizeSegment('  Jane   Smith  '), 'Jane-Smith');
  assert.equal(sanitizeSegment("O'Brien!"), 'OBrien');
  assert.equal(sanitizeSegment('李明'), '');
});

test('isOwnedBy requires the trailing slash boundary', () => {
  assert.equal(isOwnedBy('CookBook/12/a', ['CookBook/12/']), true);
  // the bug a missing slash would cause: user 12 reaching user 123's folder
  assert.equal(isOwnedBy('CookBook/123/a', ['CookBook/12/']), false);
  assert.equal(isOwnedBy('Other/12/a', ['CookBook/12/']), false);
  assert.equal(isOwnedBy(null, ['CookBook/12/']), false);
});

test('isLikelyImageFile accepts awkward mobile photos', () => {
  assert.equal(isLikelyImageFile({ type: 'image/jpeg', name: 'a.jpg' }), true);
  assert.equal(isLikelyImageFile({ type: '', name: 'IMG_0001.HEIC' }), true);
  assert.equal(isLikelyImageFile({ type: 'application/octet-stream', name: 'image' }), true);
  assert.equal(isLikelyImageFile({ type: 'application/pdf', name: 'a.pdf' }), false);
  assert.equal(isLikelyImageFile(null), false);
});

// ── The signature handler's denial path ───────────────────────────────────
import { createSignatureHandler } from '../src/server/index.js';

function mockRes() {
  const r = { statusCode: null, body: null, headers: {}, headersSent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

test('a denial preserves the resolver\'s own status code', async () => {
  const handler = createSignatureHandler({
    resolveOwner: async (req, res) => { res.status(401).json({ error: 'Unauthorized' }); return null; },
  });
  const res = mockRes();
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'k';
  process.env.CLOUDINARY_API_SECRET = 's';
  await handler({ method: 'GET' }, res);
  // Must stay 401 — a generic 403 here would mask why the upload was refused.
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('a silent denial still refuses', async () => {
  const handler = createSignatureHandler({ resolveOwner: async () => null });
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 403);
});

test('a wrong method is rejected before the owner is resolved', async () => {
  let resolved = false;
  const handler = createSignatureHandler({
    resolveOwner: async () => { resolved = true; return null; },
  });
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(resolved, false);
});
