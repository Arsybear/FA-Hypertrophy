# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A free, barebones personal alternative to the RP Hypertrophy app: a
mesocycle-based workout program builder with built-in double-progression
prefill. No RIR tracking, no volume-landmark dashboard — that was explicitly
scoped out; see README.md for the feature list.

The app is called FAR Hypertrophy (FA Hypertrophy up to version 41). Only
the name people see changed (page title, manifest, Settings, the backup
file's name and error text, the mark). The repository and its URL,
`BACKUP_APP` (`"fa-hypertrophy"`), the `fa-hypertrophy-v*` cache names and
the `fah_*` storage keys keep the old name on purpose: an installed app, its
stored data and every backup made so far depend on them.

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

On an iPhone the app runs as a home-screen app, and two things there come
from iOS, not from this code. The status bar style is `black` (opaque), not
`black-translucent`: with the translucent bar and `viewport-fit=cover`, iOS
26 and 27 give the page a viewport one status bar shorter than the screen
(WebKit bug 313800). The page still starts at the top, so an empty band as
tall as the top inset is left under the bottom nav, and nothing can be drawn
in it (the user's phone: the nav stood 93px above the screen's edge, 59 of
band and 34 of safe-area padding). For an install that still runs
translucent, `#view` starts below the status bar (`top:
env(safe-area-inset-top)`, so scrolled content never shows through the
clock), and `markShortViewport` (`js/main.js`) sets `.short-viewport` on
`<html>` when the app is standalone on iOS, in portrait, the top inset is
above 0 and `screen.height - innerHeight` equals it: the class sets
`--safe-bottom` (the home indicator's inset, used by `#view`, the nav and
the history sheet) to 0, because the band already clears the home
indicator. It is never set with an opaque bar (top inset 0) or once the
viewport is the screen's height again. None of this can be checked in a
desktop browser: it is verified by the owner's screenshots.

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
double progression, weekday resolution and shifts, cycles that are not a
week long, missed days, the pick among them and undo, the swipe rule,
reconciliation, PRs, library edits, copying a mesocycle, backup
validation) plus the release checks: every loaded file is in `sw.js`'s
`ASSETS`, `APP_VERSION` equals `CACHE_NAME`, and `sw.js` itself run against
fakes of the cache and the network (install, cache-first fetch, the refill
of a lost cache, activate). Run it before committing. Everything else is
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
cache is only ever written with files of its own version, a whole set at a
time (with `cache: "reload"`, past the browser's HTTP cache): at install, and by
`refill()` when a GET for a precached file misses the cache. A browser can
drop a cache, or one entry, and keep the worker (WebKit can remove caches left
unopened for a few weeks), and install never runs again for the same
`CACHE_NAME`, so without the refill the app would load from the network
from then on and stop starting offline. `refill()` fetches the whole
`ASSETS` set into a scratch cache (`<CACHE_NAME>-refill`; `addAll` writes
all of it or nothing) and copies it over only when the fetched
`js/version.js` carries the worker's own version, so the files of a newer
deploy are left to that deploy's worker (and the old worker stops
refilling once it has seen one, `newerDeploy`). A scratch cache a killed
worker left behind is removed by the next refill or the next version's
`activate`, which deletes only caches named `fa-hypertrophy-*`: github.io
is one origin for every project on it. Single responses are never written while the
app runs: an earlier stale-while-revalidate version did that, so a deploy
followed by a dropped connection could leave one cache holding modules from
two versions, and the next offline launch failed to link them (blank page).
An installed instance therefore changes only when `CACHE_NAME` changes — that
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
Status is never colour alone: a done day is a filled dot, a day in progress
a ring, and both words are in the day's `aria-label`. "In progress" means
any set touched, for the dot and for Today's status pill alike; typing a
set value never re-renders, so `syncDayStatus` (`js/views/today.js`) patches
the pill, the week-strip day and the open calendar's cell in place.
Inputs are 16px (anything smaller makes iOS zoom the page on focus) and tap
targets are at least 44px (`--tap`). Selects and date inputs are
`appearance: none` (the select's arrow is a data URI in the stylesheet):
iOS draws both as native buttons and then sizes them itself, which replaced
`min-height` (a 37px select beside a 44px input) and made a date input's
width content-box (it stuck out of its card by its padding and border).
Hover styles sit inside `@media (hover: hover)`: on a phone a hover look
stays on the button after a tap. Prediction placeholders are `--muted`
at full opacity (above 4.5:1 on the input, and lighter in weight than a
typed value); the outline of an empty control (unticked done circle, text
box, select) is `--control-edge`, a neutral grey just above 3:1 on the card
— `--muted` there made a column of empty circles louder than the numbers. The mark (a knight's helmet in
black and white, drawn from straight facets: a broad dome, a V-shaped sight
that frowns, the letters FAR cut across the visor with the A on the centre
seam, a jaw plate and a chin point, with one accent: the right eye burns in
mulberry, a ragged flame that starts in the right half of the sight and ends
past the helmet's outline) is drawn by
`scripts/make_icons.py`, which writes `icons/icon.svg`, `icons/mark.svg`
and the PNG sizes; change the mark there and re-run it rather than editing
the outputs. The mark is polygons, strokes and the flame's curves, so the script renders the PNGs
from the SVG with headless Chrome or Edge (no Pillow). The flame's rims are
its outline stroked outward; its five colours run from `#7c2457` at the rim
through `--accent` to near white. Version 42 redrew it for the new name (the
user: "change the plate to read FAR", "Remove elements below the actual
helmet", "potentially pivot it a more angular and aggressive angle"): the
two neck plates are gone and nothing lies below the chin. What the drawing
rounds taught, so they are not tried again: a sharp crest over straight
flanks reads as a gem, two separate eye wedges read as a mask (one V sight
with a rivet at each visor pivot reads as a helmet), a second colour or a
dark half of the helmet vanishes into the icon's background at 180 px, and
the letters need strokes about 21 wide to read at that size. Two other
drawings (the old rounded helmet with FAR, and one with counterchanged
halves) are kept as scripts in the git-ignored `wip-icon/far/`.

### Data model (`js/store.js`)

Three `localStorage` keys, all accessed through the `Store` object (never
touch `localStorage` directly elsewhere). At startup `js/main.js` asks the
browser for persistent storage (`navigator.storage.persist()`), so it does
not clear the log when it frees space; a refusal changes nothing.

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
  surface color ever changes. A tag is text, so each hue is also at least
  4.5:1 on `--surface`.
- `fah_mesocycles` — array of every mesocycle ever created. Exactly one has
  `active: true` at a time; `Store.getActiveMesocycle()` is the source of
  truth for what `#/today` and `#/program` operate on. Each mesocycle owns
  its **live day template** (`days[]`, each with an ordered `exercises[]` of
  "slots" — a slot references an exercise plus its target sets/rep
  range/progression preset). Editing a slot or day here always affects the
  future, since this *is* the template. An optional `shifts` array
  (`[{date, days}]`, see Shifts and missed workouts below) moves the
  schedule after a missed day; a mesocycle without the key behaves exactly
  as before. An optional `cycleLength` (whole days, 1 to 14) is how long the
  program takes to repeat; without the key it is 7, a weekly program (see
  Scheduling below).
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
`resolveDayForDate(mesocycle, date)` takes the date's offset in the cycle
(`cycleOffset`: whole days since `startDate`, modulo the cycle's length; in
a weekly program that is `(weekday - mesocycleStartWeekday(mesocycle) + 7)
% 7`, and a test keeps that old formula as an oracle for every mesocycle
without a `cycleLength`) and returns
whichever day template's own `weekdayOffset` (0 to the cycle's length - 1, set once at creation via
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

A program does not have to be a week long (the user: "Allow programs that
don't span weeks neatly such as 8 day or 6 day on repeat"). `cycleLength(meso)`
(`js/schedule.js`) is the one place that reads the mesocycle's `cycleLength`:
a whole number from 1 to `MAX_CYCLE` (14), anything else or no key is 7. It
is set in Settings ("Cycle length (days)", on create and on the active
mesocycle) and goes through `cleanCycleLength` (`js/store.js`), which also
never lets a cycle be shorter than the days placed in it (a day past the
end would never train); the Settings box shows what was saved. Off 7 a day
has no weekday: Program shows "Day k of n" and the next date it comes round
(`nextDateOfOffset`) on the day card and in the "Trains on" picker, and
`offsetWeekday` is used for a 7-day cycle only. What stays in calendar
weeks whatever the cycle: `numWeeks`, `weekNumber` ("Week n of N"),
`plannedEndIso`, the Monday-to-Sunday week strip, and the progression pace
(`weekOf`). So in a cycle shorter than a week a day template can come round
twice in one Monday-to-Sunday week, and the second time it has no units due
(the same targets again): the pace is a weekly one by the user's design, and
a test pins this.

### Shifts and missed workouts (`js/schedule.js`, `js/workout.js`)

A missed training day can be done on a later day (the user's case: train
Monday/Wednesday/Friday, miss Monday, do it Tuesday). Today shows a "Missed"
card (`missedDays` from `getTodayContext`, which is `findMissedDays`) when
nothing on the viewed date or later is logged and an earlier training day
has no logged workout. The list holds the training days back to the last
logged workout, gap day or made-up date (at most 366 days back), one entry
per day template at its EARLIEST missed date, earliest first. The first
entry is the default, so two missed sessions are resumed in program order.
With more than one entry (the user's case: "I last didn't complete day 2 but
took a week off and want to start on day 1 or day 3"; then "After at least 2
training days were skipped call it pick back up from and select any missed
day as start point") the card is titled "Pick back up from", which is the
label of a select of the missed days, and the user picks which day to resume
with; the days missed before a later pick stay behind as they are. A picked
day is a start point, so in this form "Shift mesocycle to fit" starts ticked
(Claude's reading of "start point", not the user's words); on a rest day it
can be unticked for a one-off makeup. A day template with no
missed date in that range is not offered (there is no shift backwards). The
pick is kept in `App.ui.missedPick`, and choosing one patches the hint's
day count in place (`handleMissedPick`: a re-render would put the checkbox
back to its default). `doMissedDay(meso, date, today, shift, pickIso)` does the picked
day (a `pickIso` that is not in the list does nothing) one of two ways,
chosen by the card's "Shift mesocycle to fit" checkbox (it and the select
are read when the button is clicked):

- Ticked: `Store.addShift` stores `{date: M, days: X - M}` on the mesocycle
  (M the missed date, X the day it is done). A shift inserts `days` gap days
  starting at `date`: those dates are rest days, and every later date maps
  back by the total of the shifts before it. `schedulePosition` is the only
  place that applies this; `resolveDayForDate`, `weekNumber`,
  `plannedEndIso`, `offsetWeekday` and `findMissedDay` build on it, so the
  week strip, the calendar, Program's weekdays, the week number and the
  planned end all follow. Use those helpers; never work out a weekday or a
  week from `startDate` alone. A gap day never shows the Missed card (a
  second shift from there would leave that day a rest day), and neither does
  a date before a shift that is already stored (after a later pick the
  skipped days lie there: a shift from one of them would start under the
  stored one, move the day it placed and take its Undo away).
  Several shifts in one mesocycle add up. The planned end moves only for
  shifts dated on or before it; a copy and Program's weekdays count every
  shift. On a day that is itself a training
  day the checkbox is ticked and disabled (that day's own workout has to
  move).
- Unticked (a rest day only): a one-off makeup workout is generated from the
  missed day's template on the viewed date, with `makeup: true` and
  `makeupFor: M`. Nothing else moves. A makeup workout is reconciled against
  its own day template and never dropped for a `dayId` mismatch. Once Undo
  is no longer offered (it is touched, finished, or something later is
  logged), Today shows "Makeup for <date>." under the week strip instead of
  the "schedule changed" notice.

While the moved workout is untouched and nothing later is logged (`madeUp`
in `getTodayContext`), Today offers Undo (`undoMissedDay`): it removes the
shift (only the last one in `shifts`) or the makeup workout and leaves
storage as it was before. `missed` is null whenever `madeUp` is set, so the
card and the Undo notice never show together. Editing the start date keeps
the shifts, except those dated before the new start. A copy has no shifts
and starts after the source's shifted end. `validateBackup` checks `shifts`
(sorted, not overlapping, `days` a whole number from 1 to 366, none before
`startDate`). It also checks each day's `weekdayOffset` against a cycle (a
whole number, 0-6 without a `cycleLength`, 0-13 with one), while
`cycleLength` itself only has to be a number: `normalizeMesocycles` brings
it into 1-14 and lengthens it to hold its days on import and at startup.

Late logging: a past day can be opened, completed and finished at any time.
`refreshPredictions()` rebuilds the predictions of every unfinished
workout's untouched exercises; it is called after finish, reopen and
import, and once at startup (`js/main.js`, after `Store.normalize()`),
never from `getTodayContext` (that runs on every keystroke). So finishing
yesterday late feeds today's numbers, and a workout generated before an
update that changed the progression rules does not keep the old rule's
numbers (reconciliation cannot see that: slot and entry carry the same
preset). Today's screen also names
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
(`findLastLoggedEntry`; `findLastLoggedSet` wraps it), and applies the
progression rule to all the sets of the exercise together (`nextSets` in
`js/progression.js`, see The progression rule below). History and predictions follow the **exercise, never
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
migrates those once (clears untouched values back to blank). It runs for
every unfinished workout inside `refreshPredictions()` (so at startup and
after an import) and in `contextFor` before the stale-workout check: an old
prediction left in `weight`/`reps` otherwise counts as a touched set. Each program slot has a
`progression` preset and each exercise a `minIncrement`; what they do is
under The progression rule below. A workout entry snapshots its slot's
`progression` like the rep range; a preset or range edit on Program
rebuilds the predictions of today's untouched entry through
reconciliation, and a `minIncrement` change calls `refreshPredictions()`.
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
`migrateLegacyPrefill`. The week strip and the calendar show a stored
workout only when it is finished, touched or a makeup
(`shownWorkoutsByDate`); an untouched one left on a date the schedule no
longer trains is ignored there, as opening that date would drop it.

Separately, `handleTodayChange` in `js/views/today.js` also carries a just-entered
**weight** (as a real value, not a hint) into every other not-yet-logged set
of the same exercise **whose predicted `baseWeight` equals the edited set's**
— if the prediction had all sets at one weight, same weight across all sets
is the common case; if it had deliberately different weights (last week's
drop set), those stick. With no prediction, every `baseWeight` is `null`, so
it carries everywhere. It writes both the data model and those other
`<input>` elements directly, since this handler intentionally avoids
`renderCurrentView()` (see below), and refreshes their reps placeholder
(`refreshRepsHint`) to the rep estimate at the new weight (`hintReps` in
`js/progression.js`: held inside the rep range, widened to include the
predicted reps, so at the predicted weight the hint is the prediction even
when that lies outside the range — the tick must save what the placeholder
showed). Reps are never
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

### The progression rule (`js/progression.js`)

Two separate systems, by the user's design ("system 1 is essentially the
user setting how aggressively they want to and think they could progress.
Moderate being average"; the second exists because "increasing a rep at 230
is much harder than increasing a rep at 10 pounds"). Since version 36
system 1 also has a weekly minimum, again the user's rule: "Light case is
the only one that doesn't have to have progression every week. It is fine
if in reality the user doesn't hit the targets every week but the target in
moderate and aggressive cases should be a weekly gain."

1. **The preset is a pace with a weekly minimum**: two numbers per preset
   in `PRESETS`, and what is asked is the larger of the two.
   - `repsPerWeek` is the pace in rep-equivalents (one more rep at the same
     weight, or the weight that costs one rep), the same at every load:
     Light 0.2, Moderate 0.4 (the default), Aggressive 0.8 (from 100 lb up
     that is about 0.5 / 1 / 2 % of the load a week). A fraction of a rep
     cannot be asked in one session, so whole units fall due in some
     calendar weeks: `dueUnits(perWeek, week, phase)` is
     `floor(perWeek + u)`, `u` a golden-ratio sequence over the weeks
     shifted by the exercise's phase.
   - `weeklyUnits` is the least asked in a week, in the unit of the lever
     the lift uses (a rep on a reps-first lift, one minimum step on a
     weight-first lift, see 2): Light 0, Moderate 1, Aggressive 1.5. It
     goes through `dueUnits` as well, so 1.5 is one unit every week and a
     second in about half the weeks (1, 2, 1, 2, 2, 1, ...).

   Light is therefore the pace alone, and exactly version 35's Light: 20x10
   on a curl rises in one week of five, and a week with nothing due repeats
   last time's set, except at the range top: there a reps-first lift jumps
   in any week, and so does a weight-first lift whose weakest set is at the
   range bottom (Light 405x8 + 405x4 in 4-8 at a 2.5 lb step: 407.5 lb with
   nothing due). Moderate asks one rep or one step every week, Aggressive
   one or two. The pace gives more than the minimum only where a step is
   cheap: 405 lb at a 2.5 lb step gets one or two steps a week on Moderate,
   225 lb at 2.5 two steps in four weeks of five on Aggressive, both as in
   version 35. The minimum is what changed the rest: 20x10 on a curl is
   20x11 every week on Moderate (version 35: two weeks of five), 225x8 in
   6-10 at a 5 lb step is 230x8 every week (version 35: under half the
   weeks).
   `week` is `weekOf(the workout's date)` (whole weeks since Monday
   1970-01-05 in UTC, so Monday to Sunday share a number) and `phase` is
   `phaseOf(key)` (a hash in [0, 1), so lifts at one rate do not all rise
   in the same weeks). A prediction therefore depends only on the workout's
   date, the exercise and its history, never on the day the app is opened:
   `generateWorkout`, reconciliation, `refreshPredictions` and a swap give
   the same sets. Versions up to 34 asked one more rep every session;
   version 35 had the pace alone.
2. **The load picks the lever.** `stepCost(weight, minIncrement)` is what
   one minimum step costs in reps at that weight. Where a step costs under
   one rep (`weightFirst`: a 2.5 lb step above 100 lb, a 5 lb step above
   200 lb, a 1.25 lb step above 8 1/3 lb) and the reps are above the range
   bottom, the due units are weight steps at the same reps, and never more
   steps than the reps above the range bottom pay for (`room`; what does
   not fit is not asked: 235x7 in 6-10 at a 5 lb step gets one step, also
   in a two-unit week). At the range bottom a weight-first lift is asked
   reps, and there the minimum is one rep on Aggressive too
   (`Math.min(floor, 1)`): on a heavy lift the rep is the expensive unit,
   and two reps asked at the range top came out as three steps (270x10,
   270x7, 270x5 in 6-10 at a 5 lb step: 285 lb; now 275).
   Everywhere else the units are reps (light dumbbells, big machine steps;
   a cost of exactly one rep asks reps), and the weight goes up by a jump:
   from `triggerReps` (Light at the range top, Moderate a quarter of the
   range width below it, Aggressive at the middle: 12 / 11 / 10 of 8-12;
   `PRESETS[p].jumpQuarters`) the weight rises, in any week, by the fewest
   steps that bring the reps, with the week's units added, back to no more
   than the logged reps, converted at the step's cost (95x10 aggressive →
   97.5x10 in a one-unit week, 100x10 in a two-unit week; on Light with
   nothing due the jump itself asks nothing more: 20x12 at a 5 lb step →
   25x10). Below the range top a jump is taken only where the logged reps,
   converted to the new weight, stay in the range
   (`at(j).reps - demand >= repRangeMin`): the week's units must not be
   what makes a jump land. A machine at 100 lb with a 10 lb step went
   100x10 → 110x8 on Aggressive, a set the lifter cannot do; it now climbs
   to 100x12 first (100x11 then 100x12, or straight to 100x12 in a two-unit
   week) and jumps from the top, to 110x9, or 110x10 in a two-unit week.
   Below the top the target reps never pass the top either (two reps due
   at 100x11 on that machine ask for 100x12). The reps after a jump are never reset to `repRangeMin`:
   that would read as an accidental deload. At the top, a jump that would
   land under the range (a 10 lb machine step on a light weight) is not
   taken: the reps keep rising, past the range top, until a jump lands.

The rest of one set's rule (`plan`, behind `nextSet`):

- Under the range: one more rep at the same weight every session, whatever
  the preset.
- Reps above the range top (sets are taken to failure, so the log is what
  was done): `max(due steps, 1)` steps and never more, the reps capped at
  the range top, so one big log never doubles the weight (20x20 in 8-12 at
  a 2.5 lb step → 22.5x12).
- Bodyweight (0 lb): the due reps, no cap (0x10: 0x11 on Moderate, 0x12 on
  Aggressive in a two-unit week).
- A log from the same calendar week as the target (a new day template
  falling back to this week's log of another day, or a makeup in the week
  of that day's next session) has no units due, the weekly minimum
  included (a jump, the overshoot step and +1 under the range still apply:
  this week's 100x11 on Moderate gives 102.5x10). Skipped weeks are not
  caught up.
- Set 1's target weight is never below its last logged weight, and there
  is no automatic back-off (with coarse steps a back-off only repeats the
  same failed jump).

**The sets of one exercise are planned together** (`nextSets`). Set 1 and
every set that had set 1's weight in its own last logged workout (straight
sets) form a group with one target weight, decided from set 1; planned one
by one, straight sets ended up at different weights in most weeks. The
weight-first condition reads the weakest set of the group, so the weight
does not climb away from a set sitting at the range bottom. The other sets
of the group take set 1's weight and set 1's demand from their own reps
(no demand when set 1 is under the range, where its +1 is not a demand,
or when set 1's log or the set's own log is from the target's week): at an
unchanged weight, reps plus the week's demand (+1 under the range); at a
changed weight, the reps converted to the new weight, shown as computed
even under the range (a tick logs the placeholder, so it has to be a set
the lifter can do). The reps are capped at the range top, or at set 1's
target reps when those are higher; bodyweight has no cap. A set that had
another weight than set 1 in its own workout (a drop set, a pyramid) is
planned alone, and so is every set when set 1 has no history or was left
blank last time. A straight set always takes the group's weight, also one
that fell back to an older workout (skipped last time): sending such a set
on alone split it off for good, because once logged at its own weight
beside a heavier set 1 it reads as a drop set. When its log is at another
weight than set 1's last one and converting it to the group's weight costs
more than `MAX_CONVERT_REPS` (4) reps, it gets the weight and no rep
target (`reps: null`: 150x9 under a 185 lb group would be 187.5x1, a
guess); the set row then shows the weight and a plain "reps" box, and a
tick moves focus there. Testing every lighter set for joining was turned
down: it pulls a deliberate drop or back-off set into the group whenever
its reps are high (30 lb then a drop to 25x12 converts to 30x10). A group
set follows set 1 even when its own older log was heavier. Known limit:
with set 1 left blank the sets are planned alone that week and can stay
apart afterwards, until they are logged at one weight again.

The conversions (`equivalentReps`, also behind `hintReps`, which re-hints
reps after a same-workout weight edit): one rep lost per
`pctPerRep(baseWeight)`% of load increase, where `pctPerRep` is one rep per
2.5 lb, held between 2.5 % (from 100 lb up, in line with published
reps-at-percentage tables) and 15 % (under 17 lb). The "one rep per 2.5 lb"
is fitted to the user's own week-over-week progressions (17.5x9 → 20x8,
15x8 → 20x6), which a test pins; everything between 17 and 100 lb
stretches those two points. Don't swap back to a single 1RM formula
(Epley/Brzycki): because it assumes one rep/weight curve for every exercise
it turned 15x9 → 20 lb into 20x1.

In the app: `plan` and `nextSet` throw a TypeError without a whole week or
a phase (the tests rely on it), so `buildPrefilledSets`, the only caller,
returns blank sets when the workout's date gives no whole week (a
hand-edited "2026-13-01"): `refreshPredictions` runs at startup, and a
throw there would stop the app. The phase key is the library exercise's
id, found by id and then by name as `minIncrementFor` finds it (else the
entry's own id, else its name), so an old entry with no `exerciseId` and a
renamed exercise keep their weeks. Nothing new is stored for this rule.
Slots and workout entries saved before presets still carry only
`weightIncrementPct`: `progressionOf` maps it when read (under 1.25 →
light, up to 3.75 → moderate, above → aggressive, missing → moderate),
with no migration.

What it does not do, on purpose. For a lifter who trains to failure the
preset changes the loaded weight little (a simulated lifter gaining 0.4
rep-equivalents a week, 8 lifts, 3 sets: after 26 weeks the load is 1.36 /
1.39 / 1.43 times the start on Light / Moderate / Aggressive; 225 lb at a
2.5 lb step with strength rising 1 % a week ends 52 weeks at 335 / 340 /
342.5 lb, the same as under version 35): the logged
reps carry the real strength, and reps above the top force a step whatever
the preset. The preset sets how demanding the targets are, and the screen
text (`PRESET_HELP` in `js/ui.js`) says that and promises nothing faster.
The same simulation gives how often every target of a week is hit by the
lifter a preset is named for: Light 60 % at a gain of 0.2, Moderate 58 %
at 0.4, Aggressive 71 % at 0.8 (version 35: 60 / 71 / 87 %). That is why
Aggressive's minimum is 1.5 and not 2: with 2 (an earlier candidate of
this rule, before the cap at the range top and the one-rep limit on heavy
lifts) it was 53 %, and 20 % for the lifter gaining 0.4 (now 39 %), a
preset almost nobody hits. The price: in its one-unit weeks Aggressive
asks what Moderate asks from the same log, except at its earlier jump
point and where its pace gives more steps.

Known limits of the weekly minimum, left on purpose (the rule is reopened
only if Light stops being version 35's, a Moderate or Aggressive log in the
range from an earlier week gets no gain on set 1, or something throws):

- A weight-first lift with set 1 at the range top and its weakest set at
  the bottom is asked one rep, and at the top a rep is paid in weight: 405x8
  + 405x4 in 4-8 at a 2.5 lb step is 412.5 lb every week on Moderate and
  Aggressive alike (version 35: 412.5 in the weeks with a unit due, 407.5
  otherwise). Leaving that shape as it was gave no gain at all in one-rep
  ranges, so it was turned down. Below the top the same shape is asked one
  rep on both presets (225x9 + 225x6 in 6-10 at 2.5: 225x10, 225x7 every
  week), so Moderate and Aggressive are equal there.
- At its earlier jump point Aggressive can ask a little less than Moderate
  from the same log, because the reps after a jump are rounded (5x6 in 4-8
  at a 1.25 lb step: Moderate 5x7, Aggressive 6.25x5 in a one-unit week);
  at most a third of a rep, and rarer than in version 35.
- On a reps-first lift where no jump lands in the range (a one-rep range
  such as 8-8, or a step that is huge for the load: 5 lb with a 10 lb
  step) the reps are asked past the top every week (5x8 in 8-8 at a 1.25
  lb step: 5x9), and in a one-rep range Aggressive's two-unit week can ask
  two reps where one rep would have let the jump land (6.25x8: 6.25x10,
  then 7.5x8).
- A two-unit week can hold a weight that a one-unit week would raise: 135x10
  in 8-12 at a 5 lb step on Aggressive is 140x10 in a one-unit week and
  135x12 in a two-unit week (two steps would put the logged reps under the
  range, so the jump waits and the reps are asked).
- A later set gets no gain where set 1 is held under the range or the set
  is already at the top beside a set 1 that holds, as in version 35.
- The 71 % for Aggressive is pooled over the lifts: on lifts with a big
  step (machine at 10 lb, dumbbell press at 5 lb) the lifter gaining 0.8
  hits every target in about 40 % of weeks (version 35: about 80 %). Set
  1 is never under the range there; a later set's target is under it in
  most weeks, as in version 35.

Variants simulated and turned down: a reps-first jump only when every set
of the group lands in the range (later sets' targets under the range fell
from 19 % to 2 %, but the load after 24 weeks fell 5 points); catching up
skipped weeks; for the weekly minimum, raising the paces to a whole rep a
week (225 lb at a 2.5 lb step would be asked two to three steps a week on
Moderate), a minimum of 2 for Aggressive (above), and moving the steps
that do not fit under `room` into reps (a step and a rep in one week, and
set 1 above the range top). Earlier rules, all gone: weight classes (light
under 45 lb, heavy from 135 lb) with a per-slot `weightIncrementPct` (the
rule jumped at 135 lb); in versions 32 to 34, presets that only set how
much weight was added once the range was full (`jumpedWeight`), with one
more rep asked every session, so the three presets asked the same pace;
in version 35, the pace alone, which left a Moderate target equal to last
time's set in three weeks of five on a reps-first lift. `PRESETS` is the
one place to change a rate, a minimum or a jump point.

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
fired. A route change does the same (`hashchange` in `js/main.js`): Back,
Forward or a swipe moves no focus, so the focused box is blurred before its
screen is replaced, with the address put back to the old one for that
moment so the value lands on the route and day the box was drawn for.

A global delegated `click` and `change` listener is attached **once** to
the `#view` container at startup (`handleGlobalClick`/`handleGlobalChange`),
dispatching by `currentRoute()` and `data-action`/`data-role` attributes.
`currentRoute()` returns "today" for any name that is not a registered
route, so a mistyped address draws Today with working handlers (it used to
draw Today with none: a typed set value showed and was not saved).
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

A swipe left or right moves on or back (`attachSwipeNav` in `js/main.js`,
touch events on `#view`, passive). Where it starts decides what moves
(`swipeControl`): on the open month calendar its months, on the week strip
its weeks, anywhere else the screens of the bottom nav. It works by
`click()` on the control a tap would use (the calendar's month button, the
week arrow, the nav link), so a disabled or missing control means nothing
happens (the calendar's start month, the first week, the first and last
screen: nothing wraps), and a week or a screen is an ordinary route change
whose `hashchange` handler commits a focused box. `swipeStep` (`js/ui.js`)
decides: at least 60px, at most 600ms, and twice as far sideways as up or
down. A swipe is ignored when it starts within 24px of either screen edge
(iOS starts its own back and forward swipes there), with two fingers, or
while a text box or select in `#view` has focus (a route change closes an
open form and would drop what was typed into it). An open overlay makes
`#view` inert, so nothing swipes under it. What the swipe opened slides in
from the side the finger came from (`playSlide`: the classes `slide-next` /
`slide-prev` on `#view`, or on the calendar panel for a month; 180ms, off
under `prefers-reduced-motion`). Only the new content moves: the old screen
is gone at once, there is no pane that follows the finger. A tap on the
same controls does not animate.

Keyboard and screen-reader behaviour lives in `renderCurrentView`
(`js/ui.js`), once for every view: while `#overlay-root` has content,
`#view` and `.bottom-nav` are `inert`, and `wrapOverlayFocus` (called from
the `keydown` listener in `js/main.js`) keeps Tab inside the overlay. After
an action re-render, focus goes back to the control that had it (matched by
`data-action`/`data-role` plus `data-slot`/`data-day`/`data-id`/`data-set`),
but only when that focus was `:focus-visible`: a touch tap must not leave a
focus ring behind. When the action removed that control (a form opened in
its place, or closed), keyboard focus moves to the form that opened for the
same item, else to that item's own buttons, instead of falling to `<body>`.
A control that is still there but disabled itself (Up on the card that
became first, Previous month at the start month) hands focus to its
opposite move button, else to the nearest enabled control beside it
(`nearestEnabled`).

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
  the same once at startup for what is already stored. Duplicate ids
  (exercises, mesocycles, workouts, the days or the slots of one mesocycle)
  are refused: two workouts with one id would save sets into the wrong one.
  More than one active mesocycle is repaired, not refused (the first stays
  active). Import replaces
  everything after an inline confirm (`App.pendingImport`) and is all or
  nothing: if storage runs out part-way the three keys are cleared first and
  then the old data is put back (it always fits again), and `importBackup`
  returns false. The replaced data is kept under `fah_before_import` when
  there is room; a copy from an earlier import is removed first, so the key
  never holds anything but what the last import replaced.
- **Failed writes**: `writeJSON` never throws; it sets `Store.writeFailed`
  and calls `Store.onWriteError`, which shows a notice at the top of the
  screen (`showStorageError` in `js/ui.js`, added to the page directly
  because the failure can come from typing into a set, which must not
  re-render).
- **Copy** (`Store.cloneMesocycle`): new ids for the mesocycle, its days and
  slots, inactive, no workouts, no shifts. Day templates are offsets from
  the start date, so the copy starts where the source's schedule would
  have gone on: at its shifted end (`startDate` + `numWeeks` weeks, rounded
  up to whole cycles, + `totalShiftDays`), moved on by whole cycles until it
  is not before today. In a weekly program that keeps every training day on
  the weekday it has now — the original's weekdays when nothing was shifted,
  the shifted ones otherwise; in a 6-day or 8-day rotation it keeps the
  order of the days unbroken. The copy keeps the `cycleLength`.
- **Exercise library** (`#/settings`): `Store.updateExercise(id, {name,
  muscleGroup, note})` is the only way an exercise changes after creation.
  A rename also rewrites `exerciseName` in every workout entry of that id
  or carrying the old name, finished ones included, so history follows it.
  It returns null and changes nothing for an empty name, a name another
  exercise has, or a name carried by workout entries of a different
  exercise id (a deleted exercise's history would merge into this one); a
  case-only rename is allowed. If the workouts cannot be written (storage
  full) the library change is put back too, so a name never changes without
  its history. The note is edited from the Today card's
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
