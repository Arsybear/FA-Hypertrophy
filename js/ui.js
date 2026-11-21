import { Store } from "./store.js";

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
export function getExerciseMuscleGroup(exerciseId, exerciseName) {
  const library = Store.getExercises();
  const name = exerciseName ? exerciseName.toLowerCase() : null;
  const exercise = library.find((e) => e.id === exerciseId)
    || (name && library.find((e) => e.name.toLowerCase() === name));
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

export function renderMuscleGroupSelect(dataRole, dataAttrs = "", lockedValue = null) {
  return `<select data-role="${dataRole}" ${dataAttrs} aria-label="Muscle group" ${lockedValue ? 'disabled data-locked="true"' : ""}>
    ${MUSCLE_GROUPS.map((g) => `<option value="${g}" ${g === lockedValue ? "selected" : ""}>${g}</option>`).join("")}
  </select>`;
}

export function currentRoute() {
  return (location.hash.replace(/^#\/?/, "") || "today").split("?")[0];
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

export function renderCurrentView() {
  const route = currentRoute();
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  document.getElementById("overlay-root").innerHTML = "";
  (routes[route] || routes.today)(document.getElementById("view"));
  if (Store.writeFailed) showStorageError();
}

// Shown at the top of the screen once a write to storage has failed (see
// writeJSON). Added straight to the page, not through a render: the failure
// can come from typing into a set, which must not re-render.
export function showStorageError() {
  const view = document.getElementById("view");
  if (view.querySelector(".storage-error")) return;
  view.insertAdjacentHTML("afterbegin", `<p class="notice error storage-error" role="alert">Could not save: this browser's storage is full or blocked, so recent changes may be lost. Export a backup in Settings.</p>`);
}
