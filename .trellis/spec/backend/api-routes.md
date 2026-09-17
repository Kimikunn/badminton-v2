# API Routes & Layering

> How an endpoint is built in `server/`. Canonical example to copy:
> the venues resource (`routes/venues.js` + `controllers/venuesController.js`
> + `services/venueService.js` + `validators/venueValidators.js`).

---

## Layering (strict)

```
routes/*.js        → thin router: HTTP method + path + middleware chain only
controllers/*.js   → request/response handling, input validation, calls services
services/*.js      → business logic + SQL (prepare/transaction)
config/db.js       → singleton db, prepare(), transaction()
```

Controllers never contain SQL. Routes never contain logic. Services never
touch `req`/`res`.

## Route file pattern

Copy `server/src/routes/venues.js`:

```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/venuesController');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { createVenueRules, updateVenueRules } = require('../validators/venueValidators');

router.get('/', asyncHandler(ctrl.getAll, 'venues.getAll'));
router.post('/', createVenueRules, validate, asyncHandler(ctrl.create, 'venues.create'));
router.put('/:id', updateVenueRules, validate, asyncHandler(ctrl.update, 'venues.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'venues.remove'));

module.exports = router;
```

Rules:
- **Every handler wrapped in `asyncHandler(fn, 'domain.action')`** — the
  context string is used in error logs. No try/catch inside controllers.
- Mount new routers in `server/src/app.js` under `/api/<resource>`.
  `requireWriteAuth` is already applied globally to `/api` before routers.

## Response contract (never break)

All endpoints return the unified envelope via `server/src/utils/response.js`:

```js
// success:  { success: true, data }                          → success(res, data[, 201])
// failure:  { success: false, error: { code, message } }     → error(res, msg, code, status)
```

Helpers: `success`, `error`, `notFound` (404 NOT_FOUND), `validationError`
(422 VALIDATION_ERROR), `serverError` (500). Error messages are Chinese,
user-facing. Never call `res.json` directly with a hand-rolled shape.

## Validation — two coexisting layers

1. **Declarative shape checks** in `server/src/validators/<domain>Validators.js`
   (express-validator `body(...)` chains), wired in the route with the
   `validate` middleware which formats errors as 422 with the first message
   in `error.message` and all messages in `error.details`
   (`server/src/middleware/validate.js`).
2. **Business / cross-field checks** inside the controller, using helpers
   from `server/src/utils/validators.js` (`validateText`,
   `validateNonNegativeNumber`, …) returning an error-message string;
   controller returns `validationError(res, msg)`. See `validatePricing` /
   `validateVenuePayload` in `controllers/venuesController.js`.

For update endpoints pass `{ partial: true }`-style options so absent fields
are skipped (see `validateVenuePayload(body, { partial: true })`).

Exception (intents domain, ADR-0002 refactor): `validators/intentValidators.js`
merges cross-field rules into the validators layer via `body().custom(...)`
(incl. reading the existing row for partial updates); the controller then only
does 404 existence checks. New domains may follow either pattern, but do not
duplicate the same rule in both layers.

## Services & DB access

From `server/src/services/venueService.js`:

- SQL only through `prepare('...').run/get/all` from `config/db` — always
  parameterized (`?` placeholders), never string-concatenated values.
- **Multi-write operations** run inside `transaction(() => { ... })`
  (see `services/matchService.js`, `services/gameService.js`).
- **JSON columns** are TEXT: read with `parseJson(row.col, fallback)`,
  write with `stringifyJson(value)` from `utils/json.js`.
- **Partial UPDATEs** use `buildUpdate(patch, fieldMap)` from
  `utils/updateBuilder.js`; special columns (e.g. JSON) appended manually.
- **IDs** come from `utils/id.js` generators (`venueId()`, …), not autoincrement.
- Services expose a `formatX(row)` mapper: snake_case columns → camelCase API
  fields, JSON parsed (see `formatVenue`).

## Derived fields & engine state (intents domain)

`/api/intents*` is the only domain that returns **derived lifecycle state**.
Rules (do not duplicate them elsewhere):

- `booking_intents` is **single-date** (`date` required, no weekly column).
  Creation rejects `weekdays` with 422; `date < today` is 422; far-future dates
  are allowed (pre-set monitors activate when the date enters the release window).
- Every intent carries `status`, produced by the pure function
  `intentService.deriveIntentStatus(row, ctx)` — **order of its branches is the
  contract** (see `.trellis/tasks/archive/2026-09/09-17-calendar-day-intents/design.md §3.1`).
  The controller only assembles `ctx`:
  - `riskRetryKeys` from `watchEngine.getRiskRetries()` (in-memory; element is
    `${intentId}|${date}`),
  - `isFulfilled` from `lockRun.isOccurrenceFulfilled(row, lockedRows)`,
  - `today` / `windowEnd` / `now` from `venueShared` (`BOOKING_WINDOW_DAYS`, `RUSH_HOUR`).
- Also returned: `verifyDeadline` (only while `status === 'awaiting_verify'`) and
  `lastAttempt` (`{ status, errorCode, error, createdAt, attempts }`, derived from
  `booking_intent_locks`; `errorCode ∈ RISK_CONTROL|SOLDOUT|LIMIT|UNPAID|OTHER`).
  `expired` is kept as a compatibility alias for `status === 'expired'`.
- **Lock records carry `expireAt`** (UTC; `expire_at` column, migration 019): the venue's
  payment deadline from the `createOrder` response (`expireTime` is Beijing time → stored UTC,
  rendered +8h in pushes/UI). `/api/intents/locks` returns it as `expireAt`.
- **Order-level locking (2026-09-17)**: one lock action submits the whole run as **one order**
  (N `areaItems` → N `locked` rows sharing `order_id`/`expire_at`). Constraints that follow from
  the venue: **2 court-slots per day** (`时长 × 片场 ≤ 2`, so `durationHours` ≤ 2 and
  `courtsNeeded` ≤ 2, both 422 above that) and **only one unpaid order at a time** — a `UNPAID`
  rejection disables the intent and pushes 「需要先支付」 instead of retrying.
  `createOrderCheck` code `LIMITED_BY_START_TIME` is a **soft notice** (<12h → no refund): the
  order is still submitted and the success push adds "不可退款".
- **Day availability is a separate dimension, never folded into `status`**: a day
  marked in `unavailable_days` is skipped by the engine and rendered as its own
  marker; there is deliberately no `blocked` status.
- Filters: `GET /api/intents?from=&to=` (date range), `GET /api/intents/locks?date=`,
  `GET /api/intents/notifications?date=` (both also keep the older `?intentId=`).
  Date params are validated with `utils/validators.validateDateText` → 422 when malformed.

## Error flow

- Expected business errors: throw an `AppError` subclass from
  `utils/errors.js` (`NotFoundError`, `ValidationError`, `ConflictError`,
  `UnauthorizedError`) inside services, or return via response helpers in
  controllers (404 check pattern: load row, `if (!existing) return notFound(res, '场地不存在')`).
- `asyncHandler` catches everything: operational errors (`err.isOperational`)
  are returned as-is; anything else goes through `mapError`
  (`utils/errorHandling.js`) and is logged with the route context string.
- Global `notFoundHandler` + `errorHandler` are registered last in `app.js`.

## Anti-patterns (not present in this codebase — keep it that way)

- try/catch inside controllers (asyncHandler owns it)
- SQL in controllers, or `req`/`res` in services
- Hand-rolled response shapes, or English user-facing error messages
- GET endpoints that mutate state (write auth + rate limit skip assume GET is safe)
