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
