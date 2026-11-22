# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A free, barebones personal alternative to the RP Hypertrophy app: a
mesocycle-based workout program builder with built-in double-progression
prefill. No RIR tracking, no volume-landmark dashboard — that was explicitly
scoped out; see README.md for the feature list.

Static PWA, zero dependencies, zero build step: plain HTML/CSS/vanilla JS +
`localStorage`. The code is native ES modules loaded from one
`<script type="module" src="js/main.js">`; there is no bundler and no
`package.json`. It must keep working with no connection: nothing is loaded
from another origin (no font or library CDN), and every file the app loads
is listed in `sw.js`'s `ASSETS`.

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

Then open the printed URL. There is no lint config. `node scripts/test.mjs`
is a small self-check of the logic that needs no browser (history matching,
double progression, weekday resolution and shifts, missed days and undo,
reconciliation, PRs, library edits, copying a mesocycle, backup
validation) plus two release checks: every loaded file is in `sw.js`'s
`ASSETS`, and `APP_VERSION` equals `CACHE_NAME`. Run it before committing. Everything else is
verified by exercising the UI in a browser. Chrome will not go narrower
than ~500px, so check the phone layout in a 390px-wide same-origin iframe.
The service worker serves cached files first: when testing a change,
unregister it and clear caches (or serve with `Cache-Control: no-store`), or
the old code runs. `window.FAH` exposes the modules (`FAH.Store`,
`FAH.renderCurrentView()`, …) for seeding state from the console.

## Deployment

Hosted on GitHub Pages at https://arsybear.github.io/FA-Hypertrophy/, served
from the root of the `master` branch (legacy branch-based Pages, no build
step/Actions workflow). Pushing to `master` redeploys automatically —
GitHub rebuilds Pages a short while (~1 min) after every push, no manual
step needed. All asset references are relative paths (no leading `/`), which
is required for the app to work correctly under this project subpath rather
than a domain root.

The app is a PWA with a service worker (`sw.js`) that precaches `sw.js`'s
`ASSETS` list (`index.html`, `css/style.css`, every `js/*.js`,
`manifest.json`, the icons) at install and then serves cache first. The
cache is written only at install (with `cache: "reload"`, past the browser's
HTTP cache), never while the app runs: an earlier stale-while-revalidate
version wrote fresh responses into the current cache, so a deploy followed
by a dropped connection could leave one cache holding modules from two
versions, and the next offline launch failed to link them (blank page). An
installed instance therefore changes only when `CACHE_NAME` changes — that
is what makes `install` fetch a whole fresh set and `activate` drop the old
cache; without a bump a deployed change never reaches it. **Any commit
that changes one of those cached files must also bump `CACHE_NAME` in
`sw.js` in the same commit** — this has silently broken a deployed feature
twice before. A `scripts/hooks/pre-commit` hook enforces this (run once per
clone: `git config core.hooksPath scripts/hooks`) and blocks a commit that
changes a cached asset without a `CACHE_NAME` bump.

Even with that bump, GitHub Pages itself caches `sw.js` for 10 minutes
(`Cache-Control: max-age=600`, not something this repo can override), so an
installed instance can still take a while to even notice a new version
exists. `App.updateAvailable` (`js/ui.js`, set in `js/main.js`) tracks this: the `DOMContentLoaded`
handler records whether a service worker was already controlling the page
before registering, and if a *later* `controllerchange` fires (a newly
activated worker taking over from that one, not the page's own first-ever
activation), it sets the flag and — only if the user is on `#/settings` —
re-renders to show it immediately; otherwise it's picked up next time they
navigate there. `renderSettings` shows a banner with a "Refresh now" button
(`reload-app` action, a plain `location.reload()`) when the flag is set.
This is deliberately surfaced only on `#/settings`, not globally, so it
never interrupts someone mid-workout on `#/today`.

## Architecture

### Modules (`js/`)

- `main.js` — entry point: registers the routes, attaches the delegated
  listeners, registers the service worker.
- `store.js` — `Store` (all `localStorage` access), `validateBackup`, and
  the number clamps (`cleanCount`, `cleanPct`, `normalizeMesocycles`).
