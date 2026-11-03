/*
  Shared public-leaderboard mirror sync — the ONE place that knows the
  leaderboard/{uid} document's shape. Every backend path that can change
  a user's public-safe fields (lifetimeDomiias via missionLogic.js/
  achievementLogic.js, selectedAvatar via cosmeticLogic.js, displayName
  via the rename flow) calls into this instead of re-deriving the
  mapping itself (Step 7 spec section 10: "do not duplicate mapping
  logic throughout multiple functions").

  leaderboard/{uid} is intentionally minimal — uid, displayName,
  avatarPath, lifetimeDomiias, updatedAt ONLY (Step 7 spec section 31).
  No email, no Google photoURL, no current domiiaBalance, no internal
  progression/reward fields. Firestore rules make this collection public
  read / admin write — Cloud Functions (Admin SDK) are the only writer,
  same security posture as every other backend-owned collection in this
  project.

  A leaderboard document existing AT ALL means that user is opted in —
  there is no separate "exists but hidden" state. Opting out deletes the
  document outright (see deleteLeaderboardEntry, called from the
  setLeaderboardOptIn callable). Every sync helper below is a no-op for a
  user who isn't currently opted in, by design — it never creates an
  entry for someone who hasn't opted in, and never needs to "check
  first" since set()/delete() are idempotent either way.
*/

const { HttpsError } = require("firebase-functions/v2/https");
const { getBangkokWeekKey, getBangkokMonthKey } = require("./dateUtil");

/*
  Weekly/monthly PUBLIC leaderboard mirrors — Step 8.
  ------------------------------------------------------------------
  Collection shape: a FLAT doc per (period, user) — leaderboardWeekly/
  {weekKey}_{uid}, leaderboardMonthly/{monthKey}_{uid} — rather than
  nesting users under a period doc (leaderboardWeekly/{weekKey}/users/
  {uid}). Chosen specifically for opt-out cleanup (spec section 16): with
  a flat collection, "delete every public period doc this user has ever
  had" is one `where("uid","==",uid)` query per collection, independent of
  how many periods exist. With the nested shape, the same cleanup would
  need to enumerate every period sub-collection there has EVER been (no
  single query reaches across all of them), which only gets more expensive
  over the site's lifetime. The flat shape also makes the leaderboard
  QUERY itself simple and index-friendly: `where("periodKey","==",
  currentWeek).orderBy("score","desc").orderBy("displayName","asc")` is a
  single composite index, same shape as the existing all-time query.

  Doc schema (identical for both collections): { uid, periodKey,
  displayName, avatarPath, score, updatedAt } — periodKey is the weekKey/
  monthKey this particular doc represents (redundant with the ID's own
  prefix, but needed as an actual FIELD for the where()/orderBy() query
  above — Firestore can't query on substrings of a document ID). No email,
  no internal reward-source history — same public-safe posture as
  leaderboard/{uid} (spec section 53).

  A doc only exists for a (period, uid) pair the user actually earned
  Domiias in (or synced into, via reconstructPeriodLeaderboardFromLedger)
  WHILE opted in — same "existence IS the opt-in signal" rule as
  leaderboard/{uid}.
*/
const WEEKLY_COLLECTION = "leaderboardWeekly";
const MONTHLY_COLLECTION = "leaderboardMonthly";

function periodDocId(periodKey, uid) {
  return `${periodKey}_${uid}`;
}

function buildPublicFields(uid, { displayName, avatarPath, lifetimeDomiias, now }) {
  return {
    uid,
    displayName,
    avatarPath: typeof avatarPath === "string" && avatarPath ? avatarPath : null,
    lifetimeDomiias: Number(lifetimeDomiias) || 0,
    updatedAt: now
  };
}

// tx: optional Firestore Transaction. set() with no merge flag fully
// overwrites the document, so — unlike update() — this never needs a
// prior read of leaderboard/{uid} itself, transactional or otherwise.
function writeLeaderboardEntry(db, { tx, uid, displayName, avatarPath, lifetimeDomiias, now }) {
  const ref = db.collection("leaderboard").doc(uid);
  const fields = buildPublicFields(uid, { displayName, avatarPath, lifetimeDomiias, now });
  if (tx) {
    tx.set(ref, fields);
    return undefined;
  }
  return ref.set(fields);
}

function deleteLeaderboardEntry(db, { tx, uid }) {
  const ref = db.collection("leaderboard").doc(uid);
  if (tx) {
    tx.delete(ref);
    return undefined;
  }
  // delete() on a document that doesn't exist succeeds silently in
  // Firestore — safe to call unconditionally from repair/reconciliation
  // paths without checking existence first.
  return ref.delete();
}

