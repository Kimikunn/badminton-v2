# Backend Development Guidelines

> Conventions for the Express + sql.js API in `server/`. Every rule below is
> extracted from working code — file paths are real, follow them.

---

## Overview

Single-process Express 4 app (CommonJS), SQLite via sql.js (WASM). Entry:
`server/src/server.js`, app assembly: `server/src/app.js`. No TypeScript, no
lint tooling — style is enforced by matching neighboring code.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [API Routes](./api-routes.md) | routes → controllers → services layering, response contract, validation, DB access |
| [Auth](./auth.md) | Admin write-token model (reads public, writes gated) |
| [Logging](./logging.md) | pino structured logging, request/error log patterns |
| [Testing](./testing.md) | node:test + supertest harness, Playwright e2e |

## Stack Facts

| Fact | Value | Evidence |
|------|-------|----------|
| Framework | Express 4, CommonJS modules | `server/src/app.js` |
| DB | sql.js (WASM SQLite), singleton wrapper exposing `prepare`/`transaction` | `server/src/config/db.js` |
| Validation | express-validator (declarative) + manual controller checks | `server/src/validators/`, `server/src/controllers/venuesController.js` |
| Auth | Single admin token, write-methods only | `server/src/middleware/writeAuth.js` |
| Logging | pino | `server/src/utils/logger.js` |
| Tests | node:test + supertest | `server/test/`, `server/package.json` |