- `schedule.js` — dates, weekday-to-day-template resolution including
  shifts, and the one date format shown everywhere (`formatDay`,
  `formatShortDate`).
- `progression.js` — double progression, the history matchers and
  `exercisePR`.
- `workout.js` — workout generation, template reconciliation,
  `getTodayContext`, the missed-day functions, `refreshPredictions`,
  `getExerciseHistory`.
- `ui.js` — `App` state, escaping and form helpers, `pageHeader`, `icon`,
  muscle tags, and the route registry (`registerRoute`,
  `renderCurrentView`). Views call `renderCurrentView` from here, so no view
  imports `main.js` (no import cycle).
- `chart.js` — the inline-SVG line chart used in the History sheet.
- `version.js` — `APP_VERSION`, shown in Settings; must equal the number in
  `sw.js`'s `CACHE_NAME`.
- `views/today.js`, `views/program.js`, `views/history.js`,
  `views/settings.js` — one screen each.

`schedule.js`, `progression.js` and `store.js` have no DOM access at import
time, which is what lets `scripts/test.mjs` import them in Node.

### Look (`css/style.css`, `icons/`)

One dark theme by design (gym use on a phone), not a system-setting switch:
near-black steel surfaces with a mulberry accent. `--accent` is for fills
(white text passes on it), `--accent-soft` for text, icons and outlines on
dark surfaces. Green (`--success`) means done, amber (`--warn`) in progress
— in the week strip, the calendar, set rows and the progress bar alike.
Inputs are 16px (anything smaller makes iOS zoom the page on focus) and tap
targets are at least 44px (`--tap`). Prediction placeholders are `--muted`
at full opacity (above 4.5:1 on the input, and lighter in weight than a
typed value); the outline of an empty control (unticked done circle) is
`--control-edge`, a neutral grey just above 3:1 on the card — `--muted`
there made a column of empty circles louder than the numbers. The mark (a great helm whose face
plate is the letters FA) is drawn by `scripts/make_icons.py`, which writes
`icons/icon.svg`, `icons/mark.svg` and the PNG sizes; change the mark there
and re-run it rather than editing the outputs.

### Data model (`js/store.js`)

Three `localStorage` keys, all accessed through the `Store` object (never
touch `localStorage` directly elsewhere):

