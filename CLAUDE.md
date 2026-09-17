# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A free, barebones personal alternative to the RP Hypertrophy app: a
mesocycle-based workout program builder with built-in double-progression
prefill. No RIR tracking, no volume-landmark dashboard — that was explicitly
scoped out; see README.md for the feature list.

Static PWA, zero dependencies, zero build step: plain HTML/CSS/vanilla JS +
`localStorage`. All scripts are loaded via `<script>` tags in `index.html`
(order matters — see below) and share the global scope; there is no bundler
and no `package.json`.

## Running / testing

Serve the directory with any static file server (required for the service
worker to register — `file://` won't work):

```
npx serve .
# or
python -m http.server
```

Then open the printed URL. There is no test suite or lint config; verify
changes by exercising the UI in a browser (resize to ~390px width to check
the mobile layout).

## Deployment

Hosted on GitHub Pages at https://arsybear.github.io/FA-Hypertrophy/, served
from the root of the `master` branch (legacy branch-based Pages, no build
step/Actions workflow). Pushing to `master` redeploys automatically —
GitHub rebuilds Pages a short while (~1 min) after every push, no manual
step needed. All asset references are relative paths (no leading `/`), which
is required for the app to work correctly under this project subpath rather
than a domain root.

## Architecture

### Script load order (`index.html`)

`js/storage.js` → `js/schedule.js` → `js/progression.js` → `js/app.js`.
Each file defines top-level functions/objects in the shared global scope
(no modules/exports) — later files call functions defined in earlier ones.

### Data model (`js/storage.js`)

Three `localStorage` keys, all accessed through the `Store` object (never
touch `localStorage` directly elsewhere):

- `fah_exercises` — flat array, the global reusable exercise library.
- `fah_mesocycles` — array of every mesocycle ever created. Exactly one has
  `active: true` at a time; `Store.getActiveMesocycle()` is the source of
  truth for what `#/today` and `#/program` operate on. Each mesocycle owns
  its **live day template** (`days[]`, each with an ordered `exercises[]` of
  "slots" — a slot references an exercise plus its target sets/rep
  range/weight increment). Editing a slot or day here always affects the
  future, since this *is* the template.
- `fah_workouts` — append-only array of generated/logged workout instances,
  each tagged with `mesocycleId` and `dayId`, and never deleted, so history
  survives switching or archiving mesocycles.

### Scheduling is calendar-based, not a rotation pointer (`js/schedule.js`)

Day templates map onto literal weekdays: `resolveDayForDate(mesocycle, date)`
computes `offset = (weekday - startDayOfWeek + 7) % 7` and returns
`days[offset]` (sorted by `order`) or `null` for a rest day. There is no
"current day" pointer to advance — changing `startDayOfWeek` immediately
reshuffles which weekday maps to which template, wrapping past Sunday back to
Monday. This is why "finish workout" doesn't need to touch any schedule
state.

### Lazy workout generation + progression (`js/app.js` `generateWorkout`, `js/progression.js`)

`#/today` looks up (or generates on first visit) the workout instance for
today's date via `getTodayContext()`. Generation snapshots the day template's
slots into the workout's `exercises[]` (so later template edits don't rewrite
history) and fills each slot's `sets[]` via `buildPrefilledSets`, which finds
the most recent *finished* workout for the same `dayId` + `slotId` (falling
back to `exerciseId`, e.g. after a one-off substitution) and applies double
progression (`nextSet` in `js/progression.js`): hit the top of the rep range
→ bump weight & reset to the bottom; otherwise +1 rep at the same weight. No
prior history → blank/unprefilled (manual baseline).

### Edit scope: "this workout only" vs "all future"

Add/remove/substitute-exercise actions on `#/today` present a scope choice.
"This workout only" mutates just the current `fah_workouts` entry; "all
future" also mutates the mesocycle's live day template via `Store`
(`addExerciseSlot`/`removeExerciseSlot`/`updateExerciseSlot`). Reordering
exercises has no scope choice — it always updates both the instance and the
template (see `move-up`/`move-down` handling in `handleTodayAction`).
`#/program` edits the template directly, so anything done there is always
"future" by definition.

### Event handling (`js/app.js`)

One global delegated `click` and `change` listener is attached **once** to
the `#view` container at startup (`handleGlobalClick`/`handleGlobalChange`),
dispatching by `currentRoute()` and `data-action`/`data-role` attributes.
Handlers always re-fetch current state from `Store` rather than closing over
state captured at render time — `#view`'s `innerHTML` is replaced wholesale
on every render, but the container node itself persists, so a naive
per-render `addEventListener` would leak stale listeners across route
changes. Don't reintroduce that pattern; add new interactive elements as
`data-action="…"` + a case in the relevant `handle*Action`/`handle*Change`
function instead.

Ephemeral UI state (which inline form/history panel is open) lives in the
module-level `App.ui` object, reset on every `hashchange` but preserved
across in-place re-renders triggered by an action (so an open form doesn't
snap shut after a click inside it).

### Views (hash routes, `renderCurrentView` in `js/app.js`)

`#/today`, `#/program`, `#/history`, `#/settings` — each has a
`render<Name>(container)` function and, where interactive, a
`handle<Name>Action`/`handle<Name>Change` pair. All read from `Store` fresh
on every call; there is no separate app-state layer.
