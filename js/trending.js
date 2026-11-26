/*
  PerthSanta Streaming — Trending page (trending.html) logic.
  ------------------------------------------------------------------
  Client-side X/Twitter post generator for three categories (PerthSanta,
  Perth, Santa). This module NEVER posts anything automatically — it only
  builds text for the fan to copy, optionally edit, and post themselves.

  Firestore shapes:
    trending/{category}                          — event config (small, read eagerly)
    trendingPhrases/{category}/phrases/{id}       — one doc per phrase (can be
                                                     hundreds/thousands; NEVER
                                                     fetched in full here)

  Random candidate loading: a category's phrase library can grow large and
  this page can see real event-day traffic, so the public generator never
  runs a plain getDocs() over the whole phrases subcollection. Instead each
  phrase carries a `randomKey` (a random float set once at creation) and we
  pull a bounded batch (~40) via a single-field range query starting from a
  random point, wrapping around when the key space runs out. That batch is
  cached in memory per category for the lifetime of the page view and reused
  across repeated "Generate Post" clicks, topped up only when the pool of
  still-eligible (non-recently-shown) candidates runs low.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  disableNetwork,
  enableNetwork
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const CATEGORIES = ["perthsanta", "perth", "santa"];
// Generous ceilings, not expected latencies. The first Firestore read on a
// page has to open the SDK's network channel (and, on some mobile/in-app
// browsers, auto-detect long-polling) before any document comes back, which
// can take several seconds on a slow phone connection. A short ceiling here
// used to make those visitors' config read "time out", fall back to
// data.js (active: false), and see "No active trend" while everyone on a
// fast connection saw the generator.
const CONFIG_TIMEOUT_MS = 12000;
const PHRASE_TIMEOUT_MS = 10000;
const BATCH_SIZE = 40;
const ELIGIBLE_FLOOR = 8;
const RECENT_LIMIT = 20;
const MAX_TOPUP_ATTEMPTS = 3;
const MAX_POST_LENGTH = 280;

let db = null;

// Public, non-sensitive runtime state — read by the temporary
// ?debug-trending=1 overlay (js/trending-debug.js) and by the boot check in
// trending.html, which shows an error if this module never ran at all.
const debugState = {
  booted: true,
  firestore: "initializing",
  lastError: "",
  configs: {},
  phrasesLoaded: {}
};
window.__trendingState = debugState;

function recordError(context, error) {
  const message = `${context}: ${(error && (error.code || error.message)) || String(error)}`;
  debugState.lastError = message;
  console.warn(`[trending] ${message}`, error);
}

/* ==========================================================================
   Small shared helpers
   ========================================================================== */

// Rejects (rather than silently resolving null) on both timeout and
// failure, so callers can tell "no data" apart from "couldn't load" and the
// real error reaches the console instead of being swallowed.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`timed out after ${ms}ms`);
      error.code = "timeout";
      reject(error);
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// Unicode-aware length: raw string.length (UTF-16 code units) over/under
// counts emoji and other astral-plane characters. Grapheme clusters are the
// closest practical match to how a fan actually perceives "characters".
function getPostLength(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of segmenter.segment(text)) count++;
    return count;
  }
  return Array.from(text).length;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildPost(phraseText, keyword, hashtags) {
  const hashtagLine = (hashtags || []).join(" ");
  return `${phraseText}\n\n${keyword}\n\n${hashtagLine}`;
}

