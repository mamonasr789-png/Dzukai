# AI waiter live UI boundary

Phase 2B.2/2B.2.1 moves `/ai` onto the validated waiter turn controller while
keeping the browser non-authoritative. The page can display server snapshots
and send customer intent, but it cannot price products, authorize actions, or
mutate the waiter cart through Zustand.

## Session and capability transport

`POST /api/ai/session` accepts one strict action:

- `create_demo_session` with a language;
- `create_table_session` with a language and signed table token;
- `restore_session` with a session ID.

Session IDs and table tokens are JSON-body values, never query parameters.
Public table links use a `tableToken` URL fragment. The client consumes the
fragment, removes it with `history.replaceState`, exchanges it in a POST body,
and never persists it. Invalid or expired table credentials are rejected
before the client explicitly requests a separate demo session. `/ai` and the
AI API send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Durable turn and retry boundary

Before starting a turn request, the page stores a minimal session-scoped
record containing the session ID, client turn ID, exact message, timestamps,
and transport state. The 20-minute TTL cleans up abandoned records.

Timeout, post-send abort, network failure, malformed response, refresh, or
crash leaves the result unknown. The UI never automatically resends. A manual
retry uses the exact message and same turn ID so server idempotency can replay
the outcome. A confirmed no-side-effect server result closes the old record
and a manual retry gets a new turn ID. Completed and partial-success mutations
do not offer a mutation retry.

## Display transcript

The display transcript is session storage, scoped by restaurant (or `demo`)
and session. It has a 24-hour TTL, an 80-message cap, a 64 KiB serialized cap,
and an explicit local clear control. Transcript loading completes before
persistence is enabled. Replacement sessions clear the old indexed namespace
and explain that allergy and preference state must be restated. Display
messages are never submitted as server conversation authority.

## Exact product selection and cart reconciliation

Every rendered reference includes a server-derived reference-set fingerprint
and ordinal. A card Add sends those values with the exact product ID as a
selection hint. Server policy validates the hint against the current
server-owned reference list and current grounding provenance before it can
authorize a normal `add_to_cart` tool call. Stale and guessed selections fail
closed.

The page validates cart session identity, unique line IDs, product snapshot
identity, cents-based totals, and monotonic revision before accepting a
snapshot. A malformed or older response preserves the last known good cart.
Successful mutations broadcast only a session-scoped invalidation;
other tabs restore an authoritative snapshot. Focus also triggers a restore.

## Language fallback rules

The page waits for persisted language hydration before session setup and does
not pre-render a Lithuanian greeting. New-session setup uses that selected
language. A successfully restored server session is authoritative and updates
the shared language store. Server turn-response language controls the
assistant response presentation. Setup failures use the hydrated selected
language because no authoritative restored session exists.

Lithuanian, English, and Russian cover recommendations, affirmative and
negative action intent, ordinals, cart actions, waiter/bill requests, allergy
and dietary language, and unsupported modifiers in the deterministic
development path.

## Development limitations

The process-local session, cart, idempotency, coordination, rate-limit, and
staff-task adapters remain development-only and are blocked in production.
Staff requests are not delivered to the existing waiter UI. Production
persistence, distributed coordination, POS, payments, voice, and paid-provider
operations are outside this phase.
