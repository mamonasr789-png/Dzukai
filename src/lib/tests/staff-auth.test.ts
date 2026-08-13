/**
 * Staff auth: password hashing (node:crypto scrypt) and HMAC-signed session
 * tokens, mirroring the ai-waiter table-token tests.
 * Run: node --experimental-strip-types src/lib/tests/staff-auth.test.ts
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

const { hashPassword, verifyPassword } = await import("../server/auth/password.ts");
const { signStaffSession, verifyStaffSession } = await import("../server/auth/session.ts");

const SECRET = "a".repeat(32);

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

describe("staff session tokens", () => {
  it("round-trips a signed session", () => {
    const token = signStaffSession(
      { accountId: "acc_1", username: "virtuve1", role: "kitchen" },
      SECRET
    );
    const result = verifyStaffSession(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.role).toBe("kitchen");
      expect(result.payload.username).toBe("virtuve1");
    }
  });

  it("rejects a token signed with a different secret", () => {
    const token = signStaffSession(
      { accountId: "acc_1", username: "virtuve1", role: "kitchen" },
      SECRET
    );
    const result = verifyStaffSession(token, "b".repeat(32));
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = signStaffSession(
      { accountId: "acc_1", username: "virtuve1", role: "kitchen" },
      SECRET
    );
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        version: 1,
        accountId: "acc_1",
        username: "virtuve1",
        role: "admin",
        expiresAt: 9_999_999_999,
      })
    ).toString("base64url");
    const result = verifyStaffSession(`${forgedPayload}.${signature}`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired session", () => {
    const issuedInThePast = () => Date.now() - 40 * 24 * 60 * 60 * 1_000;
    const token = signStaffSession(
      { accountId: "acc_1", username: "virtuve1", role: "kitchen" },
      SECRET,
      issuedInThePast
    );
    const result = verifyStaffSession(token, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing or empty token", () => {
    expect(verifyStaffSession(undefined, SECRET).ok).toBe(false);
    expect(verifyStaffSession("", SECRET).ok).toBe(false);
  });
});

printResults();
