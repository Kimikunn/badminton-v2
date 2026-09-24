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

### Venue calendar (self-drawn, v3)

The venue calendar is **self-drawn** by `BookingCalendar.vue` (2026-09-23,
ADR 0003; Vant Calendar fully removed). One fixed month rendered at a time,
`‹›` arrow month navigation (no swipe): future limit = today +6 months, past
limit = earliest booking-record month, arrows `disabled` at both edges. When
touching it:

- **Visual language is two shapes only** (contract in `CONTEXT.md`): monitor
  status = stacked 4px color bars pinned to the cell bottom (`aggregateDayBars`
  in `stores/intent.js` returns a status array sorted by `BADGE_PRIORITY`; one
   segment per monitor). **Two-state bar contract (2026-09-23, colors
   swapped round 10; round 11 deepened it into a component-scoped
   token)**: `watching` = deep `badge-blue` bar (监控中) and
   `pending_release`/`waiting` = the lighter `--cal-bar-waiting` bar (待放票;
   defined on `.venue-calendar`: light `oklch(0.78 0.13 225)` / dark
   `oklch(0.85 0.10 215)` — do NOT use `accent` here) —
   `awaiting_verify` maps to the deep-blue `watching` bar; transient states
  (`fulfilled` "已锁到", the verify hand-off) are owned by push notifications
  and no longer render on the calendar, so `fulfilled`/`expired`/`paused` grow
  no bars; unavailable/past days also grow no bars. The legend is a fixed
  five-item row (2026-09-23, round 9) —
  今天/订场/不可用（左组·日期填色） | 监控中/待放票（右组·监控色条）+ 月时长 — always shown in that grouping/order,
  never filtered by the visible month's actual semantics; the infobar renders
  constantly and the hours number always shows (round 12: `0h` renders as a
  placeholder too, so the right edge never shifts with data);
  fills = today solid accent with inverse number / booking success-subtle /
  unavailable danger-subtle with strikethrough number. Past days dim the whole
  cell (opacity .35, `pointer-events:none`).
- **Day numbers must stay geometrically centered**: `.num` is flex-centered
  and never enters layout flow — bars are `absolute bottom`, holiday 休/班 mark
  is `absolute top-right` (shared `HolidayBadge.vue` xs). Verify with the AC5
  y-coordinate e2e assertion rather than screenshots.
- Cell anchors stay `.cal-day[data-date=YYYY-MM-DD]` for e2e; `select-day`
  fires for today-and-future (unavailable included — DaySheet owns unmarking),
  past days are ignored. Leading/trailing cells of the fixed 42-cell grid are
  adjacent-month padding (`.day-adj`): no `data-date`, no domain marks, not
  clickable — `[data-date]` anchors only land on real current-month cells.
- **Two views stack in one grid container** (round 8, no fixed height): the
  `.record-body` is `display:grid` with both branches always rendered in
  `grid-area: 1/1`; the inactive branch is `invisible pointer-events-none`
  (kept in layout so the container height never changes across switches). The
  container height = **the calendar's natural height** (legend may wrap at 360px
  — the container follows; never hardcode a px height). The list branch carries
  `contain: size` (its intrinsic size is 0, so it never drives the grid row
  height) + `min-height: 0` + **always-on internal scrolling** (`overflow-y auto
  overscroll-contain`) and shows **all records in full** (no preview count, no
  expand/collapse button — the R14/R15/R17 expand-collapse mechanism was removed
  in round 7); no sticky button exists, so nothing occludes the last row. The
  calendar branch must never scroll inside the container (`scrollHeight ==
  clientHeight` e2e assertion, 390/360 both projects). Switching list↔calendar
  must not change the card height (±2px e2e check). The list/calendar switch is
  a `SegmentedControl` (size sm) at the top-right of the 订场记录 card header
  next to the watch-settings gear button.
- A booking row is rendered by the shared `components/venue/BookingRow.vue`
  (used by both `VenueView` list and `DaySheet`) — don't hand-roll a third copy.
  Its venue/notes lines are `truncate` so a long venue name can't wrap into a
  second line (which used to blow up row heights at 360px).
- The calendar legend row is fixed (five items, see above) plus the month
  total hours; since round 12 the whole infobar lives in the reusable
  `components/venue/CalendarInfoBar.vue` (props: `left`/`right` legend arrays
  `[{label, cls}]` + `hours`) and BookingCalendar renders it with
  `:left="legendLeft" :right="legendRight" :hours="monthTotalHours"` — don't
  hand-roll a second infobar. Hours always render, including a `0h` placeholder
  when the month total is 0. Single source of truth for the light-blue bar
  value: the `--cal-bar-waiting` var stays defined on BookingCalendar's
  `.venue-calendar` root (light/dark variants); CalendarInfoBar's barleg
  references the same var via CSS custom-property inheritance — never define
  the bar colour twice.
