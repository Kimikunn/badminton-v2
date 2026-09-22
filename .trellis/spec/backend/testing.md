# Testing

> Two suites exist. Nothing else — no frontend unit tests, no vitest, no jest.

---

## Backend API/service tests — node:test + supertest

Location: `server/test/*.test.js`. Run: `cd server && npm test`
(= `node --test test/*.test.js`).

### Harness: `server/test/helpers/backendTestHarness.js`

Every test file follows the same shape (see `auth.test.js`,
`apiValidation.test.js`):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';      // if the test needs write auth — set BEFORE harness require

const { createTestHarness } = require('./helpers/backendTestHarness');
const { api, setupTestDb, closeTestDb, insertSeason, insertMatch, getDbGames } =
  createTestHarness('badminton-<name>-test-');

test.before(async () => { await setupTestDb(); });
test.after(() => { closeTestDb(); });
```

Harness facts:

- Creates a temp dir and sets `process.env.DB_PATH` + `NODE_ENV=test`
  **before** requiring `src/app` — env must be set prior to any `src/` require.
- Also sets `process.env.GYM_RUNTIME_DIR=<tempdir>/runtime`. Runtime "live files"
  (`gym-token`, `token-update-key`, written by the token capture proxy) must
  therefore be resolved **per call**, never cached in a module-level constant:

  ```js
  // server/src/services/intentService.js — correct
  function runtimeFile(name) {
    const dir = process.env.GYM_RUNTIME_DIR || path.join(__dirname, '..', '..', 'runtime');
    return path.join(dir, name);
  }
  ```

  Why: a module-level path constant is frozen at require time, so tests would
  read/write the real `server/runtime/gym-token` and concurrent test files
  would clobber each other's token. Check after a full run that
  `server/runtime/` mtimes are unchanged.
- `setupTestDb({ players })` runs schema + migrations on a fresh DB.
- Seed helpers insert rows directly: `insertPlayers`, `insertSeason`,
  `insertS5Season`, `insertRound`, `insertMatch`; DB read helpers:
  `getDbMatch`, `getDbRound`, `getDbGames`, `getDbMatchesByRound`.
- High-level flows: `startMatch(id)`, `finishGame(gameId, scoreA, scoreB)`.
  Add new helpers to the harness when a seed/flow repeats in 2+ test files.

### Assertion patterns

- HTTP via supertest: `await api.post('/api/venues').set('x-admin-token', …).send({…}).expect(201)`.
- Assert the envelope: `res.body.success === true`, `res.body.error.code === 'VALIDATION_ERROR'`.
- Verify persisted state with the `getDb*` helpers, not only the HTTP response
  (see `matchStateMachine.test.js`, `transaction.test.js`).
- `assert` is `node:assert/strict`.

### Testing background timers / in-memory loops

`watchEngine` keeps process-level state (retry sets, tuning config). Two rules
learned from the risk-control retry tests (`watchEngine.test.js`):

- Export tuning knobs as a mutable object (e.g. `watchEngine.rcRetryConfig`)
  so tests can shrink `intervalMs` / `windowMs` to tens of ms instead of
  sleeping for real minutes.
- Restore every mutated knob inside `resetEngineState()` (`RC_RETRY_DEFAULTS` +
  `Object.assign`) — otherwise a test's 20 ms interval leaks into the rest of
  the suite and turns it flaky.

## E2E — Playwright (repo root)

Location: `e2e/*.spec.js`, config `playwright.config.js`.
Run: `PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test`.

- Test deployment runs alongside prod on the same host: prod is `:8088`
  (project `badminton`), test is `:8090` (project `badmintontest`, from
  `docker-compose.test.yml` which sets `name: badmintontest` and maps
  `8090:3000`). `playwright.config.js` defaults to `:8089`, so always pass
  `PLAYWRIGHT_BASE_URL=http://localhost:8090` for the test env. Rebuild it with
  `docker compose -p badmintontest -f docker-compose.test.yml build app &&
  docker compose -p badmintontest -f docker-compose.test.yml up -d app`
  (`-p` must match the compose file's project name; otherwise compose may adopt
  and recreate the prod container).
- Four projects: `light` + `dark` at 390×844 (iPhone baseline), plus
  `android-light` + `android-dark` at 360×640 (smallest supported Android
  width) — features are mobile-first; check both color schemes and both
  widths. `smoke.spec.js` asserts no horizontal scroll on every page.
- Existing specs: `smoke.spec.js`, `season-management.spec.js`,
  `contrast.spec.js` (text/background contrast — **only scans the rankings
  page**, see frontend quality guidelines), `screenshots.spec.js` (visual
  record into `e2e/screenshots/`, gitignored), `holidays.spec.js` (fixed-clock
  calendar markers).
- **Date-dependent UI: freeze the clock before `goto`** —
  `await page.clock.install({ time: new Date('2026-10-01T12:00:00+08:00') })`
  (see `holidays.spec.js`). Clock fakes timers too; if a page needs timer-driven
  init, fall back to `page.addInitScript` overriding `Date`.
- **Dense/stacked layout assertions are numeric**: compare element
  `getBoundingClientRect()` for intersections and check
  `scrollHeight === clientHeight` (see `holidays.spec.js` + the calendar cell
  budget in frontend component guidelines) — don't rely on screenshots alone.
- ES module syntax (`import { test, expect } from '@playwright/test'`),
  unlike the CommonJS backend tests.

## What does not exist

- No frontend unit-test runner — verify client changes with
  `cd client && npm run build` plus Playwright, not invented test frameworks.
- No CI config in-repo — run the commands above locally before finishing a task.
