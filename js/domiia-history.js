/*
  PerthSanta Streaming — personal Domiia earning history (Step 9).
  ------------------------------------------------------------------
  Reads ONLY the signed-in user's own private ledger:

    users/{currentUser.uid}/domiiaEarnings/{earningId}

  — never another uid, and never from a URL/query parameter (spec
  section 3). This file is READ-ONLY with respect to reward logic: it
  never writes to the ledger, never recomputes a reward, and never
  changes domiiaBalance/lifetimeDomiias/streaks/achievements. Current
  Balance and Lifetime Earned come from the existing realtime
  users/{uid} profile listener (js/auth.js) — NEVER summed from ledger
  rows, because pre-ledger (pre-Step-8) earnings exist for any
  already-established account and summing would silently under-report
  (spec sections 17, 24, 50).

  Pagination mirrors js/leaderboard.js's fixed PAGE_SIZE+1 lookahead
  strategy exactly (the same bug class — "Load More" staying visible/
  re-fetching page 1 — is avoided the same way here).
*/

import { onAuthChange, openAuthModal, getCurrentUserProfile, safeDomiiaField } from "./auth.js";
import { db } from "./firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { renderDomiiaAmount, updateDomiiaAmount } from "./domiia.js";
import {
  getBangkokDateKey,
  getPreviousBangkokDateKey,
  getBangkokWeekKey,
  getBangkokMonthKey,
  getBangkokWeekLabel,
  getBangkokMonthLabel,
  getBangkokFullDateLabel,
  getBangkokTimeLabel
} from "./date-util.js";
import { ACHIEVEMENT_DEFINITIONS } from "./achievements-data.js";

const PAGE_SIZE = 25;

/* ==========================================================================
   DOM refs
   ========================================================================== */

const els = {
  signedOut: document.querySelector("[data-history-signedout]"),
  signInBtn: document.querySelector("[data-history-signin-btn]"),
  signedIn: document.querySelector("[data-history-signedin]"),
  currentBalance: document.querySelector("[data-history-current-balance]"),
  lifetimeEarned: document.querySelector("[data-history-lifetime-earned]"),
  periodRow: document.querySelector("[data-history-period-row]"),
  weekAmount: document.querySelector("[data-history-week-amount]"),
  monthAmount: document.querySelector("[data-history-month-amount]"),
  weekLabel: document.querySelector("[data-history-week-label]"),
  monthLabel: document.querySelector("[data-history-month-label]"),
  legacyNote: document.querySelector("[data-history-legacy-note]"),
  filterTabs: Array.from(document.querySelectorAll("[data-history-filter]")),
  list: document.querySelector("[data-history-list]"),
  loadMoreBtn: document.querySelector("[data-history-load-more]")
};

if (els.signInBtn) els.signInBtn.addEventListener("click", () => openAuthModal("signin", els.signInBtn));

/* ==========================================================================
   Source-type -> display mapping (spec sections 5-9, 26, 47)
   ------------------------------------------------------------------
   Internal fields (earningId, missionId, achievementId, weekKey,
   monthKey, raw sourceType strings) are NEVER shown to the user — only
   ever used here for lookups. An unrecognized sourceType (future-proofing
   — spec section 47) falls back to a generic label instead of crashing.
   ========================================================================== */

const SOURCE_ICON = {
  mission: "🎯",
  daily_completion: "📅",
  campaign_daily_completion: "📅",
  achievement: "🏆"
};

function iconFor(entry) {
  return SOURCE_ICON[entry.sourceType] || "✨";
}

// missionId -> {title} | null (fetched once, reused across every entry
// and every page), campaignId -> {title} | null, same idea. Achievement
// definitions are already local (js/achievements-data.js) — no fetch
// needed for those at all (spec section 48).
const missionCache = new Map();
const campaignCache = new Map();

