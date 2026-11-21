import { Store } from "./store.js";

// updateAvailable lives outside App.ui (which resets on every hashchange)
// since it needs to persist across navigation until the user reloads.
export const App = { ui: {}, updateAvailable: false };

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

// Sets / reps / weeks typed into a form: a whole number from 1 to 99 (an
// absurd set count would build that many set rows and overflow storage).
export function cleanCount(v) {
  return Math.min(99, Math.max(1, Math.floor(Number(v)) || 1));
}

export function fmtNum(n) {
  return n == null ? "" : n;
}

export function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

export function getExerciseMuscleGroup(exerciseId) {
  const exercise = Store.getExercises().find((e) => e.id === exerciseId);
  return (exercise && exercise.muscleGroup) || "Other";
}

export function renderExerciseOptionsGrouped(excludeId, onlyGroup) {
  let library = Store.getExercises().filter((e) => e.id !== excludeId);
  if (onlyGroup) library = library.filter((e) => (e.muscleGroup || "Other") === onlyGroup);
  const byGroup = {};
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
  return `<select data-role="${dataRole}" ${dataAttrs} ${lockedValue ? 'disabled data-locked="true"' : ""}>
    ${MUSCLE_GROUPS.map((g) => `<option value="${g}" ${g === lockedValue ? "selected" : ""}>${g}</option>`).join("")}
  </select>`;
}

export function currentRoute() {
  return (location.hash.replace(/^#\/?/, "") || "today").split("?")[0];
}

export function emptyMesoState() {
  return `<div class="empty-state"><p>No active mesocycle yet.</p>
    <a href="#/settings" class="btn">Create one in Settings</a></div>`;
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
}
