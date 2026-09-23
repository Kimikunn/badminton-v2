# Component Guidelines

> All components are Vue 3 `<script setup>` SFCs in plain JavaScript.
> Canonical examples: `components/ui/Input.vue` (primitive),
> `views/VenueView.vue` (page with forms).

---

## SFC shape

- `<script setup>` first, `<template>` second, `<style scoped>` last and rare
  (styling is Tailwind utilities; scoped CSS only for things utilities can't
  express, e.g. the select-arrow SVG in `Input.vue`).
- Props via runtime `defineProps({ name: { type, default } })` objects;
  two-way binding via `defineModel()` (see `Input.vue`).
- Document props in a JSDoc block at the top of `<script setup>`
  (see header of `Input.vue`).
- Icons from `lucide-vue-next`; charts via `vue-chartjs`.

## UI primitives before markup

Before writing raw `<input>`/`<button>`/modal markup in a view, check
`components/ui/`: `Input`, `Button`, `Card`, `Sheet` (bottom sheet),
`ConfirmSheet`, `Badge`, `Avatar`, `EmptyState`, `SegmentedControl`,
`ToastContainer`, `RankingRow`, `RankMedal`, `TitleIcon`, `AdminTokenSheet`.

## Forms (the one established pattern)

No form library. From `views/VenueView.vue`:

1. Form opens in a `<Sheet :show="showX" title="…" @close="showX=false">`.
2. Form state is a single `ref({...})` object; fields bound with
   `<Input label="名称" v-model="form.name" />` (`Input` supports
   `type="text|textarea|select|date"`, `error`, `options`).
3. Submit handler:
   - cheap client-side checks first → `toast.show('请选择场地', 'error'); return`
   - `try { await someStore.action(payload); toast.show('已保存', 'success'); showX.value = false } catch { toast.show('失败', 'error') }`
   - store action throws on failure (error message already extracted by the
     api client), so the catch shows a generic toast.
4. Destructive actions confirm first via `useConfirm`:

```js
const ok = await confirmAction({ title: '删除场地', message: `确认删除场地「${v.name}」？`, confirmText: '删除' })
if (!ok) return
```

5. Edit forms: `openEdit(record)` copies the record into a separate
   `editForm` ref — never edit store objects in place.

User-facing copy (labels, toasts, confirms) is Chinese.

## Styling

Tailwind 4 utilities with project design tokens — use token colors
(`bg-canvas`, `text-fg`, `text-fg-secondary`, `text-fg-muted`, `border-line`,
`accent`, `danger`, `duration-fast`) instead of raw palette colors so
light/dark themes keep working (`styles/tokens.css`). Mobile-first layout;
e2e tests run at 390×844 and 360×640 — keep pages free of horizontal
overflow at 360px (wrap long flex titles in `truncate` + `min-w-0`).

Bottom-fixed UI (TabBar, bottom Sheets) must pad with `var(--safe-bottom)`,
never a hardcoded value. `--safe-bottom` is
`max(env(safe-area-inset-bottom, 0px), var(--safe-bottom-min, 0px))`: in
standalone display-mode a 16px floor applies because some Android Chrome
versions report the inset as 0 (gesture bar would cover bottom buttons).

### Calendar day cells (Vant)

The venue calendar is Vant 4's `Calendar` (`poppable=false`, rowHeight 64px)
wrapped by `BookingCalendar.vue`. Day states go through the official
extension points: `formatter` (disabled/className per day), `#top-info` /
`#bottom-info` / `#text` slots (holiday badge, monitor pill, booking dots,
`data-date`-tagged number). When touching it:

- All domain markers must stay inside their slot boxes — verify with DOM
  rects (inside-check + `scrollWidth <= clientWidth + 1` for the pill) across
  390/360 × light/dark; the busiest cell is 「休 + 两位数 + 条数角标 + 监控胶囊」
  (fixed clock 2026-10-01).
- Do not enable `show-mark` without setting `--van-calendar-month-mark-color`
  for dark mode: it is a giant month watermark that crushes day-number
  contrast (measured 1.43:1). The today indicator is the accent ring on
  `.day-today .day-number` instead.
- The current-month summary uses an IntersectionObserver over
  `.van-calendar__month` sections — not Vant's `monthShow` event, which fires
  once per month and never re-emits when scrolling back.