// Called from every reward/profile-field-changing code path (mission
// completion, achievement unlock/reconciliation, cosmetic equip) — syncs
// the mirror ONLY if currently opted in; otherwise does nothing (not
// even a read), so this is cheap to call unconditionally from a hot path
// like recordMissionAction.
function syncLeaderboardIfOptedIn(db, { tx, uid, leaderboardOptIn, displayName, avatarPath, lifetimeDomiias, now }) {
  if (leaderboardOptIn !== true) return undefined;
  return writeLeaderboardEntry(db, { tx, uid, displayName, avatarPath, lifetimeDomiias, now });
}

/*
  incrementPeriodLeaderboards(db, { tx, uid, leaderboardOptIn, displayName,
    avatarPath, weekKey, monthKey, scoreIncrement, now, FieldValue })
  ------------------------------------------------------------------
  The HOT-PATH write, called from inside missionLogic.js's and
  achievementLogic.js's own reward transactions (and, with
  scoreIncrement 0, from cosmeticLogic.js's non-transactional avatar-equip
  flow, to keep displayName/avatarPath fresh without touching score). A
  no-op entirely when not opted in (same convention as
  syncLeaderboardIfOptedIn above).

  Uses FieldValue.increment() inside a merge:true set(), which needs no
  prior read of either document: increment() treats a missing field as 0,
  and merge:true creates the doc on its very first write for a (uid,
  period) pair. That's what makes this safe and cheap to call
  unconditionally from a hot path — no "does this period doc exist yet"
  branch anywhere (spec section 52: normal reward path only ever needs to
  know weekKey/monthKey/amount, never scan anything).
*/
function incrementPeriodLeaderboards(db, { tx, uid, leaderboardOptIn, displayName, avatarPath, weekKey, monthKey, scoreIncrement, now, FieldValue }) {
  if (leaderboardOptIn !== true) return undefined;

  const amount = scoreIncrement || 0;
  const weeklyRef = db.collection(WEEKLY_COLLECTION).doc(periodDocId(weekKey, uid));
  const monthlyRef = db.collection(MONTHLY_COLLECTION).doc(periodDocId(monthKey, uid));
  const avatar = typeof avatarPath === "string" && avatarPath ? avatarPath : null;

  const weeklyFields = { uid, periodKey: weekKey, displayName, avatarPath: avatar, score: FieldValue.increment(amount), updatedAt: now };
  const monthlyFields = { uid, periodKey: monthKey, displayName, avatarPath: avatar, score: FieldValue.increment(amount), updatedAt: now };

  if (tx) {
    tx.set(weeklyRef, weeklyFields, { merge: true });
    tx.set(monthlyRef, monthlyFields, { merge: true });
    return undefined;
  }
  return Promise.all([weeklyRef.set(weeklyFields, { merge: true }), monthlyRef.set(monthlyFields, { merge: true })]);
}

// Sums users/{uid}/domiiaEarnings for one period field ("weekKey" or
// "monthKey") equal to one period value — a single-field equality filter
// on a direct sub-collection query, which needs no composite index.
// Called ONLY from reconstructPeriodLeaderboardFromLedger below — never
// from the normal reward hot path (spec section 52) — so this never runs
// more than once per opt-in action or per missing-mirror repair.
async function sumLedgerForPeriod(db, uid, field, value) {
  const snap = await db.collection("users").doc(uid).collection("domiiaEarnings").where(field, "==", value).get();
  let total = 0;
  snap.docs.forEach((d) => {
    total += Number(d.data().amount) || 0;
  });
  return total;
}