function getRecentIds(category) {
  try {
    const raw = sessionStorage.getItem(`trending-recent-${category}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function pushRecentId(category, id) {
  const recent = getRecentIds(category);
  recent.push(id);
  while (recent.length > RECENT_LIMIT) recent.shift();
  try {
    sessionStorage.setItem(`trending-recent-${category}`, JSON.stringify(recent));
  } catch (error) {
    // sessionStorage unavailable (e.g. private mode edge case) — recency
    // tracking just doesn't persist; generation still works fine.
  }
}

/* ==========================================================================
   Config loading (eager, cheap — one small doc per category)
   ========================================================================== */

// Resolves to the merged config plus a `source`:
//   "firestore" — trending/{category} loaded (missing fields fall back)
//   "fallback"  — the doc doesn't exist; data.js is the intended config
//   "error"     — Firestore unreachable/slow/denied; data.js was used, but
//                 its active:false means "unknown", not "no trend", so the
//                 page shows a retryable error instead of "No active trend"
async function fetchConfig(category) {
  const fallback = (typeof siteData !== "undefined" && siteData.trending && siteData.trending[category]) || {
    eventName: "",
    keyword: "",
    hashtags: [],
    active: false
  };

  if (!db) return { ...fallback, source: "error" };

  try {
    const snap = await withTimeout(getDoc(doc(db, `trending/${category}`)), CONFIG_TIMEOUT_MS);
    if (!snap.exists()) return { ...fallback, source: "fallback" };
    const data = snap.data();
    return {
      eventName: typeof data.eventName === "string" ? data.eventName : fallback.eventName,
      keyword: typeof data.keyword === "string" ? data.keyword : fallback.keyword,
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : fallback.hashtags,
      active: typeof data.active === "boolean" ? data.active : fallback.active,
      source: "firestore"
    };
  } catch (error) {
    recordError(`config "${category}"`, error);
    return { ...fallback, source: "error" };
  }
}

async function loadConfig(category) {
  const config = await fetchConfig(category);
  configCache[category] = config;
  debugState.configs[category] = { active: config.active, source: config.source };
  if (config.source === "firestore") debugState.firestore = "ok";
  else if (config.source === "error" && debugState.firestore !== "ok") debugState.firestore = "error";
  return config;
}

/* ==========================================================================
   Bounded randomized phrase pool
   ========================================================================== */

const configCache = {};
const poolState = {}; // category -> { items: [{id, text}], ids: Set }

function getPoolState(category) {
  if (!poolState[category]) {
    poolState[category] = { items: [], ids: new Set() };
  }
  return poolState[category];
}

async function fetchCandidateBatch(category) {
  const phrasesRef = collection(db, `trendingPhrases/${category}/phrases`);
  const randomStart = Math.random();

  const merged = new Map();
  let failures = 0;

  try {
    const firstQuery = query(
      phrasesRef,
      where("randomKey", ">=", randomStart),
      orderBy("randomKey"),
      limit(BATCH_SIZE)
    );
    const firstSnap = await withTimeout(getDocs(firstQuery), PHRASE_TIMEOUT_MS);
    firstSnap.docs.forEach((d) => merged.set(d.id, d));
  } catch (error) {
    failures++;
    recordError(`phrases "${category}"`, error);
  }

  // Wrap around: if the random start didn't yield a full batch (ran off
  // the end of the key space, or the whole library is smaller than
  // BATCH_SIZE), pull a batch from the very start and merge (Map dedupes).
  if (merged.size < BATCH_SIZE) {
    try {
      const wrapQuery = query(phrasesRef, orderBy("randomKey"), limit(BATCH_SIZE));
      const wrapSnap = await withTimeout(getDocs(wrapQuery), PHRASE_TIMEOUT_MS);
      wrapSnap.docs.forEach((d) => merged.set(d.id, d));
    } catch (error) {
      failures++;
      recordError(`phrases "${category}" (wrap)`, error);
    }
  }

  // Both queries failed: report a load error (null), distinct from a
  // successful-but-empty library ([]).
  if (failures > 0 && merged.size === 0) return null;

  return Array.from(merged.values())
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.enabled !== false && typeof p.text === "string" && p.text.length > 0);
}

// Ensures the in-memory pool has at least `minEligible` candidates not in
// the session's recent-exclusion list, topping up from Firestore only when
// needed. No-ops (zero reads) once the pool already has enough.
async function ensurePool(category, minEligible) {
  const state = getPoolState(category);
  const recentIds = getRecentIds(category);

  let attempts = 0;
  while (attempts < MAX_TOPUP_ATTEMPTS) {
    const eligibleCount = state.items.filter((p) => !recentIds.includes(p.id)).length;
    if (eligibleCount >= minEligible && state.items.length > 0) break;

    const batch = await fetchCandidateBatch(category);
    if (batch === null) {
      // Fetch error — stop. Callers keep the generator visible and offer a
      // retry (the next Generate click calls ensurePool again).
      state.loadFailed = true;
      break;
    }
    state.loadFailed = false;

    let addedNew = 0;
    batch.forEach((p) => {
      if (!state.ids.has(p.id)) {
        state.ids.add(p.id);
        state.items.push(p);
        addedNew++;
      }
    });

    attempts++;
    if (addedNew === 0) break; // library exhausted — stop retrying
  }

  debugState.phrasesLoaded[category] = state.items.length;
  return state;
}

/* ==========================================================================
   Page wiring
   ========================================================================== */


function panelEls(category) {
  const panel = document.querySelector(`[data-trending-panel="${category}"]`);
  if (!panel) return null;
  return {
    panel,
    eventTag: panel.querySelector("[data-trending-event-tag]"),
    eventName: panel.querySelector("[data-trending-event-name]"),
    generator: panel.querySelector("[data-trending-generator]"),
    textarea: panel.querySelector("[data-trending-textarea]"),
    charCount: panel.querySelector("[data-trending-char-count]"),
    generateBtn: panel.querySelector("[data-trending-generate]"),
    copyBtn: panel.querySelector("[data-trending-copy]"),
    warning: panel.querySelector("[data-trending-warning]"),
    loadingMsg: panel.querySelector("[data-trending-loading]"),
    inactiveMsg: panel.querySelector("[data-trending-inactive]"),
    unavailableMsg: panel.querySelector("[data-trending-unavailable]"),
    retryBtn: panel.querySelector("[data-trending-retry]")
  };
}

function updateCharCount(els) {
  const length = getPostLength(els.textarea.value);
  els.charCount.textContent = `${length} / ${MAX_POST_LENGTH}`;
  els.charCount.classList.toggle("is-over-limit", length > MAX_POST_LENGTH);
}

function showWarning(els, message) {
  if (!els.warning) return;
  if (!message) {
    els.warning.hidden = true;
    els.warning.textContent = "";
    return;
  }
  els.warning.hidden = false;
  els.warning.textContent = message;
}

// Exactly one of: loading / generator / inactive / unavailable.
function showPanelState(els, which) {
  els.loadingMsg.hidden = which !== "loading";
  els.generator.hidden = which !== "generator";
  els.eventTag.hidden = which !== "generator";
  els.inactiveMsg.hidden = which !== "inactive";
  els.unavailableMsg.hidden = which !== "unavailable";
}

const PHRASE_LOAD_WARNING = "Couldn't load post ideas right now. Tap Generate Post to try again.";

// After a pool (re)load: an empty library hides the generator, but a load
// *error* keeps it on screen with a retryable warning.
function applyPoolResult(els, state) {
  if (state.items.length > 0) return true;
  if (state.loadFailed) {
    showWarning(els, PHRASE_LOAD_WARNING);
  } else {
    showPanelState(els, "unavailable");
  }
  return false;
}

async function renderCategoryState(category) {
  const els = panelEls(category);
  if (!els) return;

  const config = configCache[category];

  if (!config) {
    showPanelState(els, "loading"); // configs still in flight
    return;
  }

  if (!config.active) {
    // Only claim "no active trend" when we actually know that. If Firestore
    // couldn't be reached, data.js's active:false is a guess, not an answer.
    showPanelState(els, config.source === "error" ? "unavailable" : "inactive");
    return;
  }

  els.eventName.textContent = config.eventName || "";
  showPanelState(els, "generator");

  // Warm the candidate pool for this category the first time its tab is
  // shown, so the first "Generate Post" click doesn't have to wait.
  const state = await ensurePool(category, ELIGIBLE_FLOOR);
  applyPoolResult(els, state);
}

async function retryCategory(category) {
  const els = panelEls(category);
  if (!els) return;
  if (els.retryBtn) els.retryBtn.disabled = true;
  showPanelState(els, "loading");
  try {
    // After a failure the SDK considers itself offline and backs off its
    // reconnect attempts (up to a minute), so a plain re-read would fail
    // instantly. Cycling the network resets that and reconnects now.
    if (db) {
      try {
        await disableNetwork(db);
        await enableNetwork(db);
      } catch (error) {
        recordError("network reset", error);
      }
    }
    await loadConfig(category);
    await renderCategoryState(category);
  } finally {
    if (els.retryBtn) els.retryBtn.disabled = false;
  }
}

async function generatePost(category) {
  const els = panelEls(category);
  if (!els) return;

  const config = configCache[category];
  if (!config || !config.active) return;

  showWarning(els, "");
  els.generateBtn.disabled = true;

  try {
    const state = await ensurePool(category, ELIGIBLE_FLOOR);
    if (!applyPoolResult(els, state)) return;

    const recentIds = getRecentIds(category);
    const eligible = state.items.filter((p) => !recentIds.includes(p.id));
    const primaryPool = eligible.length > 0 ? eligible : state.items;

    let chosen = null;
    for (const candidate of shuffle(primaryPool.slice())) {
      const text = buildPost(candidate.text, config.keyword, config.hashtags);
      if (getPostLength(text) <= MAX_POST_LENGTH) {
        chosen = { candidate, text };
        break;
      }
    }

    if (!chosen && primaryPool !== state.items) {
      for (const candidate of shuffle(state.items.slice())) {
        const text = buildPost(candidate.text, config.keyword, config.hashtags);
        if (getPostLength(text) <= MAX_POST_LENGTH) {
          chosen = { candidate, text };
          break;
        }
      }
    }

    if (!chosen) {
      showWarning(els, "Couldn't fit a post within 280 characters right now — please try again.");
      return;
    }

    pushRecentId(category, chosen.candidate.id);
    els.textarea.value = chosen.text;
    updateCharCount(els);
  } finally {
    els.generateBtn.disabled = false;
  }
}

async function copyPost(category) {
  const els = panelEls(category);
  if (!els || !els.textarea.value) return;

  try {
    await navigator.clipboard.writeText(els.textarea.value);
    const originalLabel = els.copyBtn.textContent;
    els.copyBtn.textContent = "Copied!";
    setTimeout(() => {
      els.copyBtn.textContent = originalLabel;
    }, 1500);
  } catch (error) {
    console.warn("[trending] Clipboard copy failed.", error);
  }
}

let currentCategory = CATEGORIES[0];

function initTabs() {
  const tabs = document.querySelectorAll("[data-trending-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const category = tab.getAttribute("data-trending-tab");
      currentCategory = category;

      tabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      CATEGORIES.forEach((c) => {
        const panel = document.querySelector(`[data-trending-panel="${c}"]`);
        if (panel) panel.hidden = c !== category;
      });

      renderCategoryState(category);
    });
  });
}

function initGenerators() {
  CATEGORIES.forEach((category) => {
    const els = panelEls(category);
    if (!els) return;

    els.generateBtn.addEventListener("click", () => generatePost(category));
    els.copyBtn.addEventListener("click", () => copyPost(category));
    els.textarea.addEventListener("input", () => updateCharCount(els));
    if (els.retryBtn) els.retryBtn.addEventListener("click", () => retryCategory(category));
  });
}

async function init() {
  initTabs();
  initGenerators();

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (error) {
    recordError("Firebase init", error);
    db = null;
  }

  await Promise.all(CATEGORIES.map((c) => loadConfig(c)));

  // Re-render whichever tab is currently visible now that configs have
  // loaded (the user may have already switched tabs while this was in
  // flight) — the rest warm lazily the first time their tab is opened.
  await renderCategoryState(currentCategory);
}

document.addEventListener("DOMContentLoaded", init);
