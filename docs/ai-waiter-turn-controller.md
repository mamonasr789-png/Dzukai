# AI waiter turn controller — Phase 2B.1.1

Status: development-only server foundation. The live `/ai` page still uses the
existing deterministic assistant. Voice, POS, payment, and production
persistence integrations are outside this phase.

## Safety authority

The model is a proposal source, never the action authority.

`ActionAuthorizationPolicy` deterministically extracts a typed `ActionIntent`
from the actual customer message, current state, reconciled cart, grounded
product provenance, and unresolved ambiguity. It rejects negated,
hypothetical, informational, comparison, future, third-party, ambiguous, or
provider-only intent. An authorized action is bound to exactly one tool,
target, quantity, customer-evidenced note, and current cart revision.

Only one irreversible action is permitted per turn across cart and staff
tools. Read-only tools may precede it. Multiple irreversible actions or any
provider attempt to broaden the authorized action produce one controlled
clarification and no mutation.

## Turn transaction boundary

`SessionTurnCoordinator` serializes the complete turn for one dining session,
from initial state load through result storage. Different sessions remain
concurrent. The development implementation has bounded capacity, releases
queues after success or exception, and is replaceable by a distributed lock or
versioned transaction.

Every authorized irreversible action enters `ActionLedger` before execution.
The stable action ID and idempotency key are derived from the session, client
or server turn ID, authorized action ordinal, and canonical authorized action;
provider call IDs are excluded. Ledger entries record intent, canonical input
fingerprint, status, structured result, affected ID, and timestamp.

Once an action succeeds, provider generation stops. `GroundedResponseRenderer`
renders the customer confirmation directly from the successful tool result.
The turn therefore cannot become a generic failure because later AI prose,
claim validation, or state persistence failed. A failed post-action state write
returns `partial_success_state_update_failed`. An exception after execution is
recovered using the stable action key or reconciled cart state, then stored as
a terminal partial-success result.

Successful response statuses are:

- `success`;
- `success_with_response_fallback`;
- `partial_success_state_update_failed`;
- `clarification_required`;
- `rejected_action`;
- `provider_failed_without_side_effect`;
- `internal_failure_without_side_effect`.

## Claims and official rendering

Provider final output separates conversational text from typed claims:

- product price and cart total;
- ingredient and allergen;
- dietary or certification;
- availability, discount, and popularity;
- kitchen, payment, and staff-action state.

`ClaimValidation` checks each claim against current provenance, official menu
details, cart state, verified restaurant knowledge, or the action ledger.
Prices are integer cents and are formatted server-side. The current data source
cannot authorize live availability, discounts, popularity, certification,
kitchen, or payment claims, so those claims fail closed.

Unstructured numeric or word prices, action confirmations, safety claims,
ingredient claims, discounts, popularity, availability, certification,
kitchen, and payment statements are rejected. Stored or unresolved allergies
keep food-safety responses conservative even when the current message omits
the allergen. Cross-contamination, halal, and kosher preparation remain
unconfirmed.

## State and grounding

`ConversationStateReducer` applies typed deltas instead of stale whole-array
replacement. Supported operations cover persistent and temporary preferences,
dislikes, allergies, dietary requirements, scoped budgets, language, stage,
references, ambiguity, and unresolved questions. Provider proposals use the
same reducer path and cannot propose customer safety or preference fields.
Server-owned session, restaurant, table, revision, and timestamp fields remain
immutable.

The deterministic extractor handles first-person scope, Lithuanian and English
negation, third-party allergy statements, uncertain allergies, temporary
preferences, explicit corrections, group-budget scope, and state removal.
Uncertain allergy statements create a clarification rather than persisted
allergy state.

Grounded products carry provenance:

- `current_query`;
- `explicit_current_reference`;
- `explicit_prior_reference`;
- `cart`;
- `current_tool_result`.

Prior references are carried only when the customer explicitly refers to them.
Unrelated turns clear or age them. `get_product_details` is restricted to an
already permitted provenance set; merely guessing a real product ID does not
make it grounded. Search and recommendation results become
`current_tool_result` provenance for the same turn.

## Provider and fallback boundary

The Anthropic adapter uses direct Messages API HTTP calls while keeping
provider details outside domain types. It bounds request bytes, response bytes,
output tokens, and request duration. Executable tool blocks are accepted only
with `stop_reason: "tool_use"` and no mixed free-text block. `end_turn`,
`max_tokens`, `refusal`, `pause_turn`, missing or unknown stop reasons,
malformed content, non-success HTTP, oversize payloads, and aborts fail closed.
Tool-result blocks remain immediately after their corresponding assistant
tool-use message.

Provider and registry schemas originate from the same Zod definitions and the
provider JSON Schemas are generated from those definitions. Validated inputs
are canonicalized before loop detection, ledger storage, and idempotency
fingerprinting.

The deterministic fallback cannot reach the browser/Zustand cart. Its legacy
boundary is limited to isolated, non-mutating greetings and strips old
`[ADD:...]` tags. Stored allergies constrain food selection and safety only;
greeting, cart viewing/removal, waiter and bill requests, and restaurant
knowledge remain available. Action-success wording still requires a real tool
result.

## HTTP and production boundary

`POST /api/ai/turn` retains the Phase 2A process-local production guard,
bounded JSON parsing, content-type enforcement, IP and session rate limits,
opaque-session validation, no-store responses, safe error mapping, and method
handling. Process-local state, locks, idempotency, rate limits, staff tasks,
cart, and action ledger cannot be enabled in production.

No raw transcript, prompt, provider response, secret, note, or environment
value is logged. The paid-provider-free regression and evaluation commands are:

```sh
npm run test:phase2b1
npm run eval:phase2b1
```

Phase 2B.2 may begin only after this development checkpoint is independently
reviewed and committed. Shared persistence, distributed coordination,
production ownership credentials, live UI integration, and provider operations
remain future work.
