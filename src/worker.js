/**
 * Canonical host enforcement for Search Console.
 * HTTP and www variants 301 to https://letyourpassionschooseyou.com
 * so Google stops treating them as "Alternate page with proper canonical tag".
 */
const CANONICAL_HOST = 'letyourpassionschooseyou.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const needsHttps = url.protocol === 'http:';
    const needsApex = host === `www.${CANONICAL_HOST}`;

    if (needsHttps || needsApex) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