async function resolveMissionTitle(missionId) {
  if (!missionId) return null;
  if (missionCache.has(missionId)) return missionCache.get(missionId);
  let title = null;
  try {
    const snap = await getDoc(doc(db, "missions", missionId));
    if (snap.exists() && typeof snap.data().title === "string") title = snap.data().title;
  } catch (error) {
    console.error("[domiia-history] could not resolve mission title", missionId, error);
  }
  missionCache.set(missionId, title);
  return title;
}

async function resolveCampaignTitle(campaignId) {
  if (!campaignId) return null;
  if (campaignCache.has(campaignId)) return campaignCache.get(campaignId);
  let title = null;
  try {
    const snap = await getDoc(doc(db, "campaigns", campaignId));
    if (snap.exists() && typeof snap.data().title === "string") title = snap.data().title;
  } catch (error) {
    console.error("[domiia-history] could not resolve campaign title", campaignId, error);
  }
  campaignCache.set(campaignId, title);
  return title;
}

/*
  resolveEntryDisplay(entry) -> Promise<{ icon, primary, secondary, badge }>
  ------------------------------------------------------------------
  primary/secondary: the two text lines (secondary is null when there's
  only one meaningful line — e.g. a deleted mission falls back to a
  single "Mission reward" line rather than an orphaned subtitle).
  badge: a short uppercase label ("HEARTBOUND" / "GENERAL") or null.
  Resolution reads mission/campaign docs ONLY by uid already cached per
  unique id (spec section 48) — achievement titles are a pure local
  array lookup, no read at all.
*/
async function resolveEntryDisplay(entry) {
  const icon = iconFor(entry);

  if (entry.sourceType === "mission") {
    const [missionTitle, campaignTitle] = await Promise.all([
      resolveMissionTitle(entry.missionId),
      resolveCampaignTitle(entry.campaignId)
    ]);
    const badge = entry.campaignId ? (campaignTitle || null) : "General";
    if (missionTitle) return { icon, primary: "Mission completed", secondary: missionTitle, badge };
    return { icon, primary: "Mission reward", secondary: null, badge };
  }

  if (entry.sourceType === "daily_completion") {
    return { icon, primary: "General daily missions complete", secondary: null, badge: "General" };
  }

  if (entry.sourceType === "campaign_daily_completion") {
    const campaignTitle = await resolveCampaignTitle(entry.campaignId);
    if (campaignTitle) {
      return { icon, primary: `${campaignTitle} daily missions complete`, secondary: null, badge: campaignTitle };
    }
    return { icon, primary: "Campaign daily missions complete", secondary: null, badge: null };
  }

  if (entry.sourceType === "achievement") {
    const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.id === entry.achievementId);
    if (def) return { icon, primary: "Achievement unlocked", secondary: def.title, badge: null };
    return { icon, primary: "Achievement reward", secondary: null, badge: null };
  }

  // Forward-compatible fallback (spec section 47) — never crash on a
  // sourceType this page doesn't know about yet.
  return { icon, primary: "Domiia reward", secondary: null, badge: null };
}

/* ==========================================================================
   Pagination — same PAGE_SIZE+1 lookahead strategy as js/leaderboard.js's
   fetchLeaderboardPage (spec section 12): never a wasted empty follow-up
   query, and lastDoc only ever advances when a new one genuinely exists
   (the exact previous Load More bug, avoided the same proven way).
   ========================================================================== */

async function fetchHistoryPage(uid, afterDoc) {
  const constraints = [
    collection(db, "users", uid, "domiiaEarnings"),
    orderBy("earnedAt", "desc")
  ];
  if (afterDoc) constraints.push(startAfter(afterDoc));
  constraints.push(limit(PAGE_SIZE + 1));

  const snap = await getDocs(query(...constraints));
  const displayedDocs = snap.docs.slice(0, PAGE_SIZE);

  return {
    entries: displayedDocs.map((d) => ({ id: d.id, ...d.data() })),
    lastDoc: displayedDocs.length ? displayedDocs[displayedDocs.length - 1] : null,
    hasMore: snap.docs.length > PAGE_SIZE
  };
}

