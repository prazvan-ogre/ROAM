// R1 (2026-09-05 review, closure batch): the creator-account routes
// authenticate purely off an httpOnly session cookie (src/lib/security/
// session.ts) sent automatically by the browser on same-origin AND
// cross-origin requests alike -- `sameSite: "lax"` blocks the cookie on a
// cross-site GET navigation and on cross-site XHR/fetch, but NOT on a
// cross-site POST/PATCH/DELETE made via a plain HTML <form> (a "lax"
// cookie still rides along on a top-level form submission, which is
// exactly the classic CSRF vector) nor via `fetch(..., {mode: "no-cors"})`
// with a `text/plain` body carrying a JSON string (bypasses CORS
// preflight, and this app's route handlers parse the body with
// `request.json()`, which does not check Content-Type). SameSite=Lax
// alone is not a complete CSRF defense for this app's own state-changing
// routes -- this fills that gap with an Origin/Referer check, the
// standard defense when a double-submit CSRF token isn't in use.
//
// Verifies the request's OWN claimed origin (from the Origin header, or
// Referer as a fallback for the rare legitimate request missing Origin)
// matches the Host header of the request actually being served. Host
// reflects the destination the browser is connecting to and is not
// influenced by which page initiated the request; Origin/Referer reflect
// the initiating page and are set by the browser itself for a real
// user's request, not overridable by an attacker's page's own script.
// Comparing the two -- rather than hardcoding a single expected domain --
// works unmodified across preview deployments, custom domains, and local
// dev, with no extra configuration.
export function isSameOriginRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const claimedOrigin = origin ?? referer;
  // Fail closed: a real browser always sends at least one of these on a
  // cross-site or same-site POST/PATCH/DELETE. Their total absence is not
  // a normal same-origin browser request.
  if (!claimedOrigin) return false;

  try {
    return new URL(claimedOrigin).host === host;
  } catch {
    return false;
  }
}
