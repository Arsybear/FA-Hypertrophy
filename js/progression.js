import { Store } from "./store.js";

// The progression rule: the preset is the rate, the load picks the lever.
//
// SYSTEM 1, the preset: a demand in rep-equivalents a week, the same at every
// load. One rep-equivalent = one more rep at the same weight, or the weight
// that pctPerRep says costs one rep (from 100 lb: 2.5 % of the load).
// Moderate and Aggressive also ask a least number of units of the lever
// every week, a weekly gain: Moderate one rep or minimum step, Aggressive one
// every week and a second in about half the weeks. Light asks only its pace,
// so some weeks ask nothing more.
// SYSTEM 2, the lever, set by the load and the equipment only: the demand is
// asked as weight steps where one step costs under one rep and the logged
// reps are above the range bottom; otherwise as reps.
// A fraction of a rep or step cannot be asked in one session: it falls due as
// whole units on calendar weeks (dueUnits), from the workout's date and the
// exercise, so a prediction never depends on the day the app is opened.
export const REP_COST_LB = 2.5; // one rep per 2.5 lb: the user's points (17.5x9 -> 20x8, 15x8 -> 20x6)
export const MAX_PCT_PER_REP = 15; // cap for very light weights
export const MIN_PCT_PER_REP = 2.5; // floor, reached at 100 lb
export const DEFAULT_MIN_INCREMENT = 2.5;
export const MAX_CONVERT_REPS = 4; // a fallback converted further than this gets no rep target (the fit covers jumps of 1-2 reps; 4 = the 8-12 width)
export const DEFAULT_PROGRESSION = "moderate";
// repsPerWeek: the pace, in rep-equivalents a week = 0.5 / 1 / 2 % of
// capacity a week from 100 lb. weeklyUnits: the least asked each week (not
// the log's own week), in the lever's unit (reps, or minimum steps), as a
// rate due in whole units like the pace (1.5: one every week and a second
// in about half the weeks); a weight-first lift asked as reps gets one rep
// at most (a rep on a heavy lift is the expensive unit). jumpQuarters: on
// reps-first lifts, how far below the range top the effort-neutral jump is
// taken, in quarters of the range width (0 = at the top). These are the one
// place to change a preset.
export const PRESETS = {
  light: { repsPerWeek: 0.2, weeklyUnits: 0, jumpQuarters: 0 }, // long-term intermediate (Human Kinetics: 0.42-0.56 %/wk)
  moderate: { repsPerWeek: 0.4, weeklyUnits: 1, jumpQuarters: 1 }, // between that and 8-week studies of trained lifters (1.3-2.1 %/wk)
  aggressive: { repsPerWeek: 0.8, weeklyUnits: 1.5, jumpQuarters: 2 }, // 8-week trained-to-failure rates (Schoenfeld 2016 squat 2.1 %/wk)
};
export const PROGRESSIONS = Object.keys(PRESETS);
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);
const GOLDEN = 0.6180339887498949; // (sqrt 5 - 1) / 2

// Effort-neutral conversions only (jumps, hintReps, the user's two points).
export function pctPerRep(weight) {
  return Math.min(MAX_PCT_PER_REP, Math.max(MIN_PCT_PER_REP, (REP_COST_LB / weight) * 100));
}

export function equivalentReps(baseWeight, baseReps, newWeight) {
  if (baseWeight == null || baseReps == null || newWeight == null || newWeight <= 0 || baseWeight <= 0) return null;
  const pctChange = (newWeight / baseWeight - 1) * 100;
  return Math.max(1, Math.round(baseReps - pctChange / pctPerRep(baseWeight)));
}

// What one minimum step costs, in reps, at this weight.
export function stepCost(weight, minIncrement) {
  return ((minIncrement / weight) * 100) / pctPerRep(weight);
}

// Weight first when one step is a smaller ask than one rep. From 17 to 100 lb
// the cost is step / 2.5 whatever the load, so the default 2.5 lb step sits
// exactly on the edge: a cost of exactly 1 asks reps, exactly 0.5 (1.25 lb)
// asks weight. The 1e-9 guard is deliberate, so float error cannot move the
// 2.5 lb default across the edge.
export function weightFirst(weight, minIncrement) {
  return stepCost(weight, minIncrement) < 1 - 1e-9;
}

