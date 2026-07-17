# Logging

> pino structured logging. Single shared instance:
> `server/src/utils/logger.js`.

---

## Logger instance

```js
const logger = require('../utils/logger');   // pino instance
```

- Level from `LOG_LEVEL` env (default `info`).
- Non-production: `pino-pretty` colorized output; production: JSON lines.
- API: `logger.info(msg)`, `logger.info(obj, msg)`, `logger.warn`,
  `logger.error`, `logger.debug`.

## Request logging — already global

`app.js` registers a middleware that, on `res.finish`, logs every `/api`
request as a structured object:

```js
logger.info({ method: req.method, url: req.originalUrl, status: res.statusCode, ms });
```

Do not add per-route request logs — they duplicate this.

## Error logging — two existing call sites

1. `utils/asyncHandler.js` (wraps every route):

```js
logger.error(`${context} - ${err.stack || err.message}`);
// context is the 'domain.action' string from the route registration
```

2. `middleware/errorHandler.js` (global fallback):

```js
logger.error({ message: err.message, stack: err.stack, url: req.originalUrl, method: req.method });
```

## Rules

- Use the shared `utils/logger.js` instance; do not create new pino instances
  or use `console.log` for operational events (current `console.log` calls in
  `config/db.js` / `app.js` startup are pre-existing, not a pattern to extend).
- Errors are already logged by asyncHandler/errorHandler — a controller that
  returns an expected error via `notFound(res, …)` / `validationError(res, …)`
  must NOT also log it.
- User-facing error messages are Chinese; log context strings use the
  `'domain.action'` convention (`venues.create`, `games.updateScore`).
