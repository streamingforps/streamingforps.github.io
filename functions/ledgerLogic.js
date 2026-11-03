/*
  Trusted Domiia earning ledger — Step 8.
  ------------------------------------------------------------------
  users/{uid}/domiiaEarnings/{earningId} is a private, backend-write-only
  record of every individual Domiia award: mission rewards, the daily
  completion bonus, and achievement rewards (both the live path in
  missionLogic.js and the retroactive reconciliation path in
  achievementLogic.js). It exists so weekly/monthly leaderboard scores can
  be computed from Domiias actually EARNED during a period — never
  inferred from lifetimeDomiias, which has no concept of "when".

  earningId is ALWAYS a deterministic string derived from the reward
  event itself (missionId+dateKey / dateKey / achievementId) — never a
  random/auto-generated ID — specifically so a transaction retry, or a
  second code path reconciling the same real-world event (achievementLogic
  .js's syncAchievements can award the SAME achievement missionLogic.js's
  live path might already have awarded), can never create two ledger rows
  for one actual earning event.

  In practice, every call site below only ever reaches recordDomiiaEarning
  from inside a branch that is ITSELF already gated by a matching
  Firestore existence check (missionProgress.completed, the
  dailyCompletions doc's own existence, the achievement doc's own
  existence — see missionLogic.js and achievementLogic.js) — so the
  deterministic ID here is defense-in-depth on top of an already
  exactly-once code path, not the only thing standing between here and a
  duplicate. That's also exactly why recordDomiiaEarning never reads its
  own document first: the content it would write is always identical
  across any retry, so a blind tx.set() is both simpler and correct.

  Never created for: cosmetic equips, leaderboard opt-in/out, profile
  renames — anything that isn't an actual Domiia award (spec section 5).
*/

function missionEarningId(missionId, dateKey) {
  return `mission_${missionId}_${dateKey}`;
}

// Step 10: the single global daily set split into an independent GENERAL
// set and one set PER CAMPAIGN (spec section 11) — each gets its own
// completion bonus and must never collapse into one ledger event (spec
// section 20).
function generalDailyCompletionEarningId(dateKey) {
  return `daily_general_${dateKey}`;
}

function campaignDailyCompletionEarningId(campaignId, dateKey) {
  return `daily_campaign_${campaignId}_${dateKey}`;
}

// Deliberately the SAME id regardless of whether this is being awarded by
// the live mission-completion path or achievementLogic.js's retroactive
// syncAchievements — see the file header. Never suffixed with "retro" or
// a dateKey: doing so would let reconciliation double-log an achievement
// already rewarded live (Step 8 spec section 4).
function achievementEarningId(achievementId) {
  return `achievement_${achievementId}`;
}

function buildEarningRecord({ amount, sourceType, sourceId, campaignId, missionId, achievementId, dateKey, weekKey, monthKey, now }) {
  return {
    amount,
    sourceType,
    sourceId,
    campaignId: campaignId || null,
    missionId: missionId || null,
    achievementId: achievementId || null,
    dateKey,
    weekKey,
    monthKey,
    earnedAt: now
  };
}

// tx: optional Firestore Transaction. A full overwrite (set(), not
// update()) is correct and safe here with no prior read — see the file
// header for why a retry/duplicate call always produces identical
// content for the same deterministic earningId.
function recordDomiiaEarning(db, { tx, uid, earningId, amount, sourceType, sourceId, campaignId, missionId, achievementId, dateKey, weekKey, monthKey, now }) {
  const ref = db.collection("users").doc(uid).collection("domiiaEarnings").doc(earningId);
  const record = buildEarningRecord({ amount, sourceType, sourceId, campaignId, missionId, achievementId, dateKey, weekKey, monthKey, now });
  if (tx) {
    tx.set(ref, record);
    return undefined;
  }
  return ref.set(record);
}

module.exports = {
  missionEarningId,
  generalDailyCompletionEarningId,
  campaignDailyCompletionEarningId,
  achievementEarningId,
  buildEarningRecord,
  recordDomiiaEarning
};
