# Type Safety

> Reality: **this project is plain JavaScript — no TypeScript, no tsconfig,
> no PropTypes library, no runtime schema validation on the client.**
> Do not introduce TS syntax, `.ts` files, or new type tooling; type safety
> here is achieved by the mechanisms below.

---

## What exists today

1. **Runtime prop declarations** — `defineProps({ name: { type: String, default: '' } })`
   and typed `defineModel({ type: [String, Number], default: '' })`
   (see `components/ui/Input.vue`). Always declare types+defaults for props.
2. **JSDoc header comments** documenting props/params/returns on shared
   components, composables, and utils (`Input.vue`, `useToast.js`,
   `server/src/utils/errors.js`). Match this when adding shared code.
3. **Server-side validation as the real gate** — the API rejects bad shapes
   with 422 (`server/src/validators/` + controller checks). The client trusts
   the server contract and displays the server's Chinese error message
   (extracted by `api/client.js`).
4. **The response envelope as the contract** — every API call returns
   `{ success, data }` / `{ success, error: { code, message } }`
   (see `.trellis/spec/backend/api-routes.md`). Store actions check
   `res.success`; that check is the client's "type guard".

## Rules

- New code is plain ESM JavaScript (client) / CommonJS (server). No `any`,
  no interfaces, no `.d.ts`.
- Keep camelCase API field names produced by the server `formatX` mappers
  consistent — the client reads them directly (e.g. `createdAt` from
  `formatVenue`, not `created_at`).
- When changing an API payload shape, update both sides in the same change:
  server `formatX`/validators and every client store/component reading it.
  Grep for the field name across `client/src` — there is no compiler to
  catch a missed consumer.
