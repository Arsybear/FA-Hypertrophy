import { Store } from "./store.js";
import { DEFAULT_PROGRESSION, PROGRESSIONS } from "./progression.js";

// updateAvailable lives outside App.ui (which resets on every hashchange)
// since it needs to persist across navigation until the user reloads.
export const App = { ui: {}, updateAvailable: false, pendingImport: null };

export const MUSCLE_GROUPS = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Quads", "Hamstrings", "Glutes", "Calves", "Abs", "Other",
];

// "Other" (and anything unrecognized) has no dedicated hue — the CSS
// default (--muted) applies when this returns "".
export function muscleGroupClass(name) {
  return MUSCLE_GROUPS.includes(name) && name !== "Other" ? `mg-${name.toLowerCase()}` : "";
}

export function renderMuscleTag(name) {
  return `<span class="muscle-tag ${muscleGroupClass(name)}">${escapeHtml(name)}</span>`;
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// "1 exercise", "2 exercises".
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function fmtNum(n) {
  return n == null ? "" : n;
}

export function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// Workout entries from before exercises had ids carry only the name, so the
// name is the fallback (library names are unique, ignoring case).
// The library entry a workout exercise refers to: by id, else by name
// (entries with a missing or stale id). Null when neither matches.
export function findLibraryExercise(exerciseId, exerciseName) {
  const library = Store.getExercises();
  const name = exerciseName ? exerciseName.toLowerCase() : null;
  return library.find((e) => e.id === exerciseId)
    || (name && library.find((e) => e.name.toLowerCase() === name)) || null;
}

// exercisePR's result as a badge beside an exercise name (Today, History).
export function renderPrBadge(pr) {
  return pr ? `<span class="badge pr">${pr === "weight" ? "Weight PR" : "Rep PR"}</span>` : "";
}

export function getExerciseMuscleGroup(exerciseId, exerciseName) {
  const exercise = findLibraryExercise(exerciseId, exerciseName);
  return (exercise && exercise.muscleGroup) || "Other";
}

export function renderExerciseOptionsGrouped(excludeId, onlyGroup) {
  let library = Store.getExercises().filter((e) => e.id !== excludeId);
  if (onlyGroup) library = library.filter((e) => (e.muscleGroup || "Other") === onlyGroup);
  const byGroup = Object.create(null); // a group name can be anything, even "__proto__"
  for (const ex of library) {
    const group = ex.muscleGroup || "Other";
    (byGroup[group] = byGroup[group] || []).push(ex);
  }
  return Object.keys(byGroup).sort().map((group) => `
    <optgroup label="${escapeHtml(group)}">
      ${byGroup[group].map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")}
    </optgroup>`).join("");
}

export function renderMuscleGroupSelect(dataRole, dataAttrs = "", lockedValue = null, selectedValue = null) {
  const selected = lockedValue || selectedValue;
  return `<select data-role="${dataRole}" ${dataAttrs} aria-label="Muscle group" ${lockedValue ? 'disabled data-locked="true"' : ""}>
    ${MUSCLE_GROUPS.map((g) => `<option value="${g}" ${g === selected ? "selected" : ""}>${g}</option>`).join("")}
  </select>`;
}

// The progression preset choice (Program slot row, both add forms).
const PRESET_LABELS = { light: "Light", moderate: "Moderate", aggressive: "Aggressive" };

export function renderProgressionSelect(dataRole, dataAttrs = "", selected = DEFAULT_PROGRESSION) {
  return `<select data-role="${dataRole}" ${dataAttrs} aria-label="Progression">
    ${PROGRESSIONS.map((p) => `<option value="${p}" ${p === selected ? "selected" : ""}>${PRESET_LABELS[p]}</option>`).join("")}
  </select>`;
}

// What each preset does, in the user's terms: a pace in reps, which heavy
// lifts get as small weight steps (see nextSet in progression.js).
export const PRESET_HELP = `<ul class="preset-help muted">
  <li>Light: one more rep about every five weeks, or its worth in weight. A pace you can keep for years.</li>
  <li>Moderate: one more rep every week, or at least one small weight step on heavy lifts. Missing a week is normal.</li>
  <li>Aggressive: one or two more reps every week, or one or more weight steps on heavy lifts. Expect misses.</li>
</ul>`;

// The "Min step (lb)" box: the library exercise's minIncrement, one value
// per exercise wherever it shows (empty means the 2.5 default).
export function renderMinStepInput(dataRole, value, dataAttrs = "") {
  return `<input type="number" inputmode="decimal" step="any" min="0.25" max="100" placeholder="2.5"
    data-role="${dataRole}" ${dataAttrs} value="${escapeHtml(value ?? "")}">`;
}

// A finger's travel as a move between the bottom nav's screens: 1 to the
// screen on the right (a swipe to the left), -1 to the one on the left, 0
// for anything that is not a quick, mostly horizontal swipe (a scroll, a
// tap, a slow drag).
export function swipeStep(dx, dy, ms) {
  if (ms > 600 || Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

// An unknown name (#/bogus) is Today, so the screen drawn, the active nav
// link and the handlers agree.
export function currentRoute() {
  const name = location.hash.replace(/^#\/?/, "").split("?")[0];
  return Object.hasOwn(routes, name) ? name : "today";
}

export function emptyMesoState() {
  return `<div class="empty-state">
    <img class="empty-mark" src="icons/mark.svg" alt="">
    <h2>No active mesocycle</h2>
    <p class="muted">Create a training block to start logging.</p>
    <a href="#/settings" class="btn primary">Create one in Settings</a>
  </div>`;
}

// The message a form's action left in App.ui.formError (nothing chosen, no
// name typed): the form stays open and says why.
export function renderFormError() {
  return App.ui.formError ? `<p class="warn-text" role="alert">${escapeHtml(App.ui.formError)}</p>` : "";
}

// "6 weeks · starts Mon, Nov 2" from its parts (plain text, escaped here).
// A line too long for the screen wraps between parts, never inside one.
export function metaLine(parts) {
  return parts.filter(Boolean).map((p) => `<span class="nowrap">${escapeHtml(p)}</span>`).join(" · ");
}

// Top of every screen: the mark, a title, an optional line under it (text,
// or an array of parts for metaLine) and an optional control on the right
// (already-rendered HTML).
export function pageHeader(title, subtitle = "", right = "") {
  const sub = Array.isArray(subtitle) ? metaLine(subtitle) : escapeHtml(subtitle);
  return `<header class="page-header">
    <img class="page-mark" src="icons/mark.svg" alt="">
    <div class="page-titles">
      <h1>${escapeHtml(title)}</h1>
      ${sub ? `<p class="muted">${sub}</p>` : ""}
    </div>
    ${right}
  </header>`;
}

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// Views register their render function here instead of this file importing
// them, so a view can call renderCurrentView() without an import cycle.
export const routes = {};

export function registerRoute(name, render) {
  routes[name] = render;
}

// The attributes that name a control across re-renders (innerHTML replaces
// every node, so the focused one is gone after an action re-renders).
const CONTROL_KEYS = ["action", "role", "slot", "day", "id", "set"];

function controlSelector(el) {
  if (!el || !el.dataset || !(el.dataset.action || el.dataset.role)) return null;
  return CONTROL_KEYS.filter((k) => el.dataset[k] != null)
    .map((k) => `[data-${k}="${cssEscape(el.dataset[k])}"]`).join("");
}

// A focused control that disabled itself (Up on what is now the first card,
// Previous month at the start month) cannot take focus back: a move button
// goes to the same item's opposite move button, else the nearest enabled
// control in the same parent, by order, the following one on a tie.
const OPPOSITE_MOVE = { "move-up": "move-down", "move-down": "move-up", "move-slot-up": "move-slot-down", "move-slot-down": "move-slot-up" };

function nearestEnabled(el) {
  const opposite = OPPOSITE_MOVE[el.dataset.action];
  const twin = opposite && document.querySelector(controlSelector({ dataset: { ...el.dataset, action: opposite } }));
  if (twin && !twin.matches(":disabled")) return twin;
  const items = [...el.parentElement.querySelectorAll(":is(a[href], input, select, textarea, button)")];
  const at = items.indexOf(el);
  for (let d = 1; d < items.length; d++) {
    for (const other of [items[at + d], items[at - d]]) {
      if (other && !other.matches(":disabled")) return other;
    }
  }
  return null;
}

let lastRoute = null;

export function renderCurrentView() {
  const route = currentRoute();
  const sameRoute = route === lastRoute;
  lastRoute = route;
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  // Remember the focused control, and which of its look-alikes it was (the
  // two calendar-month buttons share every attribute but the month).
  // Only keyboard focus (:focus-visible) is put back: after a tap, a focused
  // control would draw a ring (or the input:focus border) nobody asked for.
  const focused = document.activeElement;
  const selector = focused && focused.matches(":focus-visible") ? controlSelector(focused) : null;
  const index = selector ? [...document.querySelectorAll(selector)].indexOf(focused) : -1;
  // Which exercise, day or library row it belonged to, read before the render
  // detaches it: the fallback below when the action removed the control.
  const keyName = selector && ["slot", "day", "id"].find((k) => focused.dataset[k] != null);
  const key = keyName ? `[data-${keyName}="${cssEscape(focused.dataset[keyName])}"]` : "";
  const overlay = document.getElementById("overlay-root");
  const view = document.getElementById("view");
  overlay.innerHTML = "";
  (routes[route] || routes.today)(view);
  // While an overlay is open the page behind it can't be reached.
  const modal = overlay.childElementCount > 0;
  view.inert = modal;
  document.querySelector(".bottom-nav").inert = modal;
  if (selector && !document.activeElement?.closest("#view, #overlay-root")) {
    const usable = (el) => el && !el.closest("[inert]") ? el : null;
    const found = document.querySelectorAll(selector)[index];
    const again = usable(found && found.matches(":disabled") ? nearestEnabled(found) : found);
    // The control is gone (Remove opens a form in place of the menu, Cancel
    // closes the form): focus the form that opened for the same item, else any
    // form that opened, else the item's own controls, else the main button,
    // so the next Tab does not start again from the top of the page. Only on
    // the same screen: a route change starts at the top on purpose.
    const control = ":is(input, select, textarea, button):not(:disabled)";
    const target = again || (sameRoute && (
      (key && usable(view.querySelector(`.inline-form${key} ${control}`)))
      || (!key && usable(view.querySelector(`.inline-form ${control}`)))
      || (key && usable(view.querySelector(`${key}${control}`)))
      || usable(view.querySelector(':is([data-action="finish-workout"], [data-action="reopen-workout"], [data-action="open-add-exercise"], [data-action="open-add-day"]):not(:disabled)'))));
    if (target) target.focus({ preventScroll: true });
  }
  if (Store.writeFailed) showStorageError();
}

// Tab and Shift+Tab wrap inside an open overlay (main.js's keydown).
export function wrapOverlayFocus(e) {
  if (e.key !== "Tab") return;
  const items = [...document.querySelectorAll("#overlay-root :is(a[href], button, input, select, [tabindex]):not(:disabled, [tabindex='-1'])")];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = items.includes(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { first.focus(); e.preventDefault(); }
}

// Shown at the top of the screen once a write to storage has failed (see
// writeJSON). Added straight to the page, not through a render: the failure
// can come from typing into a set, which must not re-render.
export function showStorageError() {
  const view = document.getElementById("view");
  if (view.querySelector(".storage-error")) return;
  view.insertAdjacentHTML("afterbegin", `<p class="notice error storage-error" role="alert">Could not save: this browser's storage is full or blocked, so recent changes may be lost. Export a backup in Settings.</p>`);
}
