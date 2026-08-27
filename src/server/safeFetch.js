import dns from 'dns';

/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 *
 * Any route that takes a URL from a request and fetches it is an SSRF hole
 * unless it checks where that URL actually points. The interesting targets are
 * not exotic: `http://169.254.169.254/` is cloud instance metadata, and
 * `http://127.0.0.1:<port>/` is whatever else the box is running.
 *
 * Ported from CookBook, which had this and used it for recipe URL imports.
 * DoIt's image-from-URL route had no equivalent, which is exactly the pattern
 * this package exists to stop: one app solves a problem and the others never
 * hear about it.
 *
 * Not fully DNS-rebinding-proof — Node's fetch resolves the host again itself,
 * so a name that returns a public address here and a private one microseconds
 * later can slip through. It closes the direct-private-URL and
 * redirect-into-private holes, which is the realistically exploitable surface.
 */

const dnsLookup = dns.promises.lookup;

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3];
}

function isPrivateV4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable, so treat as unsafe
  const inCidr = (base, bits) => {
    const b = ipv4ToInt(base);
    return b !== null && (n >>> (32 - bits)) === (b >>> (32 - bits));
  };
  return (
    inCidr('0.0.0.0', 8) ||        // "this" network
    inCidr('10.0.0.0', 8) ||       // private
    inCidr('100.64.0.0', 10) ||    // carrier-grade NAT
    inCidr('127.0.0.0', 8) ||      // loopback
    inCidr('169.254.0.0', 16) ||   // link-local, incl. cloud metadata
    inCidr('172.16.0.0', 12) ||    // private
    inCidr('192.0.0.0', 24) ||     // IETF protocol assignments
    inCidr('192.168.0.0', 16) ||   // private
    inCidr('198.18.0.0', 15) ||    // benchmarking
    inCidr('224.0.0.0', 4) ||      // multicast
    inCidr('240.0.0.0', 4)         // reserved
  );
}

function isPrivateV6(ip) {
  const a = ip.toLowerCase();
  if (a === '::1' || a === '::') return true;
  // fe80::/10 link-local
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
  // fc00::/7 unique-local
  if (a.startsWith('fc') || a.startsWith('fd')) return true;
  const mapped = a.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

/** Pure, no DNS — exported so it can be unit tested. */
export function isPrivateAddress(address, family) {
  return family === 6 ? isPrivateV6(address) : isPrivateV4(address);
}

/** Resolve a URL and throw unless every address it points at is public. */
export async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  const addresses = await dnsLookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error('Host did not resolve');

  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new Error('URL resolves to a private or reserved address');
    }
  }

  return url;
}

/**
 * fetch() that re-validates every redirect hop.
 *
 * Following redirects automatically would undo the check: a perfectly public
 * URL is free to 302 straight to the metadata endpoint.
 */
export async function safeFetch(rawUrl, options = {}, maxRedirects = 5) {
  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // eslint-disable-next-line no-await-in-loop
    await assertSafeUrl(url);
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, { ...options, redirect: 'manual' });
    const location = res.headers.get('location');
    const isRedirect = res.status >= 300 && res.status < 400 && location;
    if (!isRedirect) return res;
    url = new URL(location, url).toString();
  }
  throw new Error('Too many redirects');
}
