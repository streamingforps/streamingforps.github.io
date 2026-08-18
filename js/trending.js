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
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const CATEGORIES = ["perthsanta", "perth", "santa"];
const FETCH_TIMEOUT_MS = 2500;
const BATCH_SIZE = 40;
const ELIGIBLE_FLOOR = 8;
const RECENT_LIMIT = 20;
const MAX_TOPUP_ATTEMPTS = 3;
const MAX_POST_LENGTH = 280;

let db = null;

/* ==========================================================================
   Small shared helpers
   ========================================================================== */

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
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

async function fetchConfig(category) {
  const fallback = (typeof siteData !== "undefined" && siteData.trending && siteData.trending[category]) || {
    eventName: "",
    keyword: "",
    hashtags: [],
    active: false
  };

  if (!db) return fallback;

  try {
    const snap = await withTimeout(getDoc(doc(db, `trending/${category}`)), FETCH_TIMEOUT_MS);
    if (!snap || typeof snap.exists !== "function" || !snap.exists()) return fallback;
    const data = snap.data();
    return {
      eventName: typeof data.eventName === "string" ? data.eventName : fallback.eventName,
      keyword: typeof data.keyword === "string" ? data.keyword : fallback.keyword,
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : fallback.hashtags,
      active: typeof data.active === "boolean" ? data.active : fallback.active
    };
  } catch (error) {
    console.warn(`[trending] Could not load config for "${category}" — using fallback.`, error);
    return fallback;
  }
}

/* ==========================================================================
   Bounded randomized phrase pool
   ========================================================================== */

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

  try {
    const firstQuery = query(
      phrasesRef,
      where("randomKey", ">=", randomStart),
      orderBy("randomKey"),
      limit(BATCH_SIZE)
    );
    const firstSnap = await withTimeout(getDocs(firstQuery), FETCH_TIMEOUT_MS);
    if (firstSnap) {
      firstSnap.docs.forEach((d) => merged.set(d.id, d));
    }

    // Wrap around: if the random start didn't yield a full batch (ran off
    // the end of the key space, or the whole library is smaller than
    // BATCH_SIZE), pull a batch from the very start and merge (Map dedupes).
    if (merged.size < BATCH_SIZE) {
      const wrapQuery = query(phrasesRef, orderBy("randomKey"), limit(BATCH_SIZE));
      const wrapSnap = await withTimeout(getDocs(wrapQuery), FETCH_TIMEOUT_MS);
      if (wrapSnap) {
        wrapSnap.docs.forEach((d) => merged.set(d.id, d));
      }
    }
  } catch (error) {
    console.warn(`[trending] Could not load phrase batch for "${category}".`, error);
    return null;
  }

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
    if (batch === null) break; // fetch error — stop; caller checks state.items.length

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

  return state;
}

/* ==========================================================================
   Page wiring
   ========================================================================== */

const configCache = {};

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
    inactiveMsg: panel.querySelector("[data-trending-inactive]"),
    unavailableMsg: panel.querySelector("[data-trending-unavailable]")
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

async function renderCategoryState(category) {
  const els = panelEls(category);
  if (!els) return;

  const config = configCache[category];

  if (!config || !config.active) {
    els.eventTag.hidden = true;
    els.generator.hidden = true;
    els.unavailableMsg.hidden = true;
    els.inactiveMsg.hidden = false;
    return;
  }

  els.inactiveMsg.hidden = true;
  els.eventTag.hidden = false;
  els.eventName.textContent = config.eventName || "";
  els.generator.hidden = false;
  els.unavailableMsg.hidden = true;

  // Warm the candidate pool for this category the first time its tab is
  // shown, so the first "Generate Post" click doesn't have to wait.
  const state = await ensurePool(category, ELIGIBLE_FLOOR);
  if (state.items.length === 0) {
    els.generator.hidden = true;
    els.unavailableMsg.hidden = false;
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

    if (state.items.length === 0) {
      els.generator.hidden = true;
      els.unavailableMsg.hidden = false;
      return;
    }

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
  });
}

async function init() {
  initTabs();
  initGenerators();

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (error) {
    console.warn("[trending] Firebase failed to initialize — using data.js fallback config only.", error);
    db = null;
  }

  const configs = await Promise.all(CATEGORIES.map((c) => fetchConfig(c)));
  CATEGORIES.forEach((c, i) => {
    configCache[c] = configs[i];
  });

  // Re-render whichever tab is currently visible now that configs have
  // loaded (the user may have already switched tabs while this was in
  // flight) — the rest warm lazily the first time their tab is opened.
  await renderCategoryState(currentCategory);
}

document.addEventListener("DOMContentLoaded", init);
