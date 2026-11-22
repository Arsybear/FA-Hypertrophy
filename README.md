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
- Three progression presets per exercise slot (light, moderate, aggressive)
  set how fast the targets rise. A minimum weight step per exercise (5 lb
  dumbbells, 10 lb machine stacks) decides whether a rise is one more rep
  or a small weight step, and a prediction only asks for a weight your
  equipment has. Sets done at one weight share one target weight.
- Week strip and month calendar of the training block; finish, reopen and
  backfill workouts, also late (a workout left half logged is pointed out
  the next time you open the app).
- Missed a day: do it on a later day, either as a one-off or with "Shift
  mesocycle to fit", which moves every later workout along with it. Undo
  while nothing is logged.
- A summary of each finished workout, with weight and rep PR badges.
- Per-exercise history across every day it is trained on, with top-set and
  volume charts.
- Rename an exercise or change its muscle group (its history follows), and
  keep a note per exercise.
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
