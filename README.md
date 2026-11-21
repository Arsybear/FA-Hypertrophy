# FA Hypertrophy

A free, barebones personal alternative to the RP Hypertrophy app: a
mesocycle-based training program tracker with built-in double-progression
prefill (no RIR tracking, no volume-landmark dashboard).

## Features

- Mesocycles scheduled on literal days of the week, with rest days wherever
  you leave a gap.
- Programmable training days: add, remove and reorder days and exercises,
  create new exercises, swap an exercise for one workout or for all future
  workouts of that day.
- Double-progression predictions: each set shows the next weight and reps to
  beat as a greyed hint, from the last time you logged that exercise. Tick a
  set to log it exactly as predicted.
- Week strip and month calendar of the training block; finish, reopen and
  backfill workouts.
- Per-exercise history with top-set and volume charts.
- Copy a mesocycle as the starting point for the next one.
- Export and import a backup file.
- Works offline once loaded; all data stays in the browser.

## Running it

This is a static site — no build step, no dependencies. A local static
server is required (not `file://`) so the service worker can register:

```
npx serve .
# or
python -m http.server
```

Then open the printed local URL. `node scripts/test.mjs` runs the logic
self-check.

## Installing on your phone

Open the site in your phone's browser, then use "Add to Home Screen" (Safari)
or "Install app" (Chrome). It runs full-screen and works offline once loaded.

## Data

Everything is stored locally in the browser's `localStorage` — nothing is
sent to a server. Clearing browser data for the site will erase your program
and history, so export a backup from Settings now and then.