- `fah_exercises` — flat array, the global reusable exercise library. Each
  entry is `{id, name, muscleGroup}` plus an optional `note` (at most 200
  characters, shown on the exercise's Today card); `muscleGroup` is one of
  the fixed `MUSCLE_GROUPS` options in `js/ui.js` (defaults to `"Other"` for
  entries created before this field existed). Set at creation via
  `Store.addExercise(name, muscleGroup)` and changed afterwards only through
  `Store.updateExercise` (see Exercise library below).
  Weight units are pounds throughout the UI; nothing in the data model is
  unit-typed, it's just a number. An exercise also carries an optional
  `minIncrement` (lb): the smallest weight step its equipment allows (5 for
  dumbbells that go 20, 25, 30; 10 for most machines), 2.5 when missing.
  It lives on the library entry on purpose — it is a fact about the
  equipment, not about one day's slot — so it is edited once (the "Min
  step" box in any Program slot row of that exercise, or Settings) and
  read by every slot, day and mesocycle whenever a prediction is built;
  it is never copied into a slot or a workout. See `nextSet` below.
  Each real muscle group has its own validated categorical color
  (`--mg-*` custom properties in `css/style.css`, applied via
  `renderMuscleTag()`/`muscleGroupClass()` in `js/ui.js` — always go
  through these rather than hand-rolling a `.muscle-tag` span, so a new
  group can't accidentally skip the palette). "Other" intentionally has no
  hue slot (falls back to `--muted`) — the categorical method caps at ~8-10
  reliably distinguishable hues; a genuinely new 11th+ named group should
  reuse "Other" rather than get a hand-picked color. The palette was chosen
  and validated with Claude's `dataviz` skill (`validate_palette.js`, dark
  mode against `--surface`); redo that validation if the hue set or the
  surface color ever changes.
- `fah_mesocycles` — array of every mesocycle ever created. Exactly one has
  `active: true` at a time; `Store.getActiveMesocycle()` is the source of
  truth for what `#/today` and `#/program` operate on. Each mesocycle owns
  its **live day template** (`days[]`, each with an ordered `exercises[]` of
  "slots" — a slot references an exercise plus its target sets/rep
  range/progression preset). Editing a slot or day here always affects the
  future, since this *is* the template. An optional `shifts` array
  (`[{date, days}]`, see Shifts and missed workouts below) moves the
  schedule after a missed day; a mesocycle without the key behaves exactly
  as before.
- `fah_workouts` — append-only array of generated/logged workout instances,
  each tagged with `mesocycleId` and `dayId`. A workout with anything logged
  is never deleted, so history survives switching or archiving mesocycles
  (only an untouched unfinished one is ever dropped and regenerated). A
  workout done on a date whose own schedule does not hold that day template
  carries `makeup: true` and `makeupFor` (the missed date).

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

### Shifts and missed workouts (`js/schedule.js`, `js/workout.js`)

A missed training day can be done on a later day (the user's case: train
Monday/Wednesday/Friday, miss Monday, do it Tuesday). Today shows a "Missed"
card (`missed` from `getTodayContext`, which is `findMissedDay`) when
nothing on the viewed date or later is logged and an earlier training day
has no logged workout. The missed day is the EARLIEST such day back to the
last logged workout, gap day or made-up date (at most 366 days back), so two
missed sessions are resumed in program order. `doMissedDay` does it one of
two ways, chosen by the card's "Shift mesocycle to fit" checkbox (read when
the button is clicked, so it needs no `change` route):

- Ticked: `Store.addShift` stores `{date: M, days: X - M}` on the mesocycle
  (M the missed date, X the day it is done). A shift inserts `days` gap days
  starting at `date`: those dates are rest days, and every later date maps
  back by the total of the shifts before it (`schedulePosition`).
  `resolveDayForDate` is the only place that applies this, so the week
  strip, the calendar, Program's weekdays (`offsetWeekday`), the week number
  (`weekNumber`) and the planned end (`plannedEndIso`) all follow. Use those
  helpers; never work out a weekday or a week from `startDate` alone.
  Several shifts in one mesocycle add up. On a day that is itself a training
  day the checkbox is ticked and disabled (that day's own workout has to
  move).
- Unticked (a rest day only): a one-off makeup workout is generated from the
  missed day's template on the viewed date, with `makeup: true` and
  `makeupFor: M`. Nothing else moves. A makeup workout is reconciled against
  its own day template and never dropped for a `dayId` mismatch. Once it
  is touched or finished, Today shows "Makeup for <date>." under the week
  strip instead of the "schedule changed" notice.

While the moved workout is untouched and nothing later is logged (`madeUp`
in `getTodayContext`), Today offers Undo (`undoMissedDay`): it removes the
shift (only the last one in `shifts`) or the makeup workout and leaves
storage as it was before. `missed` is null whenever `madeUp` is set, so the
card and the Undo notice never show together. Editing the start date keeps
the shifts, except those dated before the new start. A copy has no shifts
and starts after the source's shifted end. `validateBackup` checks `shifts`
(sorted, not overlapping, `days` a whole number from 1 to 366, none before
`startDate`).

Late logging: a past day can be opened, completed and finished at any time.
`refreshPredictions()` rebuilds the predictions of every unfinished
workout's untouched exercises; it is called after finish, reopen and
import, never from `getTodayContext` (that runs on every keystroke). So
finishing yesterday late feeds today's numbers. Today's screen also names
the most recent earlier workout left half logged, with a link to it.

### Lazy workout generation + progression (`js/workout.js` `generateWorkout`, `js/progression.js`)

