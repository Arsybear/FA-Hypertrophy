import * as store from "./store.js";
import * as schedule from "./schedule.js";
import * as progression from "./progression.js";
import * as ui from "./ui.js";
import * as workout from "./workout.js";
import { Store } from "./store.js";
import { handleChartPoint } from "./chart.js";
import { App, currentRoute, registerRoute, renderCurrentView, showStorageError, swipeStep, wrapOverlayFocus } from "./ui.js";
import { handleMissedPick, handleSetDoneChange, handleTodayAction, handleTodayChange, renderToday } from "./views/today.js";
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
  else if (route === "today" && t.dataset.role === "missed-pick") handleMissedPick(t);
  else if (route === "program" && t.matches('[data-role^="slot-"]')) handleProgramChange(t);
  else if (route === "settings" && t.dataset.role === "import-file") handleImportFile(t);
  else if (route === "settings" && t.dataset.role === "new-meso-start-date") updateStartWeekdayHint(t, "new-meso-start-weekday-hint");
  else if (route === "settings" && t.matches('[data-role^="edit-"]')) handleSettingsChange(t);
  else if (t.matches(EXISTING_EXERCISE_SELECT_ROLES)) handleExercisePickChange(t);
  else if (t.matches(NEW_EXERCISE_NAME_INPUT_ROLES)) handleNewNameTyped(t);
}


// iOS 26 and 27 give a home-screen app that runs behind a translucent
// status bar a viewport one status bar shorter than the screen (WebKit bug
// 313800): the page still starts at the top, and a band as tall as the top
// inset is left under it where nothing can be drawn. That band already
// clears the home indicator, so the bottom inset would count twice (the nav
// stood 93px above the screen's edge): the class drops it, see
// css/style.css. Never set where the top inset is 0 (an opaque status bar)
// or the viewport is the screen's height (the bug fixed).
function markShortViewport() {
  const top = parseFloat(getComputedStyle(document.getElementById("view")).top) || 0;
  const short = navigator.standalone === true && innerHeight > innerWidth && top > 0
    && Math.abs(screen.height - innerHeight - top) <= 1;
  document.documentElement.classList.toggle("short-viewport", short);
}

// A swipe left or right on a screen opens the next or the previous screen of
// the bottom nav, through the address like a tap on its link (so the
// hashchange handler commits a focused box). Not from the screen's edges,
// where iOS starts its own back and forward swipes, not with two fingers,
// and not while a box has focus: a route change closes an open form and
// would drop what was typed into it.
const SWIPE_EDGE = 24;
function attachSwipeNav(view) {
  let start = null;
  view.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    const edge = t.clientX < SWIPE_EDGE || t.clientX > innerWidth - SWIPE_EDGE;
    const typing = document.activeElement
      && document.activeElement.matches('#view input:not([type="checkbox"], [type="radio"]), #view select, #view textarea');
    start = e.touches.length === 1 && !edge && !typing ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  }, { passive: true });
  view.addEventListener("touchcancel", () => { start = null; }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const step = swipeStep(t.clientX - start.x, t.clientY - start.y, e.timeStamp - start.at);
    start = null;
    const links = [...document.querySelectorAll(".bottom-nav .nav-link")];
    const next = step && links[links.findIndex((a) => a.dataset.route === currentRoute()) + step];
    if (next) location.hash = next.getAttribute("href");
  }, { passive: true });
}

registerRoute("today", renderToday);
registerRoute("program", renderProgram);
registerRoute("history", renderHistory);
registerRoute("settings", renderSettings);

window.addEventListener("hashchange", (e) => {
  // Back, Forward or a swipe moves no focus, and a typed value is saved on
  // "change": blur the box before its screen is replaced. The address is
  // put back for that moment so the value lands on the route and the day
  // the box was drawn for, not the one being opened.
  const typing = document.activeElement;
  if (typing && typing.matches("#view input, #view textarea")) {
    const next = location.href;
    history.replaceState(null, "", e.oldURL);
    typing.blur();
    history.replaceState(null, "", next);
  }
  App.ui = {};
  // A navigation draws "today" for the real current date: that is now the
  // day on screen (see pinViewedDay).
  knownToday = schedule.isoDate(new Date());
  renderCurrentView();
});
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("view").addEventListener("click", handleGlobalClick);
  document.getElementById("view").addEventListener("change", handleGlobalChange);
  attachSwipeNav(document.getElementById("view"));
  // Again on load and on every size change: the insets can still be 0 this
  // early in a cold start.
  markShortViewport();
  for (const type of ["load", "pageshow", "resize", "orientationchange"]) window.addEventListener(type, markShortViewport);
  // Full-screen overlays (see index.html) render outside #view, so they need
  // their own delegated listener — handleGlobalClick itself doesn't care
  // which container an event came from (it re-derives state from Store and
  // currentRoute() rather than closing over anything from the listener).
  document.getElementById("overlay-root").addEventListener("click", handleGlobalClick);
  for (const type of ["pointerover", "pointerout", "click"]) document.getElementById("overlay-root").addEventListener(type, handleChartPoint);
  // Escape closes the open overlay, through the same action as its button.
  document.addEventListener("keydown", (e) => {
    wrapOverlayFocus(e); // Tab stays inside an open overlay
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
    } else {
      markShortViewport();
      if (pinViewedDay(false)) renderCurrentView();
    }
  });
  Store.onWriteError = showStorageError;
  // The whole training log lives in this browser: ask it not to clear this
  // site's data when it frees space. Where it refuses, nothing changes.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  Store.normalize();
  // An unfinished workout generated by an older version carries that
  // version's predictions: rebuild the untouched ones with today's rules.
  workout.refreshPredictions();
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
