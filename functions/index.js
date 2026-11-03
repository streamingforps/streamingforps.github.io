/*
  PerthSanta Streaming — Cloud Functions.
  ------------------------------------------------------------------
  Step 3: missions + tracked actions + secure Domiia rewards.

  recordMissionAction(actionId) is the ONLY way domiiaBalance,
  lifetimeDomiias, missionsCompleted, or any missionProgress/actionHistory
  document can change — Firestore rules (see ../firestore.rules) block all
  of that from the client, by design. This file is the trusted backend
  that's allowed to write them, via the Admin SDK, which bypasses
  Firestore security rules entirely (that's expected and is the whole
  point of a callable function here).

  Everything the client sends is treated as untrusted: the only input
  this function accepts is `actionId` (a plain string). The caller's uid
  comes from the verified callable auth context, never from request.data.
  Every mission rule (target, reward, cooldown, daily cap, date) is
  derived server-side from the mission's own Firestore document and the
  server's own clock.

  The actual counting/completion/reward logic lives in missionLogic.js —
  this file is just the thin, deployable callable wrapper (auth check +
  input validation), kept separate so the logic can be exercised directly
  against a real Firestore (emulated) instance in tests.
*/

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { recordMissionActionCore } = require("./missionLogic");
const { equipCosmeticCore, syncAchievementCosmeticsCore } = require("./cosmeticLogic");
const { syncAchievementsCore } = require("./achievementLogic");
const { setLeaderboardOptInCore, syncLeaderboardProfileCore } = require("./leaderboardLogic");
const { ACHIEVEMENTS } = require("./achievements");

// firebase-admin v13+ moved everything out of the old `admin.firestore()`
// namespaced API into per-service modular imports (same shape as the
// client SDK) — require("firebase-admin") alone no longer exposes
// .firestore/.auth/etc. at all.
initializeApp();
const db = getFirestore();

// One region for every function in this codebase — the client
// (js/firebase-app.js) calls getFunctions(app, "asia-southeast1") to
// match. Chosen because the site's fandom/audience focus is Thailand/
// Southeast Asia, and it's a standard, fully-supported 2nd-gen Cloud
// Functions region (no special allowlisting needed).
setGlobalOptions({ region: "asia-southeast1" });

/* ==========================================================================
   recordMissionAction — 2nd-gen callable.
   ------------------------------------------------------------------
   App Check is intentionally NOT enforced yet (see the Step 3 brief this
   was built against — confirm legitimate web traffic works first). To
   enable it later: pass `enforceAppCheck: true` in the options object
   below, and the client needs an App Check provider configured
   (reCAPTCHA v3/Enterprise for web). Nothing else about this function's
   logic needs to change.
   ========================================================================== */

exports.recordMissionAction = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to track mission progress.");
  }

  const actionId = request.data && request.data.actionId;
  if (typeof actionId !== "string" || !actionId.trim()) {
    throw new HttpsError("invalid-argument", "actionId is required.");
  }

  return recordMissionActionCore(db, {
    uid: request.auth.uid,
    actionId,
    now: Timestamp.now(),
    Timestamp,
    FieldValue
  });
});

/* ==========================================================================
   equipCosmetic — Step 6.
   ------------------------------------------------------------------
   The ONLY way selectedAvatar/selectedBackground/selectedTheme can
   change — firestore.rules blocks all three from direct client writes,
   same security posture as recordMissionAction above. Ownership, cosmetic
   type, and (for themes) the recognized themeKey are all verified
   server-side in cosmeticLogic.js; the client only ever says "equip this
   cosmetic" or "revert this category to default".
   ========================================================================== */

exports.equipCosmetic = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to customize your profile.");
  }

  const data = request.data || {};
  const cosmeticId = data.cosmeticId === undefined ? null : data.cosmeticId;
  const type = typeof data.type === "string" ? data.type : null;

  return equipCosmeticCore(db, {
    uid: request.auth.uid,
    cosmeticId,
    type,
    now: Timestamp.now(),
    FieldValue
  });
});

