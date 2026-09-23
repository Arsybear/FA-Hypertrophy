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

`html`/`body` are deliberately non-scrolling (`overflow: hidden`,
`overscroll-behavior: none`, `height: 100%`) — this is what kills iOS
Safari's rubber-band bounce and makes the installed PWA feel native rather
than like a webpage. `#view` (in `css/style.css`) is a `position: fixed`
pane that owns all scrolling itself, also with `overscroll-behavior: none`.
Any new full-height/scrolling UI must scroll *inside* `#view`, not by
letting `body` scroll — don't remove these rules to "simplify" layout.

Every `position: fixed` element (like `#view` or `.bottom-nav`) always
establishes its own stacking context, so a full-bleed overlay nested inside
`#view` can never out-stack a fixed sibling like `.bottom-nav` no matter
what `z-index` it declares — that only orders things within `#view`'s own
stacking context, not against a sibling one. Raising `#view`'s own
`z-index` instead doesn't work either: `#view` spans the full viewport (via
`inset: 0`) even though it's visually empty near the bottom under
`.bottom-nav`, so it would then swallow every click meant for the nav bar,
not just while an overlay is open (this actually happened — twice, first
as invisible-but-clickable history rows, then as an unclickable bottom nav
after the wrong fix). The correct fix: full-screen overlays (e.g. the
exercise history sheet) render into `#overlay-root`, an unpositioned `<div>`
in `index.html` that's a *sibling* of `#view` and `.bottom-nav`, not nested
inside `#view` — since it isn't itself `position: fixed`, its fixed-position
children compete directly against `#view`/`.bottom-nav` in the shared root
stacking context using the `--z-*` tokens in `css/style.css`'s `:root`
(`--z-nav`, `--z-overlay-backdrop`, `--z-overlay`). `#overlay-root` gets its
own delegated click listener (see Event handling below) since it's outside
`#view`. Any new full-screen overlay follows this same pattern; any other
new `position: fixed` element still needs one of the `--z-*` tokens.

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

The app is a PWA with a service worker (`sw.js`) that does
stale-while-revalidate caching of `sw.js`'s `ASSETS` list (`index.html`,
`css/style.css`, every `js/*.js`, `manifest.json`). An already-installed
PWA instance (a phone home-screen install in particular) only picks up a
real update when `CACHE_NAME` changes — that's what triggers `install` to
fetch a genuinely fresh set and `activate` to drop the old cache; otherwise
it can keep serving a stale or *mixed* asset set (e.g. new JS paired with
old CSS) until requests happen to individually revalidate. **Any commit
that changes one of those cached files must also bump `CACHE_NAME` in
`sw.js` in the same commit** — this has silently broken a deployed feature
twice before. A `scripts/hooks/pre-commit` hook enforces this (run once per
clone: `git config core.hooksPath scripts/hooks`) and blocks a commit that
changes a cached asset without a `CACHE_NAME` bump.

Even with that bump, GitHub Pages itself caches `sw.js` for 10 minutes
(`Cache-Control: max-age=600`, not something this repo can override), so an
installed instance can still take a while to even notice a new version
exists. `App.updateAvailable` (`js/app.js`) tracks this: the `DOMContentLoaded`
handler records whether a service worker was already controlling the page
before registering, and if a *later* `controllerchange` fires (a newly
activated worker taking over from that one, not the page's own first-ever
activation), it sets the flag and — only if the user is on `#/settings` —
re-renders to show it immediately; otherwise it's picked up next time they
navigate there. `renderSettings` shows a banner with a "Refresh Now" button
(`reload-app` action, a plain `location.reload()`) when the flag is set.
This is deliberately surfaced only on `#/settings`, not globally, so it
never interrupts someone mid-workout on `#/today`.

## Architecture

### Script load order (`index.html`)

`js/storage.js` → `js/schedule.js` → `js/progression.js` → `js/app.js`.
Each file defines top-level functions/objects in the shared global scope
(no modules/exports) — later files call functions defined in earlier ones.

### Data model (`js/storage.js`)

Three `localStorage` keys, all accessed through the `Store` object (never
touch `localStorage` directly elsewhere):

