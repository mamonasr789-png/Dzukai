/**
 * Gemini function-schema sanitizer — locks in fixes found by real 400s from
 * the live API (not from docs):
 *   - "Unknown name exclusiveMinimum/const" — Gemini's function schema is a
 *     narrower OpenAPI 3.0 subset than the draft-7 JSON Schema Zod emits.
 *   - "schema produces a constraint that has too many states for serving" —
 *     fine-grained bounds (pattern/length/range) across many tools overwhelm
 *     Gemini's constrained-decoding grammar.
 * Run: NODE_ENV=test node --conditions=react-server --experimental-strip-types --test src/lib/ai-waiter/tests/gemini-schema.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnlyPath = require0.resolve("server-only");
require0.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
};

const { toGeminiSchema } = await import("../server/geminiProvider.ts");

test("strips constraint keywords Gemini's function schema rejects", () => {
  const out = toGeminiSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      price: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
      note: { type: "string", pattern: "^[a-z]+$", minLength: 1, maxLength: 200 },
      tags: { type: "array", minItems: 0, maxItems: 20, items: { type: "string" } },
    },
  }) as Record<string, unknown>;

  assert.equal(out.additionalProperties, undefined);
  const props = out.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.price.exclusiveMinimum, undefined);
  assert.equal(props.price.maximum, undefined);
  assert.equal(props.note.pattern, undefined);
  assert.equal(props.note.minLength, undefined);
  assert.equal(props.note.maxLength, undefined);
  assert.equal(props.tags.minItems, undefined);
  assert.equal(props.tags.maxItems, undefined);
});

test("converts a boolean const to a plain type, not an enum", () => {
  // Gemini's enum accepts strings only (confirmed by a 400: "Invalid value
  // ... TYPE_STRING" when enum:[true] was sent).
  const out = toGeminiSchema({ type: "boolean", const: true }) as Record<string, unknown>;
  assert.equal(out.const, undefined);
  assert.equal(out.enum, undefined);
  assert.equal(out.type, "boolean");
});

test("converts a string const to a single-value enum", () => {
  const out = toGeminiSchema({ type: "string", const: "fixed" }) as Record<string, unknown>;
  assert.equal(out.const, undefined);
  assert.deepEqual(out.enum, ["fixed"]);
});

test("folds a [type, null] array into nullable:true", () => {
  const out = toGeminiSchema({ type: ["string", "null"] }) as Record<string, unknown>;
  assert.equal(out.type, "string");
  assert.equal(out.nullable, true);
});

test("folds an anyOf null branch into nullable:true", () => {
  const out = toGeminiSchema({
    anyOf: [{ type: "object", properties: {} }, { type: "null" }],
  }) as Record<string, unknown>;
  assert.equal(out.nullable, true);
  assert.equal(out.anyOf, undefined);
  assert.equal(out.type, "object");
});

test("recurses into nested properties and array items", () => {
  const out = toGeminiSchema({
    type: "object",
    properties: {
      child: { type: "string", pattern: "^x$" },
      list: { type: "array", items: { type: "number", exclusiveMaximum: 5 } },
    },
  }) as Record<string, unknown>;
  const props = out.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.child.pattern, undefined);
  const items = props.list.items as Record<string, unknown>;
  assert.equal(items.exclusiveMaximum, undefined);
});
