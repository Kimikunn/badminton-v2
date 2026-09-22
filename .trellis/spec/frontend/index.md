# Frontend Development Guidelines

> Conventions for the Vue 3 client in `client/`. Every rule is extracted from
> working code — file paths are real, follow them.

---

## Overview

Vue 3 `<script setup>` + Pinia + Tailwind 4 + vue-router, plain JavaScript
(ESM, no TypeScript, no lint tooling). Mobile-first PWA served by the Express
backend. Backend conventions live in the sibling layer
[../backend/](../backend/index.md).

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | `client/src` layout, `@` alias, domain folders | Filled |
| [Component Guidelines](./component-guidelines.md) | `<script setup>` SFCs, UI primitives, the Sheet+Input+toast form pattern | Filled |
| [Composable Guidelines](./hook-guidelines.md) | `useX` composables, singleton vs per-call state | Filled |
| [Date & Holiday Data](./date-holidays.md) | `chinese-days` 节日/调休约定：`holidayFor` 契约、逗号判定、数据范围与升级 | Filled |
| [State Management](./state-management.md) | Pinia setup stores, lazy `init()`, api client envelope | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Per-layer style, verification commands, PWA cache caution | Filled |
| [Type Safety](./type-safety.md) | Plain-JS reality: runtime props, JSDoc, envelope contract | Filled |

## Stack Facts

| Fact | Value | Evidence |
|------|-------|----------|
| Framework | Vue 3, `<script setup>`, composition API | all of `client/src/**/*.vue` |
| State | Pinia setup-style stores | `client/src/stores/venues.js` |
| HTTP | single axios wrapper `@/api/client` | `client/src/api/client.js` |
| Styling | Tailwind 4 + design tokens | `client/src/styles/tokens.css` |
| Language | plain JavaScript ESM (no TS) | `client/package.json` |