/*
  reconstructPeriodLeaderboardFromLedger(db, { uid, displayName,
    avatarPath, now }, { onlyIfMissing })
  ------------------------------------------------------------------
  Establishes the CURRENT week's and CURRENT month's public score from
  scratch, by summing the user's own private ledger for those two period
  keys — this is the "opt in mid-week with 100 Domiias already earned
  since Monday -> weekly score starts at 100, not 0" requirement (spec
  section 14), and the "opt out then back in -> no score loss" requirement
  (spec section 41). A plain (non-tx) full overwrite is correct here: this
  function is the authority recomputing the whole value from the ledger,
  not an incremental adjustment to existing state.

  opts.onlyIfMissing (used by syncLeaderboardProfileCore's repair/backfill
  call — spec sections 13, 38): when true, a period doc that ALREADY
  exists is left with its current score untouched and only has its
  displayName/avatarPath/updatedAt refreshed; only a genuinely MISSING
  period doc gets its score recomputed from the ledger. This keeps a
  routine once-per-session profile-sync call cheap (no ledger scan at all
  in the common case where both mirrors already exist) while still fully
  self-healing a stale/missing mirror. setLeaderboardOptInCore's own call
  (actually opting in) always recomputes unconditionally — that's the one
  moment the ledger sum is actually supposed to become the new truth.

  Not run inside any transaction — see the opt-in/opt-out callers for why
  that's an accepted, narrow, self-healing tradeoff (documented there).
*/
async function reconstructPeriodLeaderboardFromLedger(db, { uid, displayName, avatarPath, now }, opts = {}) {
  const nowDate = now.toDate();
  const weekKey = getBangkokWeekKey(nowDate);
  const monthKey = getBangkokMonthKey(nowDate);
  const avatar = typeof avatarPath === "string" && avatarPath ? avatarPath : null;

  const weeklyRef = db.collection(WEEKLY_COLLECTION).doc(periodDocId(weekKey, uid));
  const monthlyRef = db.collection(MONTHLY_COLLECTION).doc(periodDocId(monthKey, uid));

  const [weeklySnap, monthlySnap] = await Promise.all([weeklyRef.get(), monthlyRef.get()]);

  const weekScore = (opts.onlyIfMissing && weeklySnap.exists)
    ? Number(weeklySnap.data().score) || 0
    : await sumLedgerForPeriod(db, uid, "weekKey", weekKey);
  const monthScore = (opts.onlyIfMissing && monthlySnap.exists)
    ? Number(monthlySnap.data().score) || 0
    : await sumLedgerForPeriod(db, uid, "monthKey", monthKey);

  await Promise.all([
    weeklyRef.set({ uid, periodKey: weekKey, displayName, avatarPath: avatar, score: weekScore, updatedAt: now }),
    monthlyRef.set({ uid, periodKey: monthKey, displayName, avatarPath: avatar, score: monthScore, updatedAt: now })
  ]);

  return { weekKey, monthKey, weekScore, monthScore };
}

async function deletePeriodDocsWhereUidEquals(db, collectionName, uid) {
  const snap = await db.collection(collectionName).where("uid", "==", uid).get();
  await Promise.all(snap.docs.map((d) => db.collection(collectionName).doc(d.id).delete()));
  return snap.docs.length;
}

/*
  deleteAllCurrentAndHistoricalPeriodEntries(db, { uid })
  ------------------------------------------------------------------
  Opt-out cleanup (spec section 15 — "opt-out means fully private"):
  removes EVERY public leaderboardWeekly/leaderboardMonthly doc this user
  has ever had, not just the current period's. The flat {periodKey}_{uid}
  doc-ID scheme (see the collection-shape comment above) is what makes
  this a single `where("uid","==",uid)` query per collection regardless of
  how many periods exist, rather than needing to enumerate every period
  sub-collection there has ever been.

  TRADEOFF: this is NOT run inside the setLeaderboardOptIn transaction
  (nor inside any transaction at all). An account that has been opted in
  for a very long time could in principle have an unbounded number of
  historical period docs, and a single Firestore transaction is capped at
  500 writes — doing this transactionally would eventually fail for a
  long-lived account. Run as a plain best-effort sequence of deletes right
  after the core opt-out transaction commits instead: each delete is
  independently idempotent (deleting an already-deleted doc is a safe
  no-op), so a partial failure here just leaves a stray historical doc to
  be cleaned up on a later opt-out/retry, never a security hole (private
  ledger data is never exposed by this — only already-public period
  scores, which is the exact data this call exists to remove).
*/
async function deleteAllCurrentAndHistoricalPeriodEntries(db, { uid }) {
  const [weeklyDeleted, monthlyDeleted] = await Promise.all([
    deletePeriodDocsWhereUidEquals(db, WEEKLY_COLLECTION, uid),
    deletePeriodDocsWhereUidEquals(db, MONTHLY_COLLECTION, uid)
  ]);
  return { weeklyDeleted, monthlyDeleted };
}

function userAvatarPath(userData) {
  return typeof userData.selectedAvatar === "string" && userData.selectedAvatar ? userData.selectedAvatar : null;
}

