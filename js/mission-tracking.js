/*
  PerthSanta Streaming — reusable mission action tracking.
  ------------------------------------------------------------------
  trackMissionAction(actionId) calls the recordMissionAction Cloud
  Function. Loaded on every public page except admin.html (see each
  page's own <script> tags) — safe to import even on pages with nothing
  to track.

  Two ways an element gets tracked when clicked, in priority order:
    1. Explicit data-track-action="someActionId" on the element (or an
       ancestor) — always wins, never overridden by URL matching.
    2. Any <a href="..."> whose (normalized) href matches an ACTIVE
       mission's destinationUrl — built into a shared, realtime
       actionId-by-URL map (see ensureActiveActionMap below) so any
       current or future tracked link anywhere on the site Just Works
       without per-button wiring.
  Neither path ever calls preventDefault() — the element's own default
  behavior (navigation, opening a new tab) proceeds immediately as part
  of the same click/user gesture that's required for a popup/new-tab to
  open reliably.

  This is a SINGLE delegated document-level click listener (installed
  once per page, not one listener per link) plus a SINGLE shared
  Firestore listener for the active-mission map — never one per button
  and never one per page re-render.
*/

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { functions, db } from "./firebase-app.js";
import { getCurrentUser } from "./auth.js";
import { renderDomiiaAmount } from "./domiia.js";
import { normalizeTrackableUrl } from "./url-normalize.js";

const recordMissionActionCallable = httpsCallable(functions, "recordMissionAction");

/*
  trackMissionAction(actionId) -> Promise<result|null>
  ------------------------------------------------------------------
  Resolves to the Cloud Function's structured response (see
  functions/missionLogic.js for the exact shape: counted/reason/progress/
  target/completed/rewardAwarded/domiiaBalance), or null if the visitor
  isn't signed in (nothing to track — the link still opened normally,
  this is not an error) or the call itself failed (logged to the
  console; never thrown — a tracking failure must never break the
  link/button that triggered it).
*/
async function trackMissionAction(actionId) {
  if (!getCurrentUser()) return null;
  try {
    const response = await recordMissionActionCallable({ actionId });
    return response.data;
  } catch (error) {
    console.error("[mission-tracking] recordMissionAction failed", error);
    return null;
  }
}

/* ==========================================================================
   Active action map — normalizedDestinationUrl -> actionId, kept current
   via a single realtime listener shared by every page. Public data (same
   query js/missions.js already uses), so this loads regardless of sign-in
   state.
   ========================================================================== */

let activeActionMap = new Map();
let activeMapUnsubscribe = null;

function ensureActiveActionMap() {
  if (activeMapUnsubscribe) return;
  const activeMissionsQuery = query(collection(db, "missions"), where("active", "==", true));
  activeMapUnsubscribe = onSnapshot(
    activeMissionsQuery,
    (snap) => {
      const next = new Map();
      snap.docs.forEach((d) => {
        const mission = d.data();
        const key = normalizeTrackableUrl(mission.destinationUrl);
        if (key) next.set(key, mission.actionId);
      });
      activeActionMap = next;
    },
    (error) => console.error("[mission-tracking] could not load active action map", error)
  );
}

/* ==========================================================================
   Result pub-sub — lets a specific page (e.g. missions.html) react to the
   outcome of a tracked click scoped to its own DOM (inline cooldown text)
   WITHOUT attaching a second listener that would call trackMissionAction
   a second time for the same click. The single delegated click handler
   below is the only thing that ever calls trackMissionAction.
   ========================================================================== */

const resultListeners = new Set();

function onMissionActionResult(callback) {
  resultListeners.add(callback);
  return () => resultListeners.delete(callback);
}

function notifyResultListeners(el, actionId, result) {
  resultListeners.forEach((callback) => {
    try {
      callback(el, actionId, result);
    } catch (error) {
      console.error("[mission-tracking] result listener threw", error);
    }
  });
}

/*
  wireTrackedLinks(root?, onResult?)
  ------------------------------------------------------------------
  Subscribes onResult(el, result) to tracked-click results whose element
  falls under `root` (defaults to the whole document). Idempotent per
  root — safe to call again after re-rendering the same container (e.g.
  missions.html re-renders its mission list on every snapshot) without
  accumulating duplicate subscriptions.

  NOTE: this no longer attaches its own click listeners — actual
  tracking happens once, globally, in the delegated handler below. This
  only filters/forwards results so page-specific code (missions.html's
  per-card cooldown note) can react without double-counting a click.
*/
const wiredRoots = new WeakSet();
function wireTrackedLinks(root, onResult) {
  const scope = root || document;
  if (wiredRoots.has(scope)) return;
  wiredRoots.add(scope);
  if (typeof onResult !== "function") return;
  onMissionActionResult((el, actionId, result) => {
    if (el && scope.contains(el)) onResult(el, result);
  });
}