// Optional This Week / This Month summary (spec section 18) — two single-
// field equality queries over the user's OWN ledger (auto-indexed, no
// composite index needed), summed client-side. Bounded by how much one
// user could realistically earn in a week/month, not the whole ledger —
// the same shape functions/leaderboardLogic.js's sumLedgerForPeriod
// already uses server-side for opt-in reconstruction.
async function sumLedgerForPeriod(uid, field, value) {
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "domiiaEarnings"), where(field, "==", value)));
    let total = 0;
    snap.forEach((d) => {
      total += Number(d.data().amount) || 0;
    });
    return total;
  } catch (error) {
    console.error(`[domiia-history] could not sum ledger for ${field}=${value}`, error);
    return null;
  }
}

/* ==========================================================================
   Rendering
   ========================================================================== */

let currentUid = null;
let lastDoc = null;
let hasMore = false;
let loadInFlight = false;
const loadedEarningIds = new Set(); // defensive dup guard (spec section 13)
const loadedEntries = []; // full unfiltered feed loaded so far, in order
let activeFilter = "all";
let lastKnownLifetimeBalance = null; // drives the empty-state wording below

function matchesFilter(entry, filter) {
  if (filter === "all") return true;
  if (filter === "missions") return entry.sourceType === "mission";
  if (filter === "daily") return entry.sourceType === "daily_completion" || entry.sourceType === "campaign_daily_completion";
  if (filter === "achievements") return entry.sourceType === "achievement";
  return true;
}

function groupLabelFor(dateKey, todayKey, yesterdayKey, entryDate) {
  if (dateKey === todayKey) return "TODAY";
  if (dateKey === yesterdayKey) return "YESTERDAY";
  return getBangkokFullDateLabel(entryDate).toUpperCase();
}

async function renderEntryCard(entry) {
  const display = await resolveEntryDisplay(entry);
  const earnedDate = entry.earnedAt && typeof entry.earnedAt.toDate === "function" ? entry.earnedAt.toDate() : new Date();

  const card = document.createElement("article");
  card.className = "history-entry";

  const main = document.createElement("div");
  main.className = "history-entry-main";

  const iconEl = document.createElement("span");
  iconEl.className = "history-entry-icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = display.icon;
  main.appendChild(iconEl);

  const text = document.createElement("div");
  text.className = "history-entry-text";

  const primary = document.createElement("p");
  primary.className = "history-entry-primary";
  primary.textContent = display.primary;
  text.appendChild(primary);

  if (display.secondary) {
    const secondary = document.createElement("p");
    secondary.className = "history-entry-secondary";
    secondary.textContent = display.secondary;
    text.appendChild(secondary);
  }

  const metaRow = document.createElement("div");
  metaRow.className = "history-entry-meta";
  if (display.badge) {
    const badge = document.createElement("span");
    badge.className = "history-entry-badge";
    badge.textContent = display.badge.toUpperCase();
    metaRow.appendChild(badge);
  }
  const time = document.createElement("span");
  time.className = "history-entry-time";
  time.textContent = `${getBangkokFullDateLabel(earnedDate)} · ${getBangkokTimeLabel(earnedDate)}`;
  metaRow.appendChild(time);
  text.appendChild(metaRow);

  main.appendChild(text);
  card.appendChild(main);

  const amountWrap = document.createElement("div");
  amountWrap.className = "history-entry-amount";
  const plus = document.createElement("span");
  plus.className = "history-entry-amount-plus";
  plus.textContent = "+";
  amountWrap.append(plus, renderDomiiaAmount(Number(entry.amount) || 0, { size: "medium" }));
  card.appendChild(amountWrap);

  return card;
}