`#/today` is date-aware, not just "today" — it reads an optional
`?date=YYYY-MM-DD` query string off the hash (`currentDateParam()`),
defaulting to the real current date, and renders the page header plus a
Monday-to-Sunday strip of that date's week (`renderDateNav`: each day a
link, arrows step a week, a "Today" button appears off today) so past days
can be reopened and backfilled. A calendar button in the header opens `renderCalendarPanel`, a read-only month view (one
month at a time, `App.ui.calendarMonth`, opening on the viewed date's month)
with a ‹ › pager and a dot per training day marking
finished/in-progress/untouched status (amber only once a set is touched:
just opening a day generates its workout). It pages back to the start month
and forward without limit — nothing stops the program at `numWeeks`, it
keeps scheduling, so a pager that ended there left later months
unreachable. Past the planned weeks the header says "Week n" instead of
"Week n of N" and today's screen shows a notice pointing to Settings (copy
the mesocycle to start the next one). A future training day previews its
plan from the template without generating anything. Days
before `startDate` are greyed and not links. It only reads
`Store.getWorkouts()` for that status, never calls `generateWorkout`, so
just opening the calendar can't create workout instances for days the user
hasn't visited. Each day is a plain `<a href="#/today?date=...">`, so
clicking one is an ordinary route change (closes the panel via the usual
`App.ui` hashchange reset, same as any other navigation). `getTodayContext()`
resolves that date's workout instance, generating one on first lookup for
that date (never for a date after today, so a future day can't be
prematurely snapshotted, and never before `startDate`). The `?date=` value
is only accepted as a real zero-padded `YYYY-MM-DD` (`currentDateParam`) —
it is a storage key and is rendered into the page. If the schedule moved
under an existing workout (start date edited, day removed and re-added) so
its `dayId` no longer matches that date's template, an untouched unfinished
one is dropped and regenerated; one with anything logged is kept and never
reconciled (reconciling against another day's template deletes every
exercise in it). Generation snapshots the day template's slots into
the workout's `exercises[]` and builds each slot's `sets[]` via
`buildPrefilledSets`, which finds, **per set index**, the most recent
*finished* workout where that exercise's set was actually logged
(`findLastLoggedSet`), and applies double progression (`nextSet` in
`js/progression.js`). History and predictions follow the **exercise, never
the slot** (`exerciseMatchers`): `exerciseId` + `slotId`, then `exerciseId`,
then `exerciseName` (entries with a missing/stale id; library names are
unique). The placeholder name "(unknown exercise)" never matches by name,
or two different deleted exercises would share one history. `slotId` only
breaks the tie when one day has the same exercise in two slots; when no
entry matches by `slotId` (a copied mesocycle has new slot ids) the k-th
slot of an exercise takes the k-th entry of it. Matching `slotId` first was
a bug: a swapped-in exercise got the previous exercise's history and
predictions. Each workout gives one entry, the most specific match; if that
entry's set is blank the lookup goes on to an older workout, never to the
exercise's other slot in the same workout. The lookup tries the same
`dayId` first, then workouts whose `dayName` equals the day's name (a copied
mesocycle keeps the names, so Monday's heavy squat follows Monday's and not
Thursday's lighter one), and only then any day, so a swapped-in exercise or
a new mesocycle's first week (new day ids) still gets a prediction. For the same
reason `confirm-substitute` rebuilds the sets' `baseWeight`/`baseReps` for
the new exercise and blanks every set (anything already entered was the old
exercise's and would be saved as the new one's history). The prediction is stored only in the set's
`baseWeight`/`baseReps` and shown as the inputs' **placeholder**
(`setWeightHint`/`setRepsHint` in `js/views/today.js`) — never written into
`weight`/`reps`, which hold only what the user typed. That's deliberate: a
filled-in prediction looked like a logged set, so mid-workout you couldn't
tell what was done, and finishing silently saved untouched predictions as
lifted. A consequence is that a skipped set is saved blank, which is why the
lookup is per set index (a skipped set falls back to an older workout
instead of losing its prediction). Unfinished workouts from before this
change carry a `prefilled` key on each set; `migrateLegacyPrefill`
migrates those once (clears untouched values back to blank). Each program slot has a
`progression` preset, and the weight step comes from the exercise's
`minIncrement` (`PRESETS` and `nextSet` in `js/progression.js`):

