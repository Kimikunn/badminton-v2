# Composable Guidelines

> This is a Vue project: "hooks" here means **composables** in
> `client/src/composables/`, named `useX.js`.

---

## Existing composables (reuse before writing new ones)

| Composable | Purpose |
|------------|---------|
| `useToast` | Global notifications — `toast.show(msg, 'success'\|'error'\|'info')` |
| `useConfirm` | Promise-based confirm sheet — `await confirmAction({ title, message, confirmText })` |
| `useAdminTokenPrompt` | Prompts for the admin write token (used by the api client) |
| `useOnlineStatus` | Network online/offline state |
| `useAppInit` | App boot: loads base stores |
| `useSeasonTheme` / `useViewAccent` / `useTheme` | Theming per season/view |
| `useSeasonSelector`, `useSeasonAction`, `useMatchTab` | Season/match view logic |
| `useScoringValidation` | Score input validation |
| `useSWUpdate` | Service-worker update prompt |

## Patterns

- **Module-level singleton state** for app-wide services: `useToast.js`
  declares `const toasts = ref([])` at module scope so every caller shares
  one toast queue. Use this for global UI services.
- **Per-call state** for view logic: composables like `useScoringValidation`
  create refs inside the function so each component instance gets its own.
- Return an object of refs/functions (`return { toasts, show, remove }`),
  matching the existing files.
- Composables call stores/api like components do — no direct axios; HTTP only
  through `@/api/client`.
- Pure JS, no TypeScript; document usage in a JSDoc header comment
  (see `useToast.js`).