// The workout's week: whole weeks since Monday 1970-01-05, from the ISO date
// in UTC (no DST), so Monday to Sunday of one calendar week share a number.
export function weekOf(isoDate) {
  return Math.floor(Math.round((Date.parse(`${isoDate}T00:00:00Z`) - EPOCH_MONDAY) / 864e5) / 7);
}

// The exercise's phase in [0, 1): FNV-1a of its id (its name when an entry
// has none), then the murmur3 finaliser so names a letter apart ("Curl A",
// "Curl B") still land far apart. Lifts at one rate then do not all rise in
// the same weeks, and every set and slot of one exercise share the phase.
export function phaseOf(key) {
  const s = String(key ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The rep count from which a reps-first lift may jump: the range top minus
// jumpQuarters quarters of the width, rounded half up, in integers only
// (8-12: 12 / 11 / 10; 5-8: 8 / 7 / 6; 10-15: 15 / 14 / 12).
export function triggerReps(progression, repRangeMin, repRangeMax) {
  return repRangeMax - Math.floor(((repRangeMax - repRangeMin) * PRESETS[progression].jumpQuarters + 2) / 4);
}

// Whole units (reps or steps) due this week at `perWeek` units a week:
// floor(perWeek + u), u a golden-ratio sequence over the weeks shifted by the
// exercise's phase. Long run: exactly perWeek; gaps near even (Light at 0.2:
// 2, 3, 5 or 8 weeks apart, 5 on average, see spec-lines.txt); a higher rate is due in every week a
// lower one is; a weight change moves only weeks near the threshold.
export function dueUnits(perWeek, week, phase = 0) {
  const u = (((week * GOLDEN + phase) % 1) + 1) % 1; // a week before 1970-01-05 is negative
  return Math.floor(perWeek + u + 1e-9);
}

// Double progression with a demand, for one set. Under the range: one more
// rep at the same weight, every session, whatever the preset (getting back
// into the range is not paced). Otherwise the week's due units in the
// lever's unit, at least the week's floor (dueUnits of weeklyUnits:
// Moderate 1, Aggressive 1 or 2, Light 0):
//  - bodyweight: those units as reps, no cap.
//  - weight first: the due steps at the same reps, but never more steps than
//    the reps above the range bottom pay for (at least one).
//  - a weight-first lift with its reps at the range bottom is asked reps; the
//    floor is then one rep at most (Aggressive's two-unit week too: two reps
//    there turned into three steps at the top), and below the range top the
//    reps never pass the top.
//  - reps first: the due reps; on reps-first lifts from triggerReps (any week)
//    the weight goes up by the fewest steps that bring the reps back to no
//    more than the logged reps (at the range top: into the range), at
//    equivalentReps, so the jump itself asks nothing more. Below the top the
//    jump is taken only where the logged reps, converted to the new weight,
//    stay in the range (the week's demand must not be what makes it land);
//    otherwise the reps keep rising, never past the range top. At the top a
//    jump that would land under the range is not taken: the reps keep growing
//    past it until a jump lands.
//  - reps above the range top (overshoot): max(due steps, 1) steps, never
//    more, reps capped at the range top, so one log never doubles the weight
//    (20x20 8-12 /2.5 -> 22.5x12). If that step would land under the range,
//    no step: the reps keep growing.
// A log from the same calendar week as the target (logWeek === week: a new
// day template falling back to this week's log of another day, or a makeup
// in the week of that day's next session) has no units due: the target
// matches it (jumps and the overshoot step still apply; under the range
// still +1). Otherwise the target week's units; skipped weeks are not caught
// up. logWeek: weekOf(the date of the workout prevSet comes from); null or
// missing = an earlier week.
// The target weight is never below the last logged weight. No back-off.
// Returns the target plus the week's demand (its ask in reps at the logged
// weight), which nextSets hands on to the other sets of the group.
// leverReps: the reps the weight-first condition reads (nextSets: the weakest
// set at set 1's last weight; one set alone: its own reps).
// week: weekOf(the workout's date). phase: phaseOf(the library exercise's id;
// see buildPrefilledSets).
function plan(prevSet, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeek = null, leverReps = prevSet && prevSet.reps) {
  if (!prevSet || prevSet.reps == null || prevSet.weight == null) return null;
  if (!Number.isInteger(week)) throw new TypeError("nextSet needs the workout's week: weekOf(date)");
  if (!(phase >= 0 && phase < 1)) throw new TypeError("nextSet needs the exercise's phase: phaseOf(library exercise id)");
  const { weight, reps } = prevSet;
  if (reps < repRangeMin) return { weight, reps: reps + 1, demand: 0 };
  const perWeek = PRESETS[progression].repsPerWeek;
  const floor = dueUnits(PRESETS[progression].weeklyUnits, week, phase); // the least asked this week, in the lever's unit
  const units = (x, least = floor) => (logWeek === week ? 0 : Math.max(least, dueUnits(x, week, phase)));
  if (weight <= 0) { const d = units(perWeek); return { weight, reps: reps + d, demand: d }; }
  const inc = minIncrement || DEFAULT_MIN_INCREMENT;
  const cost = stepCost(weight, inc);
  const byWeight = leverReps > repRangeMin && weightFirst(weight, inc);
  const room = Math.max(1, Math.floor((leverReps - repRangeMin) / cost + 1e-9)); // steps the reps above the range bottom pay for
  const due = byWeight ? Math.min(units(perWeek / cost), room) : units(perWeek, weightFirst(weight, inc) ? Math.min(floor, 1) : floor);
  const demand = byWeight ? due * cost : due; // in reps at `weight`
  const at = (j) => ({ weight: Math.round((weight + j * inc) * 1000) / 1000, reps: Math.max(1, Math.round(reps + demand - j * cost)), demand });
  if (reps > repRangeMax) {
    const s = at(Math.max(byWeight ? due : 0, 1));
    return s.reps >= repRangeMin ? { ...s, reps: Math.min(repRangeMax, s.reps) } : at(0);
  }
  if (byWeight) return at(due);
  if (!weightFirst(weight, inc) && reps >= triggerReps(progression, repRangeMin, repRangeMax) && reps < repRangeMax) { // reps-first lifts only
    let j = 1;
    while (at(j).reps > reps) j++;
    if (at(j).reps - demand >= repRangeMin) return at(j); // an early jump only where the logged reps, converted, stay in the range
  }
  if (reps < repRangeMax) { const s = at(0); return { ...s, reps: Math.min(s.reps, repRangeMax) }; } // below the top: never past it
  let j = 1; // at the top
  while (at(j).reps > repRangeMax) j++;
  return at(j).reps >= repRangeMin ? at(j) : at(0);
}

export function nextSet(prevSet, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeek = null) {
  const p = plan(prevSet, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeek);
  return p && { weight: p.weight, reps: p.reps };
}

// All sets of one exercise in a workout. prevSets[i]: set i's last logged
// set (findLastLoggedSet) or null. firstWeights[i]: the weight of set 1 in
// the workout set i was logged in (null when set 1 was not logged there).
// The group: set 1 (index 0) and every set that had set 1's weight in its
// own workout (a straight set). Set 1 decides the group's weight (nextSet),
// except that the weight-first condition (reps above the range bottom) reads
// the weakest set of the group: while any straight set sits at the bottom,
// the group's demand is asked as reps, so the weights do not climb away from
// it. Every other set of the group takes set 1's weight with the same demand,
// from its own last reps:
//  - weight unchanged from the set's own log: under the range +1 (every
//    session, as for set 1), otherwise reps + demand. The demand is 0 in a
//    Light week with nothing due, when set 1 is under the range (its +1 is
//    not a demand: 100x7 + 100x9 in 8-12 gives 100x8, 100x9), and when set
//    1's log or the set's own log is from the target's week.
//  - weight changed: reps + demand minus the change in reps at the set's own
//    logged weight (equivalentReps arithmetic; for a set logged with set 1
//    this is set 1's own conversion, reps + demand - steps x cost). Shown as
//    computed, also under the range: a tick logs the placeholder, so it must
//    be a set the lifter can do.
//  - capped at the range top, or at set 1's target reps when set 1 is past
//    the top (a step too big to land yet). Bodyweight: no cap.
// A set that had another weight than set 1 in its own workout (drop set,
// pyramid) and every set when set 1 has no history: each on its own nextSet,
// as before. A straight set that fell back to an older workout (skipped last
// time) always takes the group's weight, so one skipped set never splits the
// weights for good (alone, it would be logged at its own weight, read as a
// drop set and never rejoin). Its own log at another weight than set 1's last
// and the conversion costing more than MAX_CONVERT_REPS reps: the group's
// weight with reps null (no rep target, the box shows plain "reps"), since a
// conversion that far is a guess (150x9 under a 185 group would be 187.5x1).
// A set logged with set 1 always keeps a number (the 10 -> 20 lb doubling).
// The weakest set (the weight-first condition) is read from set 1 and the
// group sets at set 1's own last weight only, so such a set never holds the
// group back.
// logWeeks[i]: weekOf(the date of the workout prevSets[i] comes from) (see
// plan). The group's weight follows set 1's log week; a group set whose own
// log is from the target's week gets no demand (it matches, converted to
// the group's weight). Set 1 is never
// asked below its last weight; a group set follows set 1's weight even when
// its own (older) log was heavier (set 1 150 after a deload, set 2's older
// log 200: set 2 is asked 152.5). Set 1 blank in the latest workout: no
// group that week, each set alone.
export function nextSets(prevSets, firstWeights, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeeks = []) {
  const inGroup = (prev, i) => i > 0 && prev && prev.reps != null && prev.weight != null && prev.weight === firstWeights[i];
  const first = prevSets[0];
  const weakest = Math.min(...prevSets.filter((p, i) => i === 0 || (inGroup(p, i) && first && p.weight === first.weight)).map((p) => p && p.reps));
  const lead = plan(first, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeeks[0], weakest);
  return prevSets.map((prev, i) => {
    if (i === 0) return lead && { weight: lead.weight, reps: lead.reps };
    if (!lead || !inGroup(prev, i)) return nextSet(prev, repRangeMin, repRangeMax, progression, minIncrement, week, phase, logWeeks[i]);
    const w = prev.weight, W = lead.weight;
    const cost = w > 0 ? ((W / w - 1) * 100) / pctPerRep(w) : 0; // reps lost converting w to W
    if (w !== first.weight && w > 0 && cost > MAX_CONVERT_REPS + 1e-9) return { weight: W, reps: null };
    const demand = logWeeks[i] === week ? 0 : lead.demand; // a log from the target's week: no units (per set)
    let reps = W === w ? prev.reps + (prev.reps < repRangeMin ? 1 : demand) : Math.max(1, Math.round(prev.reps + demand - cost));
    if (W > 0) reps = Math.min(reps, Math.max(repRangeMax, lead.reps));
    return { weight: W, reps };
  });
}

// The reps placeholder for a set whose weight box holds `weight`: the
// estimate from the prediction (baseWeight x baseReps), held to the rep range
// widened to include baseReps, so at the predicted weight it is exactly
// baseReps (a prediction outside the range is shown, and saved by a tick,
// as predicted). Null when there is no estimate.
export function hintReps(baseWeight, baseReps, weight, repRangeMin, repRangeMax) {
  const estimate = equivalentReps(baseWeight, baseReps, weight);
  if (estimate == null) return null;
  return Math.min(Math.max(estimate, Math.min(repRangeMin, baseReps)), Math.max(repRangeMax, baseReps));
}

// Slots and entries saved before presets have only weightIncrementPct (the
// old per-slot % step): mapped by the old presets' cut points (0 / 2.5 / 5 %),
// a tie going to moderate.
export function presetFromPct(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return DEFAULT_PROGRESSION;
  if (pct < 1.25) return "light";
  if (pct <= 3.75) return "moderate";
  return "aggressive";
}

// A slot's or entry's preset. Checked with includes, never PRESETS[x]: a
// value like "constructor" would find an inherited property.
export function progressionOf(slotOrEntry) {
  return PROGRESSIONS.includes(slotOrEntry.progression) ? slotOrEntry.progression : presetFromPct(slotOrEntry.weightIncrementPct);
}

// The exercise's minimum weight step from the library: by id, then by name
// (entries with a missing or stale id; never the shared unknown name), else
// the default. Read when a prediction is built, never copied.
export function minIncrementFor(library, exerciseId, exerciseName) {
  const ex = (exerciseId != null && library.find((e) => e.id === exerciseId))
    || (exerciseName != null && exerciseName !== UNKNOWN_EXERCISE && library.find((e) => e.name === exerciseName));
  const v = ex && ex.minIncrement;
  return typeof v === "number" && v > 0 ? v : DEFAULT_MIN_INCREMENT;
}

export function isCompleteSet(s) {
  return !!s && s.weight != null && s.reps != null;
}

// Ordered tests for "is this logged entry the exercise I mean". History and
// predictions follow the exercise, never the slot: a slot's exercise can be
// swapped, and the swapped-in one must not inherit the old one's numbers.
// slotId only breaks the tie when one day has the same exercise in two
// slots. The name fallback covers entries whose exerciseId is missing or
// stale (exercise removed from the library and re-created) — library names
// are unique (Store.addExercise), so a name match is the same exercise.
// With no exerciseId to look for, only the name can match: a missing id
// would otherwise equal every other entry's missing id. UNKNOWN_EXERCISE is
// the name given to a slot whose exercise is not in the library: two
// different missing exercises share it, so it never matches by name.
export const UNKNOWN_EXERCISE = "(unknown exercise)";

export function exerciseMatchers(slotId, exerciseId, exerciseName) {
  const byName = exerciseName != null && exerciseName !== UNKNOWN_EXERCISE;
  return [
    (e) => exerciseId != null && e.exerciseId === exerciseId && e.slotId === slotId,
    (e) => exerciseId != null && e.exerciseId === exerciseId,
    (e) => byName && e.exerciseName === exerciseName,
  ];
}

// A workout's entries matching one test, in their order on the screen.
export function matchingEntries(workout, match) {
  return workout.exercises.filter(match).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// The one entry of `workout` that is the exercise meant: the most specific
// matcher that finds any. When the slot itself is not there (a cloned
// mesocycle's new slot ids) and the exercise has several entries, the
// `occurrence`-th one (0-based, by order) stands for the occurrence-th slot of
// that exercise on the day, or the last one when there are fewer.
export function findMatchingExercise(workout, matchers, occurrence = 0) {
  for (const match of matchers) {
    const hits = matchingEntries(workout, match);
    if (hits.length) return hits[Math.min(occurrence, hits.length - 1)];
  }
  return null;
}

// Whether this workout's entry `ex` beat every earlier finished workout of
// the same exercise: "weight" (heaviest complete set ever), else "reps" (a
// set with more reps than any earlier set at that weight or heavier, where
// that exact weight was done before), else null — also when there is
// nothing earlier to beat.
export function exercisePR(workouts, workout, ex) {
  const matchers = exerciseMatchers(ex.slotId, ex.exerciseId, ex.exerciseName);
  const earlier = workouts
    .filter((w) => w.finished && w.date < workout.date)
    .flatMap((w) => w.exercises.filter((e) => matchers.some((match) => match(e))))
    .flatMap((e) => e.sets.filter(isCompleteSet));
  const mine = ex.sets.filter(isCompleteSet);
  if (earlier.length === 0 || mine.length === 0) return null;
  const heaviest = (sets) => Math.max(...sets.map((s) => s.weight));
  if (heaviest(mine) > heaviest(earlier)) return "weight";
  const repPR = mine.some((s) => {
    const atLeast = earlier.filter((e) => e.weight >= s.weight);
    return atLeast.some((e) => e.weight === s.weight) && s.reps > Math.max(...atLeast.map((e) => e.reps));
  });
  return repPR ? "reps" : null;
}

// Find the most recent finished workout (date < beforeIsoDate) where this
// exercise has a complete set at setIndex, and return that workout's entry
// of the exercise. Same day template first (the same exercise can run
// heavier on one day than another), then a day of the same name (a copied
// mesocycle has new day ids but keeps the names), and only then any day —
// e.g. an exercise just swapped in.
// Looked up per set, not per exercise: a set left blank last time (skipped,
// since untouched predictions are never saved) falls back to the most
// recent workout where it was actually logged. Each workout stands for one
// entry (findMatchingExercise), so a skipped set never takes the set of
// another slot of the same exercise. `occurrence`: see findMatchingExercise.
// Returns { entry, date } (date: that workout's date) or null.
function findLastLoggedEntry(workouts, dayId, slotId, exerciseId, setIndex, beforeIsoDate, exerciseName, dayName = null, occurrence = 0) {
  const candidates = workouts
    .filter((w) => w.finished && w.date < beforeIsoDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const matchers = exerciseMatchers(slotId, exerciseId, exerciseName);
  const pools = [candidates.filter((w) => w.dayId === dayId)];
  if (dayName != null) pools.push(candidates.filter((w) => w.dayName === dayName));
  pools.push(candidates);

  for (const pool of pools) {
    for (const w of pool) {
      const ex = findMatchingExercise(w, matchers, occurrence);
      if (ex && isCompleteSet(ex.sets[setIndex])) return { entry: ex, date: w.date };
    }
  }
  return null;
}

// The set itself (see findLastLoggedEntry).
export function findLastLoggedSet(workouts, dayId, slotId, exerciseId, setIndex, beforeIsoDate, exerciseName, dayName = null, occurrence = 0) {
  const found = findLastLoggedEntry(workouts, dayId, slotId, exerciseId, setIndex, beforeIsoDate, exerciseName, dayName, occurrence);
  return found ? found.entry.sets[setIndex] : null;
}

export function blankSet(setIndex) {
  return { setIndex, weight: null, reps: null, baseWeight: null, baseReps: null, isLogged: false, done: false };
}

// Build a slot's sets for a new workout. weight/reps stay null — they only
// ever hold what the user actually typed. The double-progression prediction
// lives in baseWeight/baseReps and is shown as the inputs' placeholder.
// All sets are predicted together (nextSets): each set's last log, plus the
// weight set 1 had in the workout that log comes from, which decides whether
// the set is a straight set of set 1's group, and the week of that workout
// (a log from the target's own week has no units due).
// A date that gives no week (malformed beforeIsoDate) gives blank sets, never
// a throw: this runs at startup (refreshPredictions).
// The phase is keyed on the library exercise found by id, then by name (as
// minIncrementFor), so an entry without exerciseId and a renamed exercise
// keep their phase.
// dayName and occurrence: see findLastLoggedSet (optional).
export function buildPrefilledSets(slot, workouts, dayId, beforeIsoDate, exerciseName, dayName = null, occurrence = 0) {
  const progression = progressionOf(slot);
  const library = Store.getExercises();
  const inc = minIncrementFor(library, slot.exerciseId, exerciseName);
  const week = weekOf(beforeIsoDate);
  if (!Number.isInteger(week)) return Array.from({ length: slot.targetSets }, (_, i) => blankSet(i));
  const libEx = (slot.exerciseId != null && library.find((e) => e.id === slot.exerciseId))
    || (exerciseName != null && exerciseName !== UNKNOWN_EXERCISE && library.find((e) => e.name === exerciseName));
  const phase = phaseOf(libEx ? libEx.id : slot.exerciseId || exerciseName);
  const found = Array.from({ length: slot.targetSets }, (_, i) => findLastLoggedEntry(workouts, dayId, slot.id, slot.exerciseId, i, beforeIsoDate, exerciseName, dayName, occurrence));
  const prevSets = found.map((f, i) => (f ? f.entry.sets[i] : null));
  const firstWeights = found.map((f) => (f && isCompleteSet(f.entry.sets[0]) ? f.entry.sets[0].weight : null));
  const logWeeks = found.map((f) => (f ? weekOf(f.date) : null));
  return nextSets(prevSets, firstWeights, slot.repRangeMin, slot.repRangeMax, progression, inc, week, phase, logWeeks).map((s, i) => {
    const set = blankSet(i);
    if (s) {
      set.baseWeight = s.weight;
      set.baseReps = s.reps;
    }
    return set;
  });
}