- Light: fill the rep range, then add one minimum step.
- Moderate (the default): fill the rep range, then add about 2.5 % of the
  weight.
- Aggressive: add weight from the middle of the range
  (`repRangeMin + ceil((max - min) / 2)`), about 5 % at a time.

Below the preset's trigger the next target is one more rep at the same
weight (capped at `repRangeMax`). At the trigger the weight goes up by the
preset's percentage rounded to the NEAREST whole number of minimum steps,
never fewer than one (`jumpedWeight`) — so a light weight still moves (2.5 %
of 20 lb is nothing, the step is one dumbbell up), and Light and Moderate
give the same jump wherever 2.5 % is under one and a half steps. The rep
target after a jump is **not** reset to `repRangeMin` — that would read as
an accidental deload (95x12 → 97.5x8 is a much easier set than 95x12).
It is `equivalentReps` (the same estimate `setRepsHint` uses to re-hint
reps after a same-workout weight edit, see below): one rep lost per
`pctPerRep(baseWeight)`% of load increase, where `pctPerRep` is one rep per
2.5 lb, held between 2.5 % (from 100 lb up, in line with published
reps-at-percentage tables) and 15 % (under 17 lb). The "one rep per 2.5 lb"
is fitted to the user's own week-over-week progressions (17.5x9 → 20x8,
15x8 → 20x6), which a test pins; everything between 17 and 100 lb
stretches those two points. Don't swap back to a single 1RM formula
(Epley/Brzycki): because it assumes one rep/weight curve for every exercise
it turned 15x9 → 20 lb into 20x1. If the estimate lands below
`repRangeMin` (a 10 lb machine step on a light weight), the weight does not
go up yet: the target is one more rep at the same weight, past the range
top if need be, until the jump lands inside the range. A set that missed
its target just gets "logged reps + 1" next time — there is no automatic
drop in weight (sets are taken to failure, and with coarse steps a back-off
only repeats the same failed jump). Bodyweight sets (0 lb) add a rep with
no cap. An earlier version had weight classes (light under 45 lb, heavy from
135 lb with a midpoint trigger) and a per-slot `weightIncrementPct`; both
are gone. The classes made the rule jump at 135 lb and, between about 35
and 122 lb, let the weight rise every week at no rep cost. Slots and
workout entries saved before presets still carry only `weightIncrementPct`:
`progressionOf` maps it when read (under 1.25 → light, up to 3.75 →
moderate, above → aggressive, missing → moderate), with no migration.
A workout entry snapshots its slot's `progression` like the rep range; a
preset or range edit on Program rebuilds the predictions of today's
untouched entry through reconciliation, and a `minIncrement` change calls
`refreshPredictions()`. The design, its sources and the simulations behind
it are summarised in the commit that introduced it.
No prior history → plain "wt"/"reps" placeholders (manual
baseline).