async function renderList() {
  if (!els.list) return;
  const filtered = loadedEntries.filter((e) => matchesFilter(e, activeFilter));

  if (!loadedEntries.length) {
    els.list.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "history-empty-state";
    // A legacy account can have zero ledger rows yet a positive
    // lifetimeDomiias (every Domiia they've ever earned predates the
    // ledger) — "No Domiias earned yet" would be actively misleading
    // there, so this checks the realtime balance rather than assuming
    // (spec sections 23-24).
    empty.innerHTML = lastKnownLifetimeBalance > 0
      ? "<p>No individually tracked earnings yet.</p><p>New rewards you earn from here on will appear here.</p>"
      : "<p>No Domiias earned yet.</p><p>Complete missions and achievements to start earning Domiias.</p>";
    els.list.appendChild(empty);
    return;
  }

  if (!filtered.length) {
    els.list.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "cosmetic-section-status";
    empty.textContent = hasMore
      ? "No entries of this type in what's loaded so far — try Load More."
      : "No entries of this type.";
    els.list.appendChild(empty);
    return;
  }

  const todayKey = getBangkokDateKey(new Date());
  const yesterdayKey = getPreviousBangkokDateKey(new Date());

  els.list.innerHTML = "";
  let currentGroupKey = null;
  let groupListEl = null;

  for (const entry of filtered) {
    const earnedDate = entry.earnedAt && typeof entry.earnedAt.toDate === "function" ? entry.earnedAt.toDate() : new Date();
    const dateKey = getBangkokDateKey(earnedDate);

    if (dateKey !== currentGroupKey) {
      currentGroupKey = dateKey;
      const groupHeading = document.createElement("h3");
      groupHeading.className = "history-group-heading";
      groupHeading.textContent = groupLabelFor(dateKey, todayKey, yesterdayKey, earnedDate);
      els.list.appendChild(groupHeading);

      groupListEl = document.createElement("div");
      groupListEl.className = "history-group-list";
      els.list.appendChild(groupListEl);
    }

    groupListEl.appendChild(await renderEntryCard(entry));
  }
}

async function loadPage(reset) {
  if (!reset && loadInFlight) return;
  loadInFlight = true;

  if (reset) {
    lastDoc = null;
    hasMore = false;
    loadedEarningIds.clear();
    loadedEntries.length = 0;
    if (els.list) els.list.innerHTML = '<p class="cosmetic-section-status">Loading…</p>';
    if (els.loadMoreBtn) {
      els.loadMoreBtn.hidden = true;
      els.loadMoreBtn.disabled = false;
      els.loadMoreBtn.textContent = "Load More";
    }
  }

  try {
    const { entries, lastDoc: newLastDoc, hasMore: nextHasMore } = await fetchHistoryPage(currentUid, lastDoc);

    entries.forEach((entry) => {
      // Defensive duplicate guard (spec section 13) — never render the
      // same earning twice no matter what a query happens to return.
      if (loadedEarningIds.has(entry.id)) return;
      loadedEarningIds.add(entry.id);
      loadedEntries.push(entry);
    });

    // Only advance the cursor when there WAS a new last doc — the exact
    // same defensive fix the Leaderboard's own Load More bug needed.
    if (newLastDoc) lastDoc = newLastDoc;
    hasMore = nextHasMore;
    if (els.loadMoreBtn) els.loadMoreBtn.hidden = !hasMore;

    await renderList();
  } catch (error) {
    console.error("[domiia-history] could not load earning history", error);
    if (reset && els.list) {
      els.list.innerHTML = "";
      const errEl = document.createElement("p");
      errEl.className = "cosmetic-section-status";
      errEl.textContent = "Couldn't load your Domiia history right now. Please try again later.";
      els.list.appendChild(errEl);
    }
    if (reset && els.loadMoreBtn) els.loadMoreBtn.hidden = true;
  } finally {
    loadInFlight = false;
  }
}

