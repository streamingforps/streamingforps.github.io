/*
  PerthSanta Streaming — public Domiia leaderboard (Step 7, extended with
  Weekly/Monthly in Step 8).
  ------------------------------------------------------------------
  Three things live here:
    1. setLeaderboardOptIn(enabled) / syncLeaderboardProfile() — thin
       callable wrappers, used by both profile.html and leaderboard.html
       (spec section 28: one opt-in system, never a second one).
    2. fetchLeaderboardPage({period, periodKey, afterDoc}) — ONE shared
       query function for all three tabs (spec section 25: "do not create
       three unrelated files"). Each period reads from its own
       public-safe mirror collection, maintained server-side:
         - allTime:  leaderboard/{uid}            orderBy lifetimeDomiias
         - weekly:   leaderboardWeekly/{wk}_{uid}  where periodKey==wk,
                                                    orderBy score
         - monthly:  leaderboardMonthly/{mo}_{uid} where periodKey==mo,
                                                    orderBy score
       All three share the same PAGE_SIZE+1 lookahead pagination strategy
       (see the fix this file already carries from the all-time-only bug
       report) and the same tiebreak (displayName asc) — never fetches a
       whole collection into JS; leaderboard.html owns the "Load More"
       button/pagination state per tab and calls this once per page.
    3. getCurrentPeriodKeys()/period label helpers — re-exported from
       js/date-util.js so leaderboard.html has one place to get "which
       week/month am I looking at" from.

  Every entry this file returns is normalized to { uid, displayName,
  avatarPath, score } regardless of source collection/field name, so
  leaderboard.html's rendering code never branches on which tab it's in.
*/

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { functions, db } from "./firebase-app.js";
import { getBangkokWeekKey, getBangkokMonthKey, getBangkokWeekLabel, getBangkokMonthLabel } from "./date-util.js";

const PAGE_SIZE = 50;

const setLeaderboardOptInCallable = httpsCallable(functions, "setLeaderboardOptIn");
const syncLeaderboardProfileCallable = httpsCallable(functions, "syncLeaderboardProfile");

async function setLeaderboardOptIn(enabled) {
  const response = await setLeaderboardOptInCallable({ enabled: !!enabled });
  return response.data;
}

// Idempotent repair/backfill (spec sections 13, 38) — call once per
// sign-in/session, and once right after a successful display-name
// rename (see js/auth.js). Never call this on every realtime profile
// snapshot; it isn't needed that often and isn't free.
async function syncLeaderboardProfile() {
  const response = await syncLeaderboardProfileCallable({});
  return response.data;
}

// The weekKey/monthKey "right now" is looking at, plus their display
// labels — computed client-side (public-safe: see js/date-util.js's file
// header for why this is never the source of truth for what a user is
// AWARDED). Called fresh by leaderboard.html on load and on each tab
// switch, never cached across a page's lifetime (a page left open across
// a week/month rollover will simply show the new period on next refresh,
// same as any other "current period" UI).
function getCurrentPeriodKeys(now) {
  const date = now || new Date();
  return {
    weekKey: getBangkokWeekKey(date),
    monthKey: getBangkokMonthKey(date),
    weekLabel: getBangkokWeekLabel(date),
    monthLabel: getBangkokMonthLabel(date)
  };
}

function buildConstraintsFor(period, periodKey) {
  if (period === "allTime") {
    return {
      base: [collection(db, "leaderboard"), orderBy("lifetimeDomiias", "desc"), orderBy("displayName", "asc")],
      scoreField: "lifetimeDomiias"
    };
  }
  const collectionName = period === "weekly" ? "leaderboardWeekly" : "leaderboardMonthly";
  return {
    base: [
      collection(db, collectionName),
      where("periodKey", "==", periodKey),
      orderBy("score", "desc"),
      orderBy("displayName", "asc")
    ],
    scoreField: "score"
  };
}

/*
  fetchLeaderboardPage({ period, periodKey, afterDoc }) -> Promise<{ entries, lastDoc, hasMore }>
  ------------------------------------------------------------------
  period: "allTime" | "weekly" | "monthly".
  periodKey: the weekKey/monthKey to query — REQUIRED for "weekly"/
    "monthly" (ignored for "allTime", which has no period). Callers get
    this from getCurrentPeriodKeys() above.
  afterDoc: the raw QueryDocumentSnapshot from a previous page's
    `lastDoc` (NOT just its data) — Firestore's startAfter() cursor needs
    the actual snapshot, so leaderboard.html should hold onto it as opaque
    pagination state rather than re-deriving it from the plain entry data.

  Fetches PAGE_SIZE + 1 documents (one extra "lookahead" doc) so hasMore
  is known EXACTLY, without a wasted follow-up query that returns zero
  results — this is the exact fix for the previously-reported bug where a
  page with 0 new docs resolved `lastDoc: null`, and the caller overwrote
  its previously-good cursor with that null, silently restarting
  pagination from page 1 on the next click. lastDoc here always
  corresponds to the last DISPLAYED entry (after slicing off the
  lookahead doc), never the lookahead doc itself.
*/
async function fetchLeaderboardPage({ period, periodKey, afterDoc }) {
  const { base, scoreField } = buildConstraintsFor(period, periodKey);
  const constraints = base.slice();
  if (afterDoc) constraints.push(startAfter(afterDoc));
  constraints.push(limit(PAGE_SIZE + 1));

  const snap = await getDocs(query(...constraints));
  const displayedDocs = snap.docs.slice(0, PAGE_SIZE);

  return {
    entries: displayedDocs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        uid: data.uid,
        displayName: data.displayName,
        avatarPath: data.avatarPath,
        score: Number(data[scoreField]) || 0
      };
    }),
    lastDoc: displayedDocs.length ? displayedDocs[displayedDocs.length - 1] : null,
    hasMore: snap.docs.length > PAGE_SIZE
  };
}

export { setLeaderboardOptIn, syncLeaderboardProfile, fetchLeaderboardPage, getCurrentPeriodKeys, PAGE_SIZE };