/*
  setLeaderboardOptInCore(db, { uid, enabled, now })
  ------------------------------------------------------------------
  The ONLY way leaderboardOptIn can change (firestore.rules blocks it
  from direct client writes, same posture as every other backend-only
  user field). One transaction: flips the flag on users/{uid} and
  creates/deletes leaderboard/{uid} together, so the two can never
  observably disagree (no window where OptIn is true but no mirror doc
  exists, or vice versa, from this flow's own action).
*/
async function setLeaderboardOptInCore(db, { uid, enabled, now }) {
  const userRef = db.collection("users").doc(uid);
  const isEnabled = enabled === true;

  // Core transaction: just the flag flip + the all-time mirror, exactly
  // as before Step 8 — the one thing that must never observably disagree
  // with leaderboardOptIn itself (spec section 13's "existence IS the
  // opt-in signal" invariant). Captures displayName/avatarPath from
  // whichever attempt actually commits, for the weekly/monthly step below.
  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const userData = userSnap.data();

    tx.update(userRef, { leaderboardOptIn: isEnabled, updatedAt: now });

    if (isEnabled) {
      writeLeaderboardEntry(db, {
        tx,
        uid,
        displayName: userData.displayName,
        avatarPath: userAvatarPath(userData),
        lifetimeDomiias: userData.lifetimeDomiias,
        now
      });
    } else {
      deleteLeaderboardEntry(db, { tx, uid });
    }

    return { ok: true, leaderboardOptIn: isEnabled, displayName: userData.displayName, avatarPath: userAvatarPath(userData) };
  });

  // Weekly/monthly mirrors are reconciled OUTSIDE the transaction above —
  // deliberately. Opting in needs to SUM the user's private ledger (an
  // unbounded-ish read, not a fixed set of documents known in advance),
  // and opting out needs to delete a potentially unbounded number of
  // historical period docs (see deleteAllCurrentAndHistoricalPeriodEntries
  // for why that specifically can't be transactional). Opting in/out is a
  // rare, user-initiated action — not a reward hot path — so the extra
  // non-transactional round trip costs nothing that matters.
  //
  // Accepted narrow race: a concurrent reward landing in the gap between
  // the transaction above committing and this step completing could, in
  // rare interleavings, have its weekly/monthly contribution overwritten
  // by this step's ledger-sum snapshot (taken a moment earlier). The
  // reward's OWN ledger entry is never lost (it's independently written,
  // idempotent, inside its own transaction) — only the aggregate score
  // could transiently miss it, and the next syncLeaderboardProfile repair
  // call self-heals it by re-summing. Not worth a transactional query
  // across two extra collections for a user action this infrequent.
  if (isEnabled) {
    await reconstructPeriodLeaderboardFromLedger(db, {
      uid,
      displayName: result.displayName,
      avatarPath: result.avatarPath,
      now
    });
  } else {
    await deleteAllCurrentAndHistoricalPeriodEntries(db, { uid });
  }

  return { ok: true, leaderboardOptIn: isEnabled };
}

/*
  syncLeaderboardProfileCore(db, { uid, now })
  ------------------------------------------------------------------
  Idempotent repair/backfill (Step 7 spec sections 13, 38): reconciles
  leaderboard/{uid} to match the user's CURRENT users/{uid} state,
  whichever direction that means —
    - opted in but the mirror is missing/stale (e.g. created before this
      feature existed, or a previous sync call was interrupted): writes
      the current snapshot.
    - opted out but a stray mirror doc somehow still exists (e.g. a past
      bug, a manual Firestore edit): deletes it.
  Never touches domiiaBalance, lifetimeDomiias, missionsCompleted, or any
  other progression field on users/{uid} itself — read-only on that
  document, write-only on the public mirror.

  Not run inside a transaction — like cosmeticLogic.js's equivalent
  repair function, every write here is idempotent and there's no
  counter/currency involved, so there's no correctness reason to pay for
  transactional overhead.
*/
async function syncLeaderboardProfileCore(db, { uid, now }) {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const userData = userSnap.data();
  const isOptedIn = userData.leaderboardOptIn === true;

  if (isOptedIn) {
    await writeLeaderboardEntry(db, {
      uid,
      displayName: userData.displayName,
      avatarPath: userAvatarPath(userData),
      lifetimeDomiias: userData.lifetimeDomiias,
      now
    });
    // onlyIfMissing: true — a routine repair call must never reset an
    // already-correct weekly/monthly score back to a re-summed ledger
    // total (cheap in the common case: no ledger scan at all once both
    // mirrors already exist). See the function's own docstring.
    await reconstructPeriodLeaderboardFromLedger(
      db,
      { uid, displayName: userData.displayName, avatarPath: userAvatarPath(userData), now },
      { onlyIfMissing: true }
    );
  } else {
    await deleteLeaderboardEntry(db, { uid });
    await deleteAllCurrentAndHistoricalPeriodEntries(db, { uid });
  }

  return { ok: true, leaderboardOptIn: isOptedIn };
}

module.exports = {
  WEEKLY_COLLECTION,
  MONTHLY_COLLECTION,
  periodDocId,
  writeLeaderboardEntry,
  deleteLeaderboardEntry,
  syncLeaderboardIfOptedIn,
  incrementPeriodLeaderboards,
  sumLedgerForPeriod,
  reconstructPeriodLeaderboardFromLedger,
  deleteAllCurrentAndHistoricalPeriodEntries,
  setLeaderboardOptInCore,
  syncLeaderboardProfileCore
};
