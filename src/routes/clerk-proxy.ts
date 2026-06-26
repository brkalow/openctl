/**
 * Proxy for Clerk's Frontend API (FAPI).
 *
 * Forwards requests from `https://openctl.dev/__clerk/*` to Clerk's shared
 * Frontend API host, attaching the headers Clerk requires to identify the
 * instance. This lets the browser talk to Clerk through our own domain instead
 * of relying on a CNAME record.
 *
 * Docs: https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi
 *
 * Configuration (env):
 * - PUBLIC_CLERK_PROXY_URL: the public proxy URL, e.g. "https://openctl.dev/__clerk".
 *   Must exactly match the proxy URL configured in the Clerk Dashboard and the
 *   `proxyUrl` passed to ClerkProvider on the client.
 * - CLERK_SECRET_KEY: server-side Clerk secret, forwarded so Clerk can resolve
 *   the instance.
 * - CLERK_FAPI_URL (optional): override the upstream FAPI host. Defaults to
 *   Clerk's shared production endpoint.
 *
 * Note: proxying is a production-only Clerk feature and does not work with
 * development instances.
 */

/** Minimal view of Bun's Server we need: resolving the connecting peer's IP. */
type RequestIpResolver = {
  requestIP(req: Request): { address: string } | null;
};

/** Path prefix this proxy handles. */
export const CLERK_PROXY_PREFIX = "/__clerk";

/** Clerk's shared Frontend API host. */
const DEFAULT_FAPI_URL = "https://frontend-api.clerk.dev";

/** Upstream FAPI host, without a trailing slash. */
function fapiUrl(): string {
  return (process.env.CLERK_FAPI_URL || DEFAULT_FAPI_URL).replace(/\/$/, "");
}

/**
 * Whether the proxy is configured and should be mounted. Both the public proxy
 * URL and the secret key are required for Clerk to accept proxied requests.
 */
export function isClerkProxyEnabled(): boolean {
  return Boolean(process.env.PUBLIC_CLERK_PROXY_URL && process.env.CLERK_SECRET_KEY);
}

/** True if the request path targets the Clerk proxy. */
export function isClerkProxyRequest(pathname: string): boolean {
  return pathname === CLERK_PROXY_PREFIX || pathname.startsWith(`${CLERK_PROXY_PREFIX}/`);
}

/**
 * Forward a request to Clerk's Frontend API.
 *
 * Preserves the original method, body, and headers, and adds the three headers
 * Clerk requires: Clerk-Proxy-Url, Clerk-Secret-Key, and X-Forwarded-For.
 */
export async function handleClerkProxy(req: Request, server: RequestIpResolver): Promise<Response> {
  if (!isClerkProxyEnabled()) {
    return new Response("Clerk proxy not configured", { status: 503 });
  }

  const url = new URL(req.url);

  // Strip the "/__clerk" prefix; the remainder (including its leading slash) is
  // forwarded to the upstream FAPI host along with the original query string.
  const subPath = url.pathname.slice(CLERK_PROXY_PREFIX.length);
  const targetUrl = `${fapiUrl()}${subPath}${url.search}`;

  // Preserve all original headers, then add Clerk's required headers.
  const headers = new Headers(req.headers);
  // Drop Host so fetch sets it to the upstream host.
  headers.delete("host");
  headers.set("Clerk-Proxy-Url", process.env.PUBLIC_CLERK_PROXY_URL!);
  headers.set("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY!);

  // Forward the originating client IP. Preserve an existing forwarding chain if
  // present, otherwise use the connecting peer's address.
  const existingForwardedFor = req.headers.get("x-forwarded-for");
  const clientIp = server.requestIP(req)?.address;
  if (existingForwardedFor) {
    headers.set("X-Forwarded-For", existingForwardedFor);
  } else if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // Required by Bun/undici when streaming a request body.
    ...(hasBody ? { duplex: "half" } : {}),
    // Let Clerk rewrite redirect targets to the proxy URL; don't follow them here.
    redirect: "manual",
  } as RequestInit);

  // Bun's fetch transparently decompresses the response body, so the upstream
  // content-encoding/length no longer describe the bytes we forward. Strip them
  // and let the runtime recompute, otherwise the browser mis-decodes the body.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