/* ==========================================================================
   syncAchievements — historical achievement reconciliation.
   ------------------------------------------------------------------
   Fixes the "I completed missions before the achievement system existed
   and First Steps is still locked" bug: evaluates the caller's CURRENT
   authoritative stats (missionsCompleted/daysCompleted/longestStreak)
   against every ACHIEVEMENTS definition and creates any missing-but-
   qualifying achievement doc, awarding its Domiia reward and cosmetic
   rewards exactly once (see achievementLogic.js for the full design
   rationale and transaction/idempotency argument). Call this FIRST —
   see syncAchievementCosmetics below for how the two relate.
   ========================================================================== */

exports.syncAchievements = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to sync your achievements.");
  }

  return syncAchievementsCore(db, {
    uid: request.auth.uid,
    now: Timestamp.now(),
    FieldValue
  });
});

/* ==========================================================================
   syncAchievementCosmetics — Step 6.
   ------------------------------------------------------------------
   A NARROWER, DIFFERENT repair than syncAchievements above:

     syncAchievements:         historical progression -> missing
                                achievements (+ Domiia reward + cosmetics,
                                all granted together)
     syncAchievementCosmetics: existing achievement docs -> missing
                                COSMETIC ownership only (e.g. a cosmetic
                                mapping was added to an achievement AFTER
                                the user had already unlocked it, so
                                syncAchievements's own cosmetic-granting
                                never had a chance to run for that pair)

   Backfills cosmetic ownership for achievements the caller unlocked
   BEFORE Step 6 existed (or before a cosmetic mapping was added to an
   achievement). Idempotent, additive-only — never touches Domiia
   balance, lifetimeDomiias, achievementsUnlocked, or achievement docs
   themselves. Safe to call on every profile/customization page load,
   and safe/cheap to call right after syncAchievements (it will simply
   find nothing left to do in the common case, since syncAchievements
   already granted cosmetics for whatever it just reconciled).
   ========================================================================== */

exports.syncAchievementCosmetics = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to sync your rewards.");
  }

  return syncAchievementCosmeticsCore(db, {
    uid: request.auth.uid,
    now: Timestamp.now(),
    ACHIEVEMENTS
  });
});

/* ==========================================================================
   setLeaderboardOptIn — Step 7.
   ------------------------------------------------------------------
   The ONLY way users/{uid}.leaderboardOptIn can change — firestore.rules
   blocks it from direct client writes, same posture as every other
   backend-only progression field. One transaction flips the flag and
   creates/deletes the public leaderboard/{uid} mirror together (see
   leaderboardLogic.js), so the two can never disagree from this flow's
   own action. `enabled` is the only client input; the uid is always
   request.auth.uid, never request.data.
   ========================================================================== */

exports.setLeaderboardOptIn = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to change your leaderboard visibility.");
  }

  const enabled = (request.data || {}).enabled === true;

  return setLeaderboardOptInCore(db, {
    uid: request.auth.uid,
    enabled,
    now: Timestamp.now()
  });
});

/* ==========================================================================
   syncLeaderboardProfile — Step 7.
   ------------------------------------------------------------------
   Idempotent leaderboard mirror repair/backfill (spec sections 13, 38):
   reconciles leaderboard/{uid} to match the caller's CURRENT
   leaderboardOptIn/displayName/selectedAvatar/lifetimeDomiias — covers
   a stale/missing mirror doc (e.g. opted in before this flow existed, or
   a dropped network call after a rename) without re-running any reward
   logic. Never touches domiiaBalance, lifetimeDomiias, or any other
   users/{uid} progression field — read-only there, write-only on the
   public mirror. Safe to call once per sign-in/session and right after a
   client-side rename succeeds (see js/auth.js).
   ========================================================================== */

exports.syncLeaderboardProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to sync your leaderboard profile.");
  }

  return syncLeaderboardProfileCore(db, {
    uid: request.auth.uid,
    now: Timestamp.now()
  });
});
