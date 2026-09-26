/**
 * Canonical host + path handling for Search Console.
 *
 * - HTTP / www → one-hop 301 to https://letyourpassionschooseyou.com
 * - Same-host /index.html stays 200 (no redirect) so GSC does not flag
 *   "Page with redirect"
 * - /404.html, /404, /404/ return a real 404 (Cloudflare's html_handling
 *   otherwise 307s them into a soft-200)
 * - /sitemap.xml is rewritten to sitemap-index.xml at 200
 */
const CANONICAL_HOST = 'letyourpassionschooseyou.com';

const NOT_FOUND_PATHS = new Set(['/404', '/404/', '/404.html']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Merge extra headers into an upstream response without consuming its body. */
function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Static assets are content-hashed by Astro → safe to cache immutably. */
function cacheControlFor(pathname) {
  if (pathname.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/fonts/')) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }
  if (pathname === '/favicon.svg') return 'public, max-age=86400';
  if (pathname.endsWith('.html') || pathname === '/' || pathname === '') {
    return 'public, max-age=0, must-revalidate';
  }
  return null;
}

/** Collapse /index.html → / when building an off-host redirect target (one hop). */
function directoryPath(pathname) {
  if (pathname === '/index.html' || pathname.endsWith('/index.html')) {
    const next = pathname.slice(0, -'index.html'.length);
    return next === '' ? '/' : next;
  }
  return pathname;
}

function canonicalLocation(url) {
  const host = url.hostname.toLowerCase();
  const needsHttps = url.protocol === 'http:';
  const needsApex = host === `www.${CANONICAL_HOST}`;

  if (!needsHttps && !needsApex && host === CANONICAL_HOST) {
    return null;
  }

  const pathname = directoryPath(url.pathname);
  return new URL(pathname + url.search, `https://${CANONICAL_HOST}`).toString();
}

async function fetchAsset(env, request, url) {
  // With html_handling=none, "/" does not auto-map to index.html.
  const asset =
    url.pathname === '/' || url.pathname === ''
      ? await env.ASSETS.fetch(new URL('/index.html', url.origin))
      : await env.ASSETS.fetch(request);

  const extra = { ...SECURITY_HEADERS };
  const cacheControl = cacheControlFor(url.pathname);
  if (cacheControl) extra['Cache-Control'] = cacheControl;
  return withHeaders(asset, extra);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const location = canonicalLocation(url);
    if (location) {
      const redirect = Response.redirect(location, 301);
      return withHeaders(redirect, SECURITY_HEADERS);
    }

    // Serve the 404 document with a real 404 — never 200 or a client redirect.
    if (NOT_FOUND_PATHS.has(url.pathname)) {
      const asset = await env.ASSETS.fetch(new URL('/404.html', url.origin));
      const headers = new Headers(asset.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        headers.set(key, value);
      }
      return new Response(asset.body, {
        status: 404,
        statusText: 'Not Found',
        headers,
      });
    }

    // Common crawler target — serve at 200 (no redirect chain).
    if (url.pathname === '/sitemap.xml') {
      const sitemapAsset = await env.ASSETS.fetch(
        new URL('/sitemap-index.xml', url.origin)
      );
      return withHeaders(sitemapAsset, SECURITY_HEADERS);
    }

    return fetchAsset(env, request, url);
  },
};
