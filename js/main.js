import * as store from "./store.js";
import * as schedule from "./schedule.js";
import * as progression from "./progression.js";
import * as ui from "./ui.js";
import * as workout from "./workout.js";
import { Store } from "./store.js";
import { handleChartPoint } from "./chart.js";
import { App, currentRoute, registerRoute, renderCurrentView, showStorageError } from "./ui.js";
import { handleSetDoneChange, handleTodayAction, handleTodayChange, renderToday } from "./views/today.js";
import { handleProgramAction, handleProgramChange, renderProgram } from "./views/program.js";
import { handleHistoryAction, renderHistory } from "./views/history.js";
import { handleImportFile, handleSettingsAction, handleSettingsChange, renderSettings, updateStartWeekdayHint } from "./views/settings.js";

// Modules have no page globals; this one handle is for poking at the app
// from the browser console (and for seeding state in manual tests).
window.FAH = { ...store, ...schedule, ...progression, ...ui, ...workout };

// "#/today" with no ?date= means the real current date, looked up again on
// every event. Past midnight that is a different day from the one on screen:
// typed values found no set to go to and Finish finished the new day's blank
// workout. So when the date has changed under a screen that was showing
// "today", the address is pinned to the day it was drawn for (replaceState
// fires no hashchange), and the events land on the workout the user sees.
let knownToday = schedule.isoDate(new Date());
function pinViewedDay(always) {
  const now = schedule.isoDate(new Date());
  if (now === knownToday) return false;
  const previous = knownToday;
  knownToday = now;
  if (currentRoute() !== "today" || workout.currentDateParam()) return true;
  const meso = Store.getActiveMesocycle();
  const shown = meso && Store.findWorkoutByDate(meso.id, previous);
  const midWorkout = shown && !shown.finished && shown.exercises.some((ex) => ex.sets.some(workout.isTouchedSet));
  if (always || midWorkout) history.replaceState(null, "", `#/today?date=${previous}`);
  return true;
}

export function handleGlobalClick(e) {
  pinViewedDay(true);
  const btn = e.target.closest("[data-action]");
  // An empty data-action is a click shield (the history sheet): it stops the
  // click from reaching the backdrop's action and does nothing itself.
  if (!btn || !btn.dataset.action) return;
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

// A form takes either an existing exercise or a new name, never both.
// Picking an existing exercise clears the name box and, since its muscle
// group is already fixed, shows that group greyed out so it can't be edited
// into one that doesn't match. Clearing the pick re-enables it. The swap
// form has no group select (a swap stays inside the exercise's group).
export function handleExercisePickChange(selectEl) {
  const container = selectEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  const nameInput = container.querySelector('input[data-role$="-name"]');
  const exercise = selectEl.value ? Store.getExercises().find((e) => e.id === selectEl.value) : null;
  if (exercise && nameInput) nameInput.value = "";
  if (!groupSelect) return;
  if (exercise) groupSelect.value = exercise.muscleGroup || "Other";
  groupSelect.disabled = !!exercise;
}

// Typing a new exercise name means the "pick existing" path no longer
// applies — reset that dropdown and re-enable the group select.
export function handleNewNameTyped(inputEl) {
  if (inputEl.value.trim() === "") return;
  const container = inputEl.closest(".inline-form");
  const groupSelect = container.querySelector('select[data-role$="-group"]');
  if (groupSelect) groupSelect.disabled = false;
  const existingSelect = container.querySelector(EXISTING_EXERCISE_SELECT_ROLES);
  if (existingSelect) existingSelect.value = "";
}

export function handleGlobalChange(e) {
  pinViewedDay(true);
  const t = e.target;
  const route = currentRoute();
  if (route === "today" && t.matches('input[data-role="set-done"]')) handleSetDoneChange(t);
  else if (route === "today" && t.matches("input[data-field]")) handleTodayChange(t);
  else if (route === "program" && t.matches('input[data-role^="slot-"]')) handleProgramChange(t);
  else if (route === "settings" && t.dataset.role === "import-file") handleImportFile(t);
  else if (route === "settings" && t.dataset.role === "new-meso-start-date") updateStartWeekdayHint(t, "new-meso-start-weekday-hint");
  else if (route === "settings" && t.matches('[data-role^="edit-"]')) handleSettingsChange(t);
  else if (t.matches(EXISTING_EXERCISE_SELECT_ROLES)) handleExercisePickChange(t);
  else if (t.matches(NEW_EXERCISE_NAME_INPUT_ROLES)) handleNewNameTyped(t);
}


registerRoute("today", renderToday);
registerRoute("program", renderProgram);
registerRoute("history", renderHistory);
registerRoute("settings", renderSettings);

window.addEventListener("hashchange", () => {
  App.ui = {};
  // A navigation draws "today" for the real current date: that is now the
  // day on screen (see pinViewedDay).
  knownToday = schedule.isoDate(new Date());
  renderCurrentView();
});
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("view").addEventListener("click", handleGlobalClick);
  document.getElementById("view").addEventListener("change", handleGlobalChange);
  // Full-screen overlays (see index.html) render outside #view, so they need
  // their own delegated listener — handleGlobalClick itself doesn't care
  // which container an event came from (it re-derives state from Store and
  // currentRoute() rather than closing over anything from the listener).
  document.getElementById("overlay-root").addEventListener("click", handleGlobalClick);
  for (const type of ["pointerover", "pointerout", "click"]) document.getElementById("overlay-root").addEventListener(type, handleChartPoint);
  // Escape closes the open overlay, through the same action as its button.
  document.addEventListener("keydown", (e) => {
    const close = e.key === "Escape" && document.querySelector('#overlay-root button[data-action^="close-"]');
    if (close) close.click();
  });
  // A set value is saved on "change", which fires when the box loses focus.
  // A phone locked between sets can end the app with the box still focused,
  // so going to the background commits it. Coming back on a later day shows
  // that day, unless a workout was left half logged (it stays on screen).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (document.activeElement && document.activeElement.matches("input, select")) document.activeElement.blur();
    } else if (pinViewedDay(false)) {
      renderCurrentView();
    }
  });
  Store.onWriteError = showStorageError;
  Store.normalize();
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
