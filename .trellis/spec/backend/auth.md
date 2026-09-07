# Auth

> One mechanism exists: an admin **write** token. There is no per-user auth,
> no sessions, no roles. Do not invent any.

---

## Server side — `server/src/middleware/writeAuth.js`

Mounted globally in `app.js`: `app.use('/api', requireWriteAuth)` runs before
all routers.

Model (from the code):

- Only write methods are gated: `POST`, `PUT`, `PATCH`, `DELETE`
  (`WRITE_METHODS` set). **All GETs are always public.**
- Enabled only when `ADMIN_TOKEN` env is set (`config.auth.adminToken`).
  If unset, writes pass through unauthenticated — local-dev behavior.
- Token accepted from either header:
  - `x-admin-token: <token>`
  - `Authorization: Bearer <token>`
- Comparison uses `crypto.timingSafeEqual` on equal-length buffers.
- Failures use the standard envelope:
  - missing token → 401 `UNAUTHORIZED` ("缺少写入权限令牌")
  - wrong token → 403 `FORBIDDEN` ("写入权限令牌无效")

There is no per-endpoint auth opt-in/opt-out; protection follows the HTTP
method automatically. Keep GETs side-effect free so this stays sound.

## Test-only routes

`app.js` mounts `routes/admin.js` at `/api/admin` only when
`ENABLE_TEST_FEATURES === 'true'` (data reset for e2e). Never enable in
production; never put real features under it.

## External gym credential (token-user)

The venue mini-program token is short-lived (~5-6 days). Read order in
`intentService.getEnvConfig()`: runtime file `server/runtime/gym-token`
first, `GYM_TOKEN_USER` env as fallback. The file is written by the token
capture proxy (`tools/tokenproxy/`, see its README) — never hardcode reads
of `process.env.GYM_TOKEN_USER` elsewhere; always go through
`getEnvConfig()`. `server/runtime/` is gitignored and mounted into both
app containers via compose.

## Client counterpart — `client/src/api/client.js`

- Request interceptor attaches `x-admin-token` automatically on write methods;
  token stored in localStorage key `badclub:adminToken`
  (fallback: `VITE_ADMIN_TOKEN` env).
- On 401 `UNAUTHORIZED` to a write: prompts for the token via
  `useAdminTokenPrompt`, stores it, retries the original request once
  (`_adminTokenRetry` guard).
- On 403 `FORBIDDEN`: clears the stored token.

So server changes to auth must keep: the two header names, the two error
codes, and "GETs public" — the client depends on all three.

## Reference test

`server/test/auth.test.js` documents the contract: public reads, 401 without
token, 403 with wrong token, 201/200 with either header form.
