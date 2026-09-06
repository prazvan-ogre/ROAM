// R1 regression (2026-09-05 review, closure batch): getClientIp
// (src/lib/security/ipRateLimit.ts) used to read only the first value of
// the generic x-forwarded-for header -- trustworthy on a standard Vercel
// deployment (which overwrites that header outright), but not something
// this function itself could ever verify, and NOT safe by name alone if
// an untrusted reverse proxy ever sits in front of the app and appends to
// (rather than overwrites) a client-supplied x-forwarded-for. Fixed to
// prefer x-vercel-forwarded-for -- Vercel's own dedicated, harder-to-
// spoof header -- falling back to plain x-forwarded-for/x-real-ip only
// when it's absent (non-Vercel environments, e.g. local dev).
import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/security/ipRateLimit";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/whatever", { headers });
}

describe("R1 regression: client IP provenance for rate limiting", () => {
  it("prefers x-vercel-forwarded-for over a plain x-forwarded-for when both are present", () => {
    const request = requestWithHeaders({
      "x-vercel-forwarded-for": "203.0.113.9",
      // A spoofed/attacker-controlled prefix an untrusted upstream proxy
      // might have left in place ahead of the real IP.
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("takes the first entry of x-vercel-forwarded-for when it is itself a list", () => {
    const request = requestWithHeaders({ "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to plain x-forwarded-for when x-vercel-forwarded-for is absent (e.g. local dev)", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "198.51.100.1" });
    expect(getClientIp(request)).toBe("198.51.100.1");
  });

  it("falls back to x-real-ip when neither forwarded-for header is present", () => {
    const request = requestWithHeaders({ "x-real-ip": "198.51.100.2" });
    expect(getClientIp(request)).toBe("198.51.100.2");
  });

  it("returns null when no IP-bearing header is present at all, rather than fabricating one", () => {
    const request = requestWithHeaders({});
    expect(getClientIp(request)).toBeNull();
  });
});
