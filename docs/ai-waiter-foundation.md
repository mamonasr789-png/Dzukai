# AI waiter server foundation

## Scope

Phase 2A/2A.1 provides a server-side safety boundary for future AI and
deterministic assistant actions. It does not connect the current `/ai` UI to the
new endpoints or change the existing assistant.

This remains a **development checkpoint**, not a production deployment.

## Architecture and asynchronous ports

The foundation is split into asynchronous, replaceable ports:

- `ConversationStateStore` owns server-authoritative dining-session state.
- `MenuRepository` is the source for products, prices, allergen status,
  orderability, and confirmed modifier data.
- `CartPort` owns cart lines, reconciliation, revisions, and idempotency.
- `StaffTaskPort` owns waiter and bill requests.
- `RateLimitPort` provides replaceable request limiting.
- `SafeToolRegistry` exposes a fixed, runtime-validated tool set.
- `/api/ai/session` creates a session.
- `/api/ai/tools` executes one registered tool.

All operations that could later use Redis, a database, Syrve, or r_keeper return
Promises. Ports accept typed commands rather than `unknown`. Zod parsing remains
at HTTP/tool-controller boundaries.

Future persistent `CartPort` implementations have a mandatory adapter
guarantee: expected-revision compare-and-swap, idempotency decision, cart
persistence, and conversation cart-revision synchronization must be atomic.
The in-memory adapter provides this guarantee with a per-session mutation lock.
A remote implementation must use a transaction, script, or equivalent atomic
operation.

A future `AIProvider` sits above `SafeToolRegistry`. It may propose registered
tool calls but is never authoritative for products, prices, modifiers, cart
state, table ownership, or staff actions.

## Trust and ownership boundaries

The browser, future model output, and restored browser state are untrusted.

- Strict Zod schemas reject unknown fields, prices, malformed actions, and
  inappropriate C0/C1 control characters.
- The registry uses a compile-time switch and never dynamically resolves a
  function from a tool name.
- Session state cannot be restored with an arbitrary `save(unknown)` call.
- State mutations are typed and field-specific.
- `sessionId`, restaurant/table context, table-token ID, timestamps, and cart
  revision are server-owned.
- Cart revision can change only through the cart synchronization method.
- Errors contain safe codes/messages and no stack traces.
- Logs contain only tool metadata, a hashed session correlation value, status,
  category, duration, and storage-capacity events. Raw messages, notes, tokens,
  and secrets are not logged.

Possession of an opaque session ID remains the temporary session credential.
Customer accounts and production authorization do not yet exist.

## Signed table-token contract

A browser may no longer submit a table number. A staff-capable session requires
a signed table token.

The server-only token utility uses HMAC-SHA-256 and timing-safe signature
comparison. Its signed payload contains:

- version;
- restaurant ID;
- table number;
- expiry;
- unique token/nonce ID.

`POST /api/ai/session` verifies the signature and expiry, then copies the
restaurant, table, and token ID into immutable server-owned state. A missing or
invalid token creates no staff-capable context. A session without a token may
still use non-staff menu/cart tools.

Production QR generation must happen in trusted restaurant administration
infrastructure using `AI_WAITER_TABLE_TOKEN_SECRET`. The secret must never use a
`NEXT_PUBLIC_` name or be sent to the browser.

`createDevelopmentTableToken()` is an explicit local/test helper. It uses a
clearly marked local-only fallback when no secret is configured and refuses to
run in production. Production verification fails closed when the secret is
missing.

## Current-official-price policy

Clients and models never provide authoritative prices.

The cart adapter stores authoritative amounts as integer euro cents. Public
responses convert cents to decimal euro values only at the response boundary.

Every cart response is reconciled against `MenuRepository`:

- `view_cart` rehydrates every line and persists a new revision if facts changed;
- add/update rehydrate all existing lines and add/update with the current price;
- remove rehydrates every remaining line;
- clear returns a newly revised empty cart;
- any future order-submission boundary must reconcile again.

If a product disappears, becomes non-orderable, or loses a valid price,
reconciliation returns `cart_reconciliation_failed`. Stale snapshots are never
silently retained.

## Cart revisions and idempotency

Mutations require `expectedRevision`. Concurrent requests with the same
revision are serialized in development, so one succeeds and the other receives
`revision_conflict`.

Add idempotency keys are scoped by session, `add_to_cart`, and key. Records
contain the input fingerprint, original operation ID, and affected line ID;
they do not store a historical cart response.

On replay:

- `replayed` is `true`;
- original operation/line identity is returned;
- the cart is freshly reconciled and current.

Reuse with different input returns `idempotency_conflict`. Failed operations do
not consume keys. Records expire after 30 minutes or with the session, whichever
comes first.

Carts allow at most 100 lines. Line 101 returns
`cart_capacity_exceeded`, not `internal_error`.

## Modifier and variant policy

A modifier is confirmed only when its group and option exist in repository
data. Validation enforces:

- required groups, including empty selections;
- minimum and maximum counts;
- duplicate selections;
- option membership;
- integer-cent price deltas;
- declared incompatible option IDs.

The current menu still has no authoritative modifier catalogue, so unsupported
requests remain unconfirmed.

Every current product with a non-empty `priceNote` is treated as requiring an
authoritative variant choice. This covers current count, size, portion,
half/whole, volume, glass/bottle, and format price notes across food and drink
categories. These products return `required_variant_missing` and cannot be
silently ordered at the base price.

To make them orderable later, menu data must provide stable modifier/variant
IDs, required/default rules, option-specific prices in cents, availability, and
POS mappings.