/* ==========================================================================
   Global reward toast — shown on EVERY public page (not just
   missions.html) for mission completion, daily-set completion, and
   achievement unlocks. Reuses the exact .mission-toast markup/styles
   missions.html already ships (see css/style.css); if a page doesn't
   have that markup in its HTML, one is injected into <body> on first use
   rather than duplicating a second toast implementation per page.

   A single click can trigger up to three of these at once (the last
   mission of the day, on someone's very first day, can complete the
   mission AND the daily set AND unlock achievements simultaneously) — a
   QUEUE shows them one at a time on the same toast surface rather than
   stacking/overlapping popups (Step 5 spec sections 25-26).
   ========================================================================== */

const TOAST_DISPLAY_MS = 3500;
const TOAST_GAP_MS = 300;

let toastQueue = [];
let toastActive = false;
let toastTimer = null;

function ensureToastEl() {
  let toast = document.querySelector("[data-mission-toast]");
  if (toast) return toast;

  toast = document.createElement("div");
  toast.className = "mission-toast";
  toast.setAttribute("data-mission-toast", "");
  toast.setAttribute("role", "status");
  toast.hidden = true;
  document.body.appendChild(toast);
  return toast;
}

// renderFn(toast) fully rebuilds the toast's contents for this one queued
// item — each toast type below owns its own render function.
function enqueueToast(renderFn) {
  toastQueue.push(renderFn);
  advanceToastQueue();
}

function advanceToastQueue() {
  if (toastActive || !toastQueue.length) return;
  toastActive = true;

  const renderFn = toastQueue.shift();
  const toast = ensureToastEl();
  toast.innerHTML = "";
  renderFn(toast);
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toastActive = false;
    // A brief gap so back-to-back toasts read as distinct events rather
    // than one toast's content silently swapping mid-view.
    setTimeout(advanceToastQueue, TOAST_GAP_MS);
  }, TOAST_DISPLAY_MS);
}

function appendRewardLine(toast, label, amount) {
  const row = document.createElement("div");
  row.className = "mission-toast-reward";
  if (label) row.append(document.createTextNode(`${label} `));
  const plus = document.createElement("span");
  plus.textContent = "+";
  row.append(plus, renderDomiiaAmount(amount, { size: label ? "small" : "medium" }));
  toast.appendChild(row);
}

function showMissionCompletionToast(amount) {
  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = "Mission complete!";
    toast.appendChild(title);
    appendRewardLine(toast, null, amount);
  });
}

// Step 9: one tracked action can complete SEVERAL missions at once (tiered
// missions sharing an actionId, e.g. both the 3-stream and 10-stream
// goals finishing on the same click) — one combined toast rather than N
// overlapping/queued single-mission toasts for what the user experiences
// as a single moment (spec section 31).
function showMultiMissionCompletionToast(newlyCompletedMissions) {
  const total = newlyCompletedMissions.reduce((sum, m) => sum + (Number(m.rewardDomiias) || 0), 0);
  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = `${newlyCompletedMissions.length} missions completed!`;
    toast.appendChild(title);
    appendRewardLine(toast, null, total);
  });
}

// Step 10: a completion is now scoped — "general" (the evergreen set) or
// "campaign" (one specific campaign's set, named via campaignTitle).
function dailySetLabel(completion) {
  return completion.scope === "campaign" ? (completion.campaignTitle || "Campaign") : "General";
}

function showDailyCompletionToast(completion) {
  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = `${dailySetLabel(completion)} daily missions complete!`;
    toast.appendChild(title);
    appendRewardLine(toast, null, completion.bonusDomiias);
  });
}

// One action can now complete SEVERAL daily sets at once (general + one
// or more campaigns, spec section 19) — one combined toast rather than N
// overlapping/queued set-completion toasts (spec section 39), same
// pattern as showMultiMissionCompletionToast above.
function showMultiSetCompletionToast(completions) {
  const total = completions.reduce((sum, c) => sum + (Number(c.bonusDomiias) || 0), 0);
  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = `${completions.length} daily sets completed!`;
    toast.appendChild(title);
    appendRewardLine(toast, null, total);
  });
}

function appendCosmeticLine(toast, cosmeticTitle) {
  const row = document.createElement("div");
  row.className = "mission-toast-reward";
  row.textContent = `New reward unlocked: ${cosmeticTitle}`;
  toast.appendChild(row);
}