A **finished** workout's `exercises[]` snapshot is frozen — later template
edits never rewrite it, so history stays accurate to what was actually
logged. An **unfinished** one dated today (or later) is not: every time
`getTodayContext()` reads it, `reconcileWorkoutWithTemplate()` re-syncs it
against the day template's current slots (added/removed exercises,
reordered slots, changed sets/rep range/preset), preserving any sets
already logged (lowering a slot's sets only drops trailing untouched
sets; sets added because the target went up get their prediction there).
An exercise whose slot left the template is dropped only when none of its
sets is touched; with anything logged it stays, as a `oneOff`. An untouched
entry whose `exerciseId` differs from its slot's is rebuilt to the slot's
exercise unless it is flagged `swapped` (a "this workout only" swap) — that
is how an "all future" swap made on a reopened past day reaches today's
already generated workout. This is what makes a `#/program` edit reach an
already-generated but not-yet-finished `#/today` (including a same-day edit
made after that day's workout was generated). A **past-dated** workout is
never reconciled, even when unfinished or reopened via "Reopen Workout" —
it's already in the past, so it shouldn't gain exercises added to the
program since, and reconciling would also drop (with their logged sets) any
exercise removed from the program since. It still gets
`migrateLegacyPrefill`.

Separately, `handleTodayChange` in `js/views/today.js` also carries a just-entered
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
left alone. Carried sets stay unlogged, so they keep following later edits
of the source weight, and clearing it clears them again.

Each set row also has a "done" checkbox (`set.done`, handled by
`handleSetDoneChange`). Ticking it fills any still-empty box from its
placeholder hint — one tap logs a set done exactly as predicted — then locks
both inputs (`disabled`) until unticked; if a box has no numeric hint either,
the tick doesn't stick and focus moves to that box. When every set is done
the card gets `.complete` (`--success` outline, check mark after the name). `done`
is a tracking aid only — progression/history still go by `isCompleteSet`.
`isSetDone()` treats any complete set on a *finished* workout as done, since
workouts finished before this existed have no `done` flags; "Reopen
Workout" persists that (sets `done` on every complete set) so reopened sets
don't flip to unticked/unlocked. Unlike
`handleTodayChange`, this handler does call `renderCurrentView()`: the
no-re-render rule protects focus while typing, and a checkbox tap isn't.

The card header has two buttons: History, and a "more" toggle
(`App.ui.menuOpen`) that shows Swap / Note / Remove / Up / Down as labelled
buttons. Only one panel is open at a time (`closePanels`). A form submitted
with nothing chosen stays open and says why (`App.ui.formError`,
`renderFormError`); the same goes for `#/program`'s forms. "Finish workout"
asks first only when some set has no weight and reps (a filled-in but
unticked set is complete and needs no question).

### Edit scope: "this workout only" vs "all future"

Add/remove/substitute-exercise actions on `#/today` present a scope choice.
"This workout only" mutates just the current `fah_workouts` entry; "all
future" also mutates the mesocycle's live day template via `Store`
(`addExerciseSlot`/`removeExerciseSlot`/`updateExerciseSlot`). Because
today's unfinished workout is re-synced against the template on every read
(see above), a "this workout only" edit has to be recorded on the instance
or reconciliation undoes it on the next render (this actually happened —
one-off adds vanished and one-off removes came straight back): a one-off
added exercise is flagged `oneOff: true` (kept even though it has no
template slot), a one-off removed template slot goes into
`workout.skippedSlotIds` (never re-added), and a one-off substitute is
flagged `swapped: true` (never rebuilt to the template's exercise; an "all
future" substitute removes the flag). Reordering exercises has no scope
choice — it swaps the two exercises in the instance and the *same two*
slots in the template (`Store.swapExerciseSlotOrder`, not the template's own
neighbor, which can differ when a skipped slot sits between them), and
leaves the template alone when either is a `oneOff`. Reconciliation then
lays template-backed exercises out in template order within the positions
they occupy, leaving `oneOff` ones where they are.
`#/program` edits the template directly, so anything done there is always
"future" by definition.

### Event handling (`js/main.js`)

`#/today` with no `?date=` means the real current date, re-read on every
event. `pinViewedDay` guards the day changing under an open screen (a
session past midnight, or the app resumed the next day): on a click or
change the address is pinned to the day the screen was drawn for
(`history.replaceState`, no hashchange), so typed values and Finish land on
the workout the user is looking at; on return from the background it pins
only when that workout was left half logged, otherwise the new day shows.
Going to the background also blurs a focused input: set values are saved on
`change`, and a phone locked between sets could end the app before it
fired.

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
`handle*Action`/`handle*Change` function instead. An element with an empty
`data-action=""` is a click shield (the history sheet inside its backdrop):
`handleGlobalClick` ignores it, so a click inside neither closes the sheet
nor re-renders it. Escape closes the open overlay by clicking its
`close-*` button.

Keyboard and screen-reader behaviour lives in `renderCurrentView`
(`js/ui.js`), once for every view: while `#overlay-root` has content,
`#view` and `.bottom-nav` are `inert`, and `wrapOverlayFocus` (called from
the `keydown` listener in `js/main.js`) keeps Tab inside the overlay. After
an action re-render, focus goes back to the control that had it (matched by
`data-action`/`data-role` plus `data-slot`/`data-day`/`data-id`/`data-set`),
but only when that focus was `:focus-visible`: a touch tap must not leave a
focus ring behind.

Ephemeral UI state (which inline form/history panel is open) lives in the
module-level `App.ui` object, reset on every `hashchange` but preserved
across in-place re-renders triggered by an action (so an open form doesn't
snap shut after a click inside it).

### Views (hash routes, `renderCurrentView` in `js/ui.js`)

`#/today`, `#/program`, `#/history`, `#/settings` — each has a
`render<Name>(container)` function and, where interactive, a
`handle<Name>Action`/`handle<Name>Change` pair. All read from `Store` fresh
on every call; there is no separate app-state layer.

### Backup, copying a mesocycle, charts

- **Backup** (`#/settings`): `Store.exportBackup()` is handed over as a JSON
  file — through the share sheet where it takes files (an installed iOS app
  cannot download), else as a download. Import is a trust boundary: ids,
  dates and set numbers are rendered into attributes and text unescaped
  everywhere (the app generates them), so `validateBackup` rejects the whole
  file unless each has the exact shape the app writes. Keep it in step with
  any new stored field that is rendered unescaped. Numbers only have to be
  numbers: an out-of-range one is not a reason to refuse the file (data
  saved by older versions was not clamped and must still restore) —
  `normalizeMesocycles` clamps them on import, and `Store.normalize()` does
  the same once at startup for what is already stored. Import replaces
  everything after an inline confirm (`App.pendingImport`) and is all or
  nothing: if storage runs out part-way the old data is put back and
  `importBackup` returns false. The replaced data is kept under
  `fah_before_import` when there is room.
- **Failed writes**: `writeJSON` never throws; it sets `Store.writeFailed`
  and calls `Store.onWriteError`, which shows a notice at the top of the
  screen (`showStorageError` in `js/ui.js`, added to the page directly
  because the failure can come from typing into a set, which must not
  re-render).
- **Copy** (`Store.cloneMesocycle`): new ids for the mesocycle, its days and
  slots, inactive, no workouts. Day templates are offsets from the start
  weekday, so the copy starts on the same weekday as the original (first
  such date after its planned end, or after today) to keep every training
  day on its weekday.
- **Exercise library** (`#/settings`): `Store.updateExercise(id, {name,
  muscleGroup, note})` is the only way an exercise changes after creation.
  A rename also rewrites `exerciseName` in every workout entry of that id
  or carrying the old name, finished ones included, so history follows it.
  It returns null and changes nothing for an empty name, a name another
  exercise has, or a name carried by workout entries of a different
  exercise id (a deleted exercise's history would merge into this one); a
  case-only rename is allowed. The note is edited from the Today card's
  "more" menu and is cut to 200 characters.
- **Summary and PRs**: a finished workout's Today screen shows a summary
  card (sets completed, total volume, PR count) and a badge on each PR
  exercise; History's expanded detail shows the same badge. `exercisePR`
  compares against finished workouts dated strictly earlier: "weight" when
  this workout's heaviest complete set beats every earlier one, else "reps"
  when a set has more reps than ever done at that weight or heavier and an
  earlier set at exactly that weight exists, else null (also when there is
  no earlier history).
- **History sheet** (`getExerciseHistory`): every finished entry of the
  exercise from every day and slot, newest first, each row labelled with
  its date and day name, plus "1 of 2" when one day has the exercise twice.
  The user's rule: the same exercise on two days is one history, and the
  label says which day a row came from. (Predictions are narrower on
  purpose: same day first, see above.)
- **Charts** (`js/chart.js`, History sheet, two or more dates): top-set
  weight and total volume per date, the most recent 12 dates (more points
  than that cannot be tapped on a phone). Not an estimated 1RM, for the same
  reason `nextSet` does not use one. Single series, so no legend; the
  readout shows the latest point or the one hovered/tapped
  (`handleChartPoint`, delegated on `#overlay-root`; a mouse leaving the
  chart restores the latest, a lifted finger keeps the tapped one).