- `fah_exercises` — flat array, the global reusable exercise library. Each
  entry is `{id, name, muscleGroup}`; `muscleGroup` is one of the fixed
  `MUSCLE_GROUPS` options in `js/app.js` (defaults to `"Other"` for entries
  created before this field existed). Set once at creation via
  `Store.addExercise(name, muscleGroup)` — there's no separate edit flow for
  it. Weight units are pounds throughout the UI; nothing in the data model
  is unit-typed, it's just a number. Progression weight increments are a
  percentage of the current weight, not a flat lb amount (`+%` labels,
  `slot.weightIncrementPct`, 2.5% default via `DEFAULT_INCREMENT_PCT` in
  `js/progression.js`, missing on pre-existing slots falls back to the same
  default) — see `nextSet` below.
  Each real muscle group has its own validated categorical color
  (`--mg-*` custom properties in `css/style.css`, applied via
  `renderMuscleTag()`/`muscleGroupClass()` in `js/app.js` — always go
  through these rather than hand-rolling a `.muscle-tag` span, so a new
  group can't accidentally skip the palette). "Other" intentionally has no
  hue slot (falls back to `--muted`) — the categorical method caps at ~8-10
  reliably distinguishable hues; a genuinely new 11th+ named group should
  reuse "Other" rather than get a hand-picked color. The palette was chosen
  and validated with Claude's `dataviz` skill (`validate_palette.js`); redo
  that validation if the hue set ever changes.
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

Day templates map onto literal weekdays. A mesocycle's start weekday is
**always derived from its `startDate`** via `mesocycleStartWeekday(mesocycle)`
— there is deliberately no separate `startDayOfWeek` field to edit, so the
two can never disagree (an earlier version had one; it was removed because a
manually-set weekday could silently mismatch the real calendar date).
`resolveDayForDate(mesocycle, date)` computes
`offset = (weekday - mesocycleStartWeekday(mesocycle) + 7) % 7` and returns
whichever day template's own `weekdayOffset` (0-6, set once at creation via
the "Trains on" picker in `#/program`'s add-day form, and never edited
afterward — remove and re-add a day to change it) equals that offset, or
`null` for a rest day if none does. Day templates don't need to occupy
consecutive offsets — leaving a gap between two `weekdayOffset`s is exactly
how a deliberate rest day between training days (e.g. Monday/Tuesday/[rest
Wednesday]/Thursday) is expressed; `#/program`'s add-day weekday dropdown
only offers offsets no existing day already claims. Mesocycles created
before this field existed only have the old `order` field (always
sequential from 0, since gaps were impossible then); `getDayWeekdayOffset(day)`
(`js/schedule.js`) — `day.weekdayOffset ?? day.order ?? 0` — is the only
place that needs to know about that fallback. There is no "current day"
pointer to advance — editing a mesocycle's `startDate` immediately
reshuffles which weekday maps to which template, wrapping past Sunday back
to Monday. This is why "finish workout" doesn't need to touch any schedule
state.

### Lazy workout generation + progression (`js/app.js` `generateWorkout`, `js/progression.js`)

`#/today` is date-aware, not just "today" — it reads an optional
`?date=YYYY-MM-DD` query string off the hash (`currentDateParam()`),
defaulting to the real current date, and renders Prev/Next/Today navigation
(`renderDateNav`) so past days can be reopened and backfilled. A 📅 toggle
next to that nav opens `renderCalendarPanel`, a read-only grid of the whole
mesocycle (`meso.startDate` through `numWeeks * 7` days) with a dot per
training day marking finished/in-progress/untouched status — it only reads
`Store.getWorkouts()` for that status, never calls `generateWorkout`, so
just opening the calendar can't create workout instances for days the user
hasn't visited. Each day is a plain `<a href="#/today?date=...">`, so
clicking one is an ordinary route change (closes the panel via the usual
`App.ui` hashchange reset, same as any other navigation). `getTodayContext()`
resolves that date's workout instance, generating one on first lookup for
that date (never for a date after today, so a future day can't be
prematurely snapshotted). Generation snapshots the day template's slots into
the workout's `exercises[]` and builds each slot's `sets[]` via
`buildPrefilledSets`, which finds, **per set index**, the most recent
*finished* workout for the same `dayId` + `slotId` (falling back to
`exerciseId`, e.g. after a one-off substitution) where that set was actually
logged (`findLastLoggedSet`), and applies double progression (`nextSet` in
`js/progression.js`). The prediction is stored only in the set's
`baseWeight`/`baseReps` and shown as the inputs' **placeholder**
(`setWeightHint`/`setRepsHint` in `js/app.js`) — never written into
`weight`/`reps`, which hold only what the user typed. That's deliberate: a
filled-in prediction looked like a logged set, so mid-workout you couldn't
tell what was done, and finishing silently saved untouched predictions as
lifted. A consequence is that a skipped set is saved blank, which is why the
lookup is per set index (a skipped set falls back to an older workout
instead of losing its prediction). Unfinished workouts from before this
change carry a `prefilled` key on each set; `reconcileWorkoutWithTemplate`
migrates those once (clears untouched values back to blank). The rep count that triggers a weight bump depends on
the previous set's weight, classified by `weightClass()` purely from that
number (`LIGHT_WEIGHT_THRESHOLD` 45lb, `HEAVY_WEIGHT_THRESHOLD` 135lb — no
per-exercise config): light/medium still require hitting the literal top of
the rep range, but heavy exercises trigger at the range's midpoint
(`weightBumpTriggerReps`) — one more rep at a heavy weight is
disproportionately harder than at a light one, so a smaller, more frequent
weight bump is the smoother way up rather than forcing a full rep-range
climb every time. Below that trigger: +1 rep at the same weight, capped at
`repRangeMax`. At the trigger: weight goes up by `weightIncrementPct`%,
rounded to the nearest `PLATE_INCREMENT` (2.5lb) — and floored to *at least*
one plate increment even if the raw percentage of a light weight would round
back down to the same number (e.g. 20lb at 2.5% rounds to 20, not 20.5),
which would otherwise silently stall that exercise's progression forever.
`weightIncrementPct` is defined as the week-over-week weight increase at a
*constant* rep count, so the new rep target after a bump is **not** reset to
`repRangeMin` — that would read as an accidental deload (95lb×12 → 97.5lb×8
is a much easier set than 95×12, even though the weight went up). Instead
it's computed via `equivalentReps` (the same estimate `setRepsHint` uses to
re-hint reps after a same-workout weight edit, see below): one rep lost per
`pctPerRep(baseWeight)`% of load increase — 15% for light weights, 2.5% for
heavy, linearly interpolated by weight in between. The light rate is fitted
to real week-over-week progressions (17.5×9 → 20×8, 15×8 → 20×6): light
exercises move in big equipment-forced jumps (next dumbbell up) that cost
far fewer reps than the same percentage on a heavy lift. Don't swap back to
a single 1RM formula (Epley/Brzycki) — that was the previous version, and
because it assumes one rep/weight curve for every exercise it turned
15×9 → 20lb into 20×1. The medium band is interpolated, not fitted to data.
Both call sites clamp the estimate to `[repRangeMin, repRangeMax]`. No prior history → plain "wt"/"reps" placeholders (manual
baseline).

