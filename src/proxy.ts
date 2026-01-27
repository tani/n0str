/**
 * Detects the external URL of the relay by checking various reverse proxy headers.
 * This ensures correct protocol (ws vs wss) and host detection when running behind
 * Cloudflare, NGINX, Apache, etc.
 *
 * @param req - The incoming HTTP request.
 * @returns The resolved external URL for the relay.
 */
export function getRelayUrl(req: Request): string {
  const url = new URL(req.url);

  // 1. Determine the protocol (ws/wss)
  // Check common reverse proxy headers for protocol identification
  const protoHeader =
    req.headers.get("x-forwarded-proto") || // Standard (most proxies including Cloudflare/NGINX)
    req.headers.get("x-forwarded-scheme") || // Some proxies use this
    (url.protocol.startsWith("https") ? "https" : "http");

  const wsProto = protoHeader.toLowerCase().startsWith("https") ? "wss" : "ws";

  // 2. Determine the host
  // Check common reverse proxy headers for host identification
  const host =
    req.headers.get("x-forwarded-host") || // Standard
    req.headers.get("x-original-host") || // IIS/Azure
    req.headers.get("host") || // Fallback if Host header is different
    url.host; // Ultimate fallback

  // 3. Reconstruct the URL
  // We keep the pathname to support relays running on subpaths
  return `${wsProto}://${host}${url.pathname}`;
}

/**
 * Normalizes an external URL for presentation (e.g. in the health check message).
 * Similar to getRelayUrl but returns a more "human readable" format if needed.
 */
export function getDisplayUrl(req: Request): string {
  const relayUrl = getRelayUrl(req);
  // Ensure trailing slash for display if it's the root
  return relayUrl.endsWith("/") ? relayUrl : relayUrl + "/";
}
