# FA Hypertrophy

A free, barebones personal alternative to the RP Hypertrophy app: a
mesocycle-based training program tracker with built-in double-progression
prefill (no RIR tracking, no volume-landmark dashboard).

## Features

- Mesocycles scheduled on literal days of the week (Mon-Sun), with a
  changeable start day that wraps the split around the week.
- Programmable training days: add/remove/reorder days and exercises, create
  new exercises, substitute an exercise for one workout or for all future
  workouts of that day.
- Double-progression prefill: after the first time you log a given weekday's
  workout, weight/reps for each set are pre-filled (greyed out) based on your
  last performance and each exercise's target rep range + weight increment.
- Mark a workout finished; browse history; see a quick weight×reps history
  per exercise.
- Create multiple mesocycles and explicitly switch which one is active.

## Running it

This is a static site — no build step, no dependencies. A local static
server is required (not `file://`) so the service worker can register:

```
npx serve .
# or
python -m http.server
```

Then open the printed local URL in your phone's browser (same Wi-Fi network,
use your computer's LAN IP), or open it on desktop for testing.

## Installing on your phone

Open the site in your phone's browser, then use "Add to Home Screen" (Safari)
or "Install app" (Chrome). It runs full-screen and works offline once loaded.

## Data

Everything is stored locally in the browser's `localStorage` — nothing is
sent to a server. Clearing browser data for the site will erase your program
and history.
