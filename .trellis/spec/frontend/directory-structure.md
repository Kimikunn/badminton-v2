# Directory Structure

> `client/` — Vue 3 + Vite + Pinia + Tailwind 4. Plain JavaScript ESM.

---

## Layout (`client/src/`)

| Directory | Contents | Example |
|-----------|----------|---------|
| `views/` | Route pages, one per route in `router/index.js` | `VenueView.vue`, `ScoringView.vue` |
| `components/ui/` | Reusable design-system primitives | `Input.vue`, `Sheet.vue`, `Card.vue`, `Button.vue` |
| `components/<domain>/` | Domain components grouped by feature folder | `components/venue/BookingCalendar.vue`, `components/season/S5Rankings.vue` |
| `stores/` | Pinia stores (setup style), one per API resource | `venues.js`, `bookings.js` |
| `api/` | Single axios wrapper | `client.js` (only file — all HTTP goes through it) |
| `composables/` | Shared composition functions, `useX` naming | `useToast.js`, `useConfirm.js` |
| `constants/` | Static data, season presets | `seasonPresets.js` |
| `rules/` | Client mirror of season rule engines (S1–S5, standard) | `s5.js`, `index.js` |
| `router/` | vue-router routes | `index.js` |
| `styles/` | Global CSS + design tokens | `tokens.css`, `global.css` |

## Conventions

- **`@` alias → `client/src`** (`vite.config.js`). Always import via
  `@/components/...`, never relative `../../`.
- New route page = new file in `views/` + entry in `router/index.js`.
- New reusable primitive goes to `components/ui/`; feature-specific markup
  stays in the domain folder or inside the view.
- Season-specific ranking/scoring components follow the existing
  `S<n>Rankings.vue` naming (`components/season/`).
- `server/src/rules/` and `client/src/rules/` are intentionally mirrored —
  rule logic changes usually touch both sides.

## Build outputs (do not edit)

`client/dist/` (production), `client/dist-test/` (test mode build) — both
gitignored. The Express server serves `client/dist` statically and has an SPA
fallback to `index.html` (`server/src/app.js`).