A **finished** workout's `exercises[]` snapshot is frozen — later template
edits never rewrite it, so history stays accurate to what was actually
logged. An **unfinished** one is not: every time `getTodayContext()` reads
it, `reconcileWorkoutWithTemplate()` re-syncs it against the day template's
current slots (added/removed exercises, reordered slots, changed sets/rep
range/increment), preserving any sets already logged. This is what makes a
`#/program` edit reach an already-generated but not-yet-finished `#/today`
(including a same-day edit made after that day's workout was generated) —
and it applies to any open instance, not just today's, so reopening an old
finished workout via "Reopen Workout" also makes it eligible for
reconciliation again.

Separately, `handleTodayChange` in `js/app.js` also carries a just-entered
**weight** (as a real value, not a hint) into every other not-yet-logged set
of the same exercise **whose predicted `baseWeight` equals the edited set's**
— if the prediction had all sets at one weight, same weight across all sets
is the common case; if it had deliberately different weights (last week's
drop set), those stick. With no prediction, every `baseWeight` is `null`, so
it carries everywhere. It writes both the data model and those other
`<input>` elements directly, since this handler intentionally avoids
`renderCurrentView()` (see below), and refreshes their reps placeholder
(`refreshRepsHint`) to the rep estimate at the new weight. Reps are never
carried. A set that the user has already typed into (`isLogged: true`) is
left alone.

Each set row also has a "done" checkbox (`set.done`, handled by
`handleSetDoneChange`). Ticking it fills any still-empty box from its
placeholder hint — one tap logs a set done exactly as predicted — then locks
both inputs (`disabled`) until unticked; if a box has no numeric hint either,
the tick doesn't stick and focus moves to that box. When every set is done
the card gets `.complete` (faint `--success` tint, ✓ after the name). `done`
is a tracking aid only — progression/history still go by `isCompleteSet`.
`isSetDone()` treats any complete set on a *finished* workout as done, since
workouts finished before this existed have no `done` flags; "Reopen
Workout" persists that (sets `done` on every complete set) so reopened sets
don't flip to unticked/unlocked. Unlike
`handleTodayChange`, this handler does call `renderCurrentView()`: the
no-re-render rule protects focus while typing, and a checkbox tap isn't.

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

A global delegated `click` and `change` listener is attached **once** to
the `#view` container at startup (`handleGlobalClick`/`handleGlobalChange`),
dispatching by `currentRoute()` and `data-action`/`data-role` attributes.
`handleGlobalClick` is also attached to `#overlay-root` (see above) for the
same reason — it doesn't close over anything from the listener itself, just
re-derives state from `Store`/`currentRoute()`, so the same function safely
serves both containers. Handlers always re-fetch current state from `Store`
rather than closing over state captured at render time — `#view`'s
`innerHTML` is replaced wholesale on every render, but the container node
itself persists, so a naive per-render `addEventListener` would leak stale
listeners across route changes. Don't reintroduce that pattern; add new
interactive elements as `data-action="…"` + a case in the relevant
`handle*Action`/`handle*Change` function instead.

Ephemeral UI state (which inline form/history panel is open) lives in the
module-level `App.ui` object, reset on every `hashchange` but preserved
across in-place re-renders triggered by an action (so an open form doesn't
snap shut after a click inside it).

### Views (hash routes, `renderCurrentView` in `js/app.js`)

`#/today`, `#/program`, `#/history`, `#/settings` — each has a
`render<Name>(container)` function and, where interactive, a
`handle<Name>Action`/`handle<Name>Change` pair. All read from `Store` fresh
on every call; there is no separate app-state layer.
