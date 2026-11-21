import * as store from "./store.js";
import * as schedule from "./schedule.js";
import * as progression from "./progression.js";
import * as ui from "./ui.js";
import * as workout from "./workout.js";
import { Store } from "./store.js";
import { App, currentRoute, registerRoute, renderCurrentView } from "./ui.js";
import { handleSetDoneChange, handleTodayAction, handleTodayChange, renderToday } from "./views/today.js";
import { handleProgramAction, handleProgramChange, renderProgram } from "./views/program.js";
import { handleHistoryAction, renderHistory } from "./views/history.js";
import { handleSettingsAction, handleSettingsChange, renderSettings, updateStartWeekdayHint } from "./views/settings.js";

// Modules have no page globals; this one handle is for poking at the app
// from the browser console (and for seeding state in manual tests).
window.FAH = { ...store, ...schedule, ...progression, ...ui, ...workout };

export function handleGlobalClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const view = document.getElementById("view");
  const route = currentRoute();
  const action = btn.dataset.action;
  if (route === "today") handleTodayAction(action, btn, view);
  else if (route === "program") handleProgramAction(action, btn, view);
  else if (route === "history") handleHistoryAction(action, btn);
  else if (route === "settings") handleSettingsAction(action, btn, view);
}

export const EXISTING_EXERCISE_SELECT_ROLES =
  'select[data-role="add-exercise-select"], select[data-role="sub-exercise-select"], select[data-role="new-slot-exercise"]';
export const NEW_EXERCISE_NAME_INPUT_ROLES =
  'input[data-role="add-new-name"], input[data-role="sub-new-name"], input[data-role="new-slot-name"]';

// When an existing exercise is picked from one of the add/swap dropdowns,
// its muscle group is already fixed — grey out the sibling group select so
// it can't be edited into a value that doesn't match. Clearing the pick
// re-enables it. A "locked" group select (swap's create-new field, always
// pinned to the current slot's group) is left alone either way.
export function handleExercisePickChange(selectEl) {
  const container = selectEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  const nameInput = container.querySelector('input[data-role$="-name"]');
  if (groupSelect.dataset.locked === "true") return;
  const exercise = selectEl.value ? Store.getExercises().find((e) => e.id === selectEl.value) : null;
  if (exercise) {
    groupSelect.value = exercise.muscleGroup || "Other";
    groupSelect.disabled = true;
    nameInput.value = "";
  } else {
    groupSelect.disabled = false;
  }
}

// Typing a new exercise name means the "pick existing" path no longer
// applies — reset that dropdown and re-enable the group select (unless it's
// permanently locked, e.g. the swap form's same-muscle-group constraint).
export function handleNewNameTyped(inputEl) {
  if (inputEl.value.trim() === "") return;
  const container = inputEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  if (groupSelect.dataset.locked !== "true") groupSelect.disabled = false;
  const existingSelect = container.querySelector(EXISTING_EXERCISE_SELECT_ROLES);
  if (existingSelect) existingSelect.value = "";
}

export function handleGlobalChange(e) {
  const t = e.target;
  const route = currentRoute();
  if (route === "today" && t.matches('input[data-role="set-done"]')) handleSetDoneChange(t);
  else if (route === "today" && t.matches("input[data-field]")) handleTodayChange(t);
  else if (route === "program" && t.matches('input[data-role^="slot-"]')) handleProgramChange(t);
  else if (route === "settings" && t.dataset.role === "new-meso-start-date") updateStartWeekdayHint(t, "new-meso-start-weekday-hint");
  else if (route === "settings" && t.matches('[data-role^="edit-"]')) handleSettingsChange(t);
  else if (t.matches(EXISTING_EXERCISE_SELECT_ROLES)) handleExercisePickChange(t);
  else if (t.matches(NEW_EXERCISE_NAME_INPUT_ROLES)) handleNewNameTyped(t);
}


registerRoute("today", renderToday);
registerRoute("program", renderProgram);
registerRoute("history", renderHistory);
registerRoute("settings", renderSettings);

window.addEventListener("hashchange", () => { App.ui = {}; renderCurrentView(); });
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("view").addEventListener("click", handleGlobalClick);
  document.getElementById("view").addEventListener("change", handleGlobalChange);
  // Full-screen overlays (see index.html) render outside #view, so they need
  // their own delegated listener — handleGlobalClick itself doesn't care
  // which container an event came from (it re-derives state from Store and
  // currentRoute() rather than closing over anything from the listener).
  document.getElementById("overlay-root").addEventListener("click", handleGlobalClick);
  if (!location.hash) location.hash = "#/today";
  renderCurrentView();
  if ("serviceWorker" in navigator) {
    // A controllerchange with no prior controller is just this page's first
    // ever activation (nothing to tell the user about). One that happens
    // *after* a controller already existed means a newly-deployed service
    // worker just took over from an older one while this page was open —
    // that's the "new version available" signal the Settings banner shows.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;
      App.updateAvailable = true;
      if (currentRoute() === "settings") renderCurrentView();
    });
  }
});
