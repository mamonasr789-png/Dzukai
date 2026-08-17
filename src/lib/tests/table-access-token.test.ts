/**
 * Table-access tokens: signed table QR links, deliberately without expiry
 * (unlike staff sessions / the AI-waiter's own table tokens — see
 * src/lib/server/tableAccessToken.ts's doc comment for why).
 * Run: node --experimental-strip-types src/lib/tests/table-access-token.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");

const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnlyPath = require0.resolve("server-only");
require0.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
};

const { signTableAccessToken, verifyTableAccessToken } = await import(
  "../server/tableAccessToken.ts"
);

const SECRET = "a".repeat(32);

describe("table access tokens", () => {
  it("round-trips a signed token", () => {
    const token = signTableAccessToken("5", SECRET);
    const result = verifyTableAccessToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tableNumber).toBe("5");
    }
  });

  it("rejects a token signed with a different secret", () => {
    const token = signTableAccessToken("5", SECRET);
    const result = verifyTableAccessToken(token, "b".repeat(32));
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = signTableAccessToken("5", SECRET);
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ version: 1, tableNumber: "999" })
    ).toString("base64url");
    const result = verifyTableAccessToken(`${forgedPayload}.${signature}`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing or empty token", () => {
    expect(verifyTableAccessToken(undefined, SECRET).ok).toBe(false);
    expect(verifyTableAccessToken("", SECRET).ok).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifyTableAccessToken("not-a-real-token", SECRET).ok).toBe(false);
    expect(verifyTableAccessToken("a.b.c", SECRET).ok).toBe(false);
  });

  it("stays valid indefinitely — no expiry field exists", () => {
    // Round-trip a token, then verify it again "later" (there's no now()
    // parameter to fast-forward, because there's nothing time-based to check).
    const token = signTableAccessToken("12", SECRET);
    expect(verifyTableAccessToken(token, SECRET).ok).toBe(true);
    expect(verifyTableAccessToken(token, SECRET).ok).toBe(true);
  });
});

printResults();
