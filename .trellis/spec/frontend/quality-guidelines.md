# Quality Guidelines

> No eslint, no prettier, no CI config in this repo. Quality = matching
> existing style + running the verification commands below.

---

## Style (match the layer, enforced by eye)

| Layer | Module system | Semicolons | Quotes |
|-------|--------------|------------|--------|
| `server/` | CommonJS (`require`/`module.exports`) | yes | single |
| `client/` | ESM (`import`/`export`) | no | single |
| `e2e/` | ESM | no | single |

2-space indent everywhere. User-facing strings in Chinese. When editing a
file, copy the style of its neighbors.

## Verification commands (run before finishing a task)

```bash
cd server && npm test          # node:test + supertest API/service tests
cd client && npm run build     # vite production build — catches syntax/import errors
npx playwright test            # e2e; test env runs on :8090 (see backend/testing.md)
```

Details in `.trellis/spec/backend/testing.md`. There is no frontend unit
test runner — build + e2e are the client checks.

## Mobile-first, both color schemes

Playwright projects run light + dark at 390×844 and android-light +
android-dark at 360×640 (`playwright.config.js`).
Use design-token colors (see `component-guidelines.md`) so both themes work;
`e2e/contrast.spec.js` flags low-contrast text.

## Contrast on tinted surfaces

`e2e/contrast.spec.js` enforces the project rule (|text L − background L| ≥ 0.3)
but only walks the rankings page. **New UI with a tinted background**
(`*-subtle`, `surface-hover`, `bg-danger`, …) is not auto-covered — measure it:

- `oklch(x y z / 0.1)` tints composite over the parent surface, so
  `getComputedStyle` alone is not enough. Screenshot the element and sample the
  rendered pixels (most-common = background, strongest-difference = text), then
  compute the WCAG ratio.
- Real case (holiday row in `DaySheet.vue`): `text-fg-muted` on `bg-danger-subtle`
  was **2.2:1 / L-diff 0.27 → violates the project rule**; `text-fg-secondary`
  gives **5.5:1 / L-diff 0.43**. Rule of thumb: on tinted backgrounds use
  `fg-secondary` or stronger; reserve `fg-muted` for neutral surfaces.

## PWA caching caution

The service worker caches `/api/*` responses (`vite.config.js`
`runtimeCaching`: StaleWhileRevalidate for reference data, NetworkFirst for
match data). Changing API response shapes or adding endpoints can serve stale
data to installed clients — consider cache names/`maxAgeSeconds` and mention
it in the task when touching the API contract.

## Forbidden patterns (absent today — keep it that way)

- Direct `axios` imports outside `client/src/api/client.js`
- Raw `<input>`/`<button>`/modal markup when a `components/ui/` primitive exists
- TypeScript syntax or new lint/format tooling (discuss with the team first)
- `console.log` left in committed code (server operational logs use pino;
  startup `console.log` in `config/db.js`/`app.js` is pre-existing)
- Git-ignored artifacts committed: `client/dist*`, `server/database/`,
  `server/uploads/`, `e2e/screenshots/`, `test-results/`