if (els.loadMoreBtn) {
  els.loadMoreBtn.addEventListener("click", () => {
    if (els.loadMoreBtn.disabled) return;
    const previousLabel = els.loadMoreBtn.textContent;
    els.loadMoreBtn.disabled = true;
    els.loadMoreBtn.textContent = "Loading…";
    loadPage(false).finally(() => {
      els.loadMoreBtn.disabled = false;
      if (!els.loadMoreBtn.hidden) els.loadMoreBtn.textContent = previousLabel;
    });
  });
}

els.filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const filter = tab.getAttribute("data-history-filter");
    if (filter === activeFilter) return;
    activeFilter = filter;
    els.filterTabs.forEach((t) => t.classList.toggle("is-active", t === tab));
    renderList();
  });
});

/* ==========================================================================
   Balance summary + legacy-gap note (spec sections 17, 23-24)
   ------------------------------------------------------------------
   Current Balance / Lifetime Earned ALWAYS come from the realtime
   users/{uid} profile (never summed from ledger rows — lifetimeDomiias
   predates the ledger for any already-established account). The legacy
   note is shown whenever the account has ANY lifetimeDomiias at all —
   it's an honest, permanent disclosure ("earlier earnings may not be
   listed individually"), never a precise reconciliation, since we
   deliberately never try to infer the exact pre-ledger amount from a
   partial page (spec section 24: "do NOT try to infer exact missing
   amount from only one page").
   ========================================================================== */

function renderBalanceSummary(profile, loaded) {
  const currentBalance = loaded ? safeDomiiaField(profile, "domiiaBalance") : null;
  const lifetimeBalance = loaded ? safeDomiiaField(profile, "lifetimeDomiias") : null;
  if (els.currentBalance) updateDomiiaAmount(els.currentBalance, currentBalance);
  if (els.lifetimeEarned) updateDomiiaAmount(els.lifetimeEarned, lifetimeBalance);

  if (els.legacyNote) {
    // Only meaningful once the balance is known — avoids a flash of the
    // note before the profile has loaded at all.
    els.legacyNote.hidden = !loaded || !(lifetimeBalance > 0);
  }

  const balanceKnownNow = loaded && typeof lifetimeBalance === "number";
  if (balanceKnownNow && lastKnownLifetimeBalance === null) {
    lastKnownLifetimeBalance = lifetimeBalance;
    renderList(); // the empty-state wording depends on this — refresh once it's known
  } else if (balanceKnownNow) {
    lastKnownLifetimeBalance = lifetimeBalance;
  }
}

async function loadPeriodSummary(uid) {
  if (!els.periodRow) return;
  const now = new Date();
  // Same label convention leaderboard.html already uses for its Weekly/
  // Monthly tabs — "This Week" + the ISO week's date range, "This Month"
  // + the month name, rather than a bare static word.
  if (els.weekLabel) els.weekLabel.textContent = `This Week: ${getBangkokWeekLabel(now)}`;
  if (els.monthLabel) els.monthLabel.textContent = getBangkokMonthLabel(now);

  const [weekTotal, monthTotal] = await Promise.all([
    sumLedgerForPeriod(uid, "weekKey", getBangkokWeekKey(now)),
    sumLedgerForPeriod(uid, "monthKey", getBangkokMonthKey(now))
  ]);
  if (els.weekAmount && weekTotal !== null) updateDomiiaAmount(els.weekAmount, weekTotal);
  if (els.monthAmount && monthTotal !== null) updateDomiiaAmount(els.monthAmount, monthTotal);
}

/* ==========================================================================
   Auth-driven signed-in/out switch
   ========================================================================== */

onAuthChange((user, profile, loaded) => {
  if (!els.signedOut || !els.signedIn) return;

  if (!user) {
    currentUid = null;
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    return;
  }

  els.signedOut.hidden = true;
  els.signedIn.hidden = false;
  renderBalanceSummary(profile || getCurrentUserProfile(), loaded);

  if (currentUid !== user.uid) {
    currentUid = user.uid;
    loadPage(true);
    loadPeriodSummary(user.uid);
  }
});