// Multiple simultaneous unlocks get ONE combined toast (spec section 25)
// rather than one toast per achievement, so an exceptional first click
// never queues up a wall of popups.
function showAchievementsToast(achievements) {
  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = achievements.length > 1
      ? `${achievements.length} achievements unlocked!`
      : "Achievement unlocked!";
    toast.appendChild(title);
    achievements.forEach((a) => {
      appendRewardLine(toast, a.title, a.rewardDomiias);
      (a.cosmeticRewards || []).forEach((c) => appendCosmeticLine(toast, c.title));
    });
  });
}

// Distinct wording for HISTORICAL reconciliation (syncAchievements) vs. a
// live unlock — "recognition of past progress, not an error" (spec
// section 13). A single reconciled achievement reads identically to a
// live one (reuses showAchievementsToast as-is); multiple get one
// combined toast with a running Domiia total instead of N separate
// achievement toasts queuing up back-to-back for an old account that
// logs back in after a long absence.
function showBackfilledAchievementsToast(achievements) {
  if (!Array.isArray(achievements) || !achievements.length) return;
  if (achievements.length === 1) {
    showAchievementsToast(achievements);
    return;
  }

  const totalDomiias = achievements.reduce((sum, a) => sum + (Number(a.rewardDomiias) || 0), 0);
  const hasCosmetics = achievements.some((a) => Array.isArray(a.cosmeticRewards) && a.cosmeticRewards.length);

  enqueueToast((toast) => {
    const title = document.createElement("p");
    title.className = "mission-toast-title";
    title.textContent = `${achievements.length} achievements unlocked from your previous progress!`;
    toast.appendChild(title);
    appendRewardLine(toast, null, totalDomiias);

    const names = document.createElement("p");
    names.className = "mission-toast-reward";
    names.textContent = achievements.map((a) => a.title).join(", ");
    toast.appendChild(names);

    if (hasCosmetics) {
      const cosmeticNote = document.createElement("div");
      cosmeticNote.className = "mission-toast-reward";
      cosmeticNote.textContent = "New customization options unlocked too!";
      toast.appendChild(cosmeticNote);
    }
  });
}

/* ==========================================================================
   Single delegated click listener — the only place that ever calls
   trackMissionAction(). Priority: explicit data-track-action first, then
   a destination-URL match against the active action map, then nothing.
   ========================================================================== */

function resolveActionIdForClick(target) {
  const explicitEl = target.closest("[data-track-action]");
  if (explicitEl) {
    const actionId = explicitEl.getAttribute("data-track-action");
    if (actionId) return { actionId, el: explicitEl };
  }

  const linkEl = target.closest("a[href]");
  if (linkEl) {
    const key = normalizeTrackableUrl(linkEl.href);
    if (key && activeActionMap.has(key)) {
      return { actionId: activeActionMap.get(key), el: linkEl };
    }
  }

  return null;
}

let delegationInstalled = false;
function installGlobalClickTracking() {
  if (delegationInstalled) return;
  delegationInstalled = true;

  document.addEventListener("click", (event) => {
    const resolved = resolveActionIdForClick(event.target);
    if (!resolved) return;

    // Deliberately not awaited — the clicked element's default behavior
    // (navigation/new-tab) proceeds immediately as part of this same
    // click. See the file header.
    trackMissionAction(resolved.actionId).then((result) => {
      if (!result) return;
      notifyResultListeners(resolved.el, resolved.actionId, result);

      // Step 9: one accepted action can newly complete any number of the
      // missions subscribed to it (0, 1, or several tiers at once) — see
      // functions/missionLogic.js's response shape. Order matters and
      // matches the natural cascade (spec section 26): mission reward(s),
      // then the daily-set bonus, then achievements.
      const newlyCompleted = Array.isArray(result.missions)
        ? result.missions.filter((m) => m.newlyCompleted)
        : [];
      if (newlyCompleted.length === 1) {
        showMissionCompletionToast(newlyCompleted[0].rewardDomiias);
      } else if (newlyCompleted.length > 1) {
        showMultiMissionCompletionToast(newlyCompleted);
      }
      const completedSets = Array.isArray(result.dailyCompletions) ? result.dailyCompletions : [];
      if (completedSets.length === 1) {
        showDailyCompletionToast(completedSets[0]);
      } else if (completedSets.length > 1) {
        showMultiSetCompletionToast(completedSets);
      }
      if (Array.isArray(result.achievementsUnlocked) && result.achievementsUnlocked.length) {
        showAchievementsToast(result.achievementsUnlocked);
      }
    });
  });
}

ensureActiveActionMap();
installGlobalClickTracking();

export { trackMissionAction, wireTrackedLinks, onMissionActionResult, showBackfilledAchievementsToast };

window.PSMissionTracking = { trackMissionAction, wireTrackedLinks, onMissionActionResult, showBackfilledAchievementsToast };
