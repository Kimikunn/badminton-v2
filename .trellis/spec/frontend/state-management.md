# State Management

> Pinia, setup-style stores, one file per API resource in `client/src/stores/`.
> Canonical example: `stores/venues.js`.

---

## Store shape (copy this)

```js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const useVenuesStore = defineStore('venues', () => {
  const venues = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const res = await api.get('/venues')
      if (res.success) venues.value = res.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function createVenue(data) {
    const res = await api.post('/venues', data)
    if (!res.success) throw new Error(res.error || '创建场地失败')
    if (res.data) upsertVenue(res.data)
    return res.data
  }
  // ...
  return { venues, loading, initialized, init, createVenue, /* ... */ }
})
```

Conventions visible in `stores/venues.js`, `stores/bookings.js`:

- Setup-style `defineStore('name', () => { … })` with `ref`s — no options API.
- **Lazy load**: `init({ force })` guarded by `initialized`/`loading` flags;
  views call `init()` on mount, force-refresh with `{ force: true }`.
- **Write actions** check `res.success` and `throw new Error(中文消息)` on
  failure, update local state via small `upsertX`/remove helpers, and return
  the created/updated entity.
- Local arrays kept sorted in-store where UI needs it
  (`sortVenues()` uses `localeCompare(…, 'zh-Hans-CN')`).

## HTTP only through `@/api/client`

`api/client.js` is the single axios instance:

- `baseURL: '/api'`, 15 s timeout; response interceptor unwraps to
  `res.data`, so store code sees the `{ success, data }` envelope directly.
- Write methods automatically carry the admin token; on 401 the client
  prompts for a token and retries once, on 403 it clears the stored token
  (see `.trellis/spec/backend/auth.md` for the server contract).
- Rejected promises carry `Error` with the server's Chinese
  `error.message` already extracted — that is why views can
  `catch { toast.show('失败', 'error') }` or use `e.message`.
- **Never** import `axios` in a store, component, or composable.

## What goes where

- Server data (venues, bookings, players, seasons, matches, titles, club) →
  its Pinia store.
- Ephemeral view state (sheet open/closed, form objects, editing target) →
  local `ref`s in the component (see `VenueView.vue` form pattern).
- Cross-component UI services (toasts, confirm) → module-singleton
  composables, not stores.
