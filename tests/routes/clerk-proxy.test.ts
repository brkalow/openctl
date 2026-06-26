import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  isClerkProxyEnabled,
  isClerkProxyRequest,
  handleClerkProxy,
} from "../../src/routes/clerk-proxy";

const server = {
  requestIP: () => ({ address: "203.0.113.7" }),
};

describe("clerk-proxy", () => {
  let originalFetch: typeof fetch;
  let lastRequest: { url: string; init: RequestInit } | null;

  beforeEach(() => {
    process.env.PUBLIC_CLERK_PROXY_URL = "https://openctl.dev/__clerk";
    process.env.CLERK_SECRET_KEY = "sk_test_abc123";
    delete process.env.CLERK_FAPI_URL;

    lastRequest = null;
    originalFetch = globalThis.fetch;
    // @ts-expect-error - test stub
    globalThis.fetch = async (url: string, init: RequestInit) => {
      lastRequest = { url, init };
      return new Response("upstream-body", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": "999",
          "x-clerk-foo": "bar",
        },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.PUBLIC_CLERK_PROXY_URL;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_FAPI_URL;
  });

  test("isClerkProxyRequest matches the proxy prefix only", () => {
    expect(isClerkProxyRequest("/__clerk")).toBe(true);
    expect(isClerkProxyRequest("/__clerk/v1/client")).toBe(true);
    expect(isClerkProxyRequest("/__clerkish")).toBe(false);
    expect(isClerkProxyRequest("/api/sessions")).toBe(false);
  });

  test("isClerkProxyEnabled requires proxy url and secret key", () => {
    expect(isClerkProxyEnabled()).toBe(true);
    delete process.env.CLERK_SECRET_KEY;
    expect(isClerkProxyEnabled()).toBe(false);
  });

  test("returns 503 when not configured", async () => {
    delete process.env.PUBLIC_CLERK_PROXY_URL;
    const res = await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client"),
      server,
    );
    expect(res.status).toBe(503);
  });

  test("forwards path and query to the FAPI host", async () => {
    await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client?foo=bar"),
      server,
    );
    expect(lastRequest?.url).toBe("https://frontend-api.clerk.dev/v1/client?foo=bar");
  });

  test("honors CLERK_FAPI_URL override and strips trailing slash", async () => {
    process.env.CLERK_FAPI_URL = "https://fapi.example.com/";
    await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/environment"),
      server,
    );
    expect(lastRequest?.url).toBe("https://fapi.example.com/v1/environment");
  });

  test("attaches Clerk proxy headers", async () => {
    await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client"),
      server,
    );
    const headers = lastRequest?.init.headers as Headers;
    expect(headers.get("Clerk-Proxy-Url")).toBe("https://openctl.dev/__clerk");
    expect(headers.get("Clerk-Secret-Key")).toBe("sk_test_abc123");
    expect(headers.get("X-Forwarded-For")).toBe("203.0.113.7");
    expect(headers.get("host")).toBeNull();
  });

  test("preserves an existing X-Forwarded-For chain", async () => {
    await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      }),
      server,
    );
    const headers = lastRequest?.init.headers as Headers;
    expect(headers.get("X-Forwarded-For")).toBe("198.51.100.1");
  });

  test("forwards POST body with duplex streaming", async () => {
    await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client/sign_ins", {
        method: "POST",
        body: "identifier=user@example.com",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      server,
    );
    expect(lastRequest?.init.method).toBe("POST");
    expect(lastRequest?.init.body).toBeDefined();
    // @ts-expect-error - duplex is a valid RequestInit field at runtime
    expect(lastRequest?.init.duplex).toBe("half");
    expect(lastRequest?.init.redirect).toBe("manual");
  });

  test("strips content-encoding/length from the response", async () => {
    const res = await handleClerkProxy(
      new Request("https://openctl.dev/__clerk/v1/client"),
      server,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    // Non hop-by-hop headers pass through untouched.
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-clerk-foo")).toBe("bar");
    expect(await res.text()).toBe("upstream-body");
  });
});