## Allergen and dietary semantics

Allergen certainty remains explicit:

- `confirmed`: complete record verified by an authoritative source;
- `incomplete`: declarations exist but completeness is unverified;
- `unknown`: no allergen record exists.

Current non-empty menu arrays are `incomplete`; empty arrays are `unknown`.
Recommendation output always reports `allergySafetyConfirmed: false`.

Halal and kosher are certification/preparation claims, not ingredient-only
filters. The current menu has no verified certification metadata. Requests for
either therefore return no certified candidates with:

- `certificationStatus: "unknown"`;
- `requiresStaffConfirmation: true`.

No product is described as certified. Cross-contamination data is also absent.

## Development storage lifecycle

The in-memory state, cart, staff, and rate-limit adapters are bounded
process-local implementations.

Defaults:

- dining sessions: four-hour TTL, maximum 10,000;
- carts: linked to session expiry, maximum 10,000;
- cart idempotency: 30-minute/session-bounded TTL, maximum 50,000;
- staff tasks: four-hour/session-bounded TTL, maximum 20,000;
- staff idempotency: maximum 40,000;
- rate-limit buckets: window TTL, maximum 20,000.

Every adapter provides a global lazy sweep and a test reset helper. Session
expiry, explicit deletion, and reset invoke cleanup listeners that remove
associated cart, idempotency, and staff records. Capacity rejection emits
sanitized development metadata.

Process-local data may disappear during:

- Next.js development hot reload;
- server restart;
- production cold start;
- route-handler bundle/instance changes;
- multi-process or multiple-instance operation;
- serverless/Vercel function replacement.

Separate route handlers must not be assumed to share memory.

## Production guard

Both new endpoints call `getAiWaiterRuntimeAvailability()`.

When `NODE_ENV=production` and the configured runtime is the current
process-local implementation, they return HTTP 503:

```json
{
  "ok": false,
  "error": {
    "code": "storage_not_configured",
    "message": "AI waiter persistent storage and shared production adapters are not configured."
  }
}
```

Normal production behavior has no implicit fallback to process-local memory.
Production enablement requires code/configuration selecting:

- shared persistent conversation/cart/idempotency storage;
- signed table-token secret management;
- shared Redis-style rate limiting;
- a real shared staff-task adapter visible to staff.

This foundation does not claim Vercel readiness.

### Temporary Vercel demo override

For the temporary client demo only, add this exact server-side environment
variable to the Vercel Production environment:

```text
AI_WAITER_DEMO_ALLOW_IN_MEMORY=true
```

Redeploy the Vercel project after adding or changing the variable. Vercel must
build and start a new deployment before the setting takes effect.

The value is case-sensitive and only the exact string `true` enables the
override. When enabled in production, the process-local runtime accepts demo
sessions only. It does not verify or accept table tokens, restore or operate on
signed-table sessions, or allow `request_waiter` / `request_bill`. Sessions are
reported to the client as demo and non-persistent, and the UI warns that a
serverless instance reset can start a fresh session. The override does not make
the memory adapter production-safe; remove the variable and redeploy after the
presentation to restore the normal HTTP 503 guard.

## Rate limits

Development rate limits currently apply to:

- session creation by hashed request fingerprint/IP;
- tool endpoint access by hashed request fingerprint/IP;
- tool execution by session and request fingerprint;
- waiter/bill actions by session and tool name.

Limit failures return structured HTTP 429 responses. The implementation is
process-local and intended only for development. Production requires shared
rate-limit state.

## Staff-task limitation

Staff requests use verified server-owned restaurant/table context, TTL,
session-scoped cleanup, conflict-aware idempotency, and one active request per
session/type.

They are **not delivered** to the current waiter UI. That UI reads browser
`localStorage`, which a server route cannot safely mutate. A shared persistent
staff-task adapter and explicit mapping to the waiter task domain are required
before task delivery can be claimed.

## HTTP behavior

The endpoints accept only `POST` and `OPTIONS`. Other exported methods return a
structured 405 with `Allow: OPTIONS, POST`.

JSON handling:

- accepts exactly `application/json`, including parameters such as charset;
- rejects `text/application/json`;
- checks declared size;
- streams and counts chunks, cancelling once the limit is crossed;
- rejects empty/malformed JSON;
- returns `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

Limits remain 2 KiB for session operations and 16 KiB for tool execution.

Create a signed-table session:

```http
POST /api/ai/session
Content-Type: application/json

{
  "action": "create_table_session",
  "language": "lt",
  "tableToken": "<server-generated-signed-token>"
}
```

Restore a session without putting its ownership capability in the URL:

```http
POST /api/ai/session
Content-Type: application/json

{
  "action": "restore_session",
  "sessionId": "ds_<32 lowercase hexadecimal characters>"
}
```

Execute a tool:

```http
POST /api/ai/tools
Content-Type: application/json

{
  "sessionId": "ds_<32 lowercase hexadecimal characters>",
  "toolName": "add_to_cart",
  "input": {
    "productId": "p1",
    "quantity": 1,
    "modifiers": [],
    "customerNote": null,
    "expectedRevision": 0,
    "idempotencyKey": "manual_add_001"
  }
}
```

## Remaining production blockers

- shared durable session/cart/idempotency persistence;
- shared distributed rate limiting;
- production QR issuance and secret rotation;
- real staff-task delivery/status lifecycle;
- authoritative modifier/variant catalogue and POS mappings;
- authoritative allergen provenance, cross-contamination, and certification;
- production authentication/authorization and origin/CSRF policy;
- final order-submission reconciliation and POS transaction boundary.
