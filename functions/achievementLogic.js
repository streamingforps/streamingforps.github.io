/*
  syncAchievements — historical achievement reconciliation.
  ------------------------------------------------------------------
  Root cause this exists to fix: achievement docs are ONLY ever created
  inside recordMissionActionCore's transaction, at the exact moment a
  mission newly completes. A user whose qualifying stats (missionsCompleted,
  daysCompleted, longestStreak) were reached BEFORE the achievement system
  existed — or whose qualifying moment simply isn't going to recur (they're
  not about to complete another "first" mission) — never gets that
  achievement doc created, because nothing ever re-triggers that code path
  for them. syncAchievementCosmetics (cosmeticLogic.js) does NOT fix this:
  it only backfills COSMETIC ownership for achievements that ALREADY HAVE
  a doc — it never creates a missing achievement doc itself.

  This function evaluates the user's CURRENT authoritative stats against
  functions/achievements.js's ACHIEVEMENTS (the exact same definitions and
  check() predicates recordMissionActionCore already uses — never
  duplicated/reimplemented here), creates any missing-but-qualifying
  achievement doc, awards its Domiia reward, grants its cosmeticRewards,
  and increments achievementsUnlocked — all inside ONE transaction, for
  the same reason missionLogic.js uses one: Firestore's optimistic
  concurrency (retry-on-read-conflict) is what makes this safe against two
  tabs calling it simultaneously, repeated calls, AND a race against
  recordMissionAction itself — whichever transaction's write actually
  commits first, the other retries, re-reads the now-existing achievement
  doc, and correctly contributes nothing a second time.

  Never touches missionsCompleted, daysCompleted, currentStreak,
  longestStreak, lastCompletedDay, dailyCompletions, missionProgress,
  actionHistory, streamingStats, uniqueActionsSupported,
  campaignMissionsCompleted, or campaignDailySetsCompleted — all of those
  are recordMissionActionCore's exclusive domain. This function only
  READS them (as the authoritative source of truth) and WRITES
  achievement docs, cosmetic ownership docs, and the 3 reward-related
  user fields (domiiaBalance, lifetimeDomiias, achievementsUnlocked).

  Step 10.5 ("expand the gamification system") note: the new counters
  (streamingStats, uniqueActionsSupported, campaign stats) are read here
  EXACTLY as they currently stand on the user doc — this function never
  tries to reconstruct what they "should" have been before these counters
  existed. A long-time user whose YouTube support predates Step 10.5
  simply starts those counters at 0, same as any other fresh counter —
  no fabricated historical count (spec sections 31, 52). Their
  missionsCompleted/daysCompleted/longestStreak/lifetimeDomiias-based
  achievements still reconcile normally, since those fields DO have
  reliable history.
*/

const { HttpsError } = require("firebase-functions/v2/https");
const { ACHIEVEMENTS, evaluateNewlyUnlocked } = require("./achievements");
const { syncLeaderboardIfOptedIn, incrementPeriodLeaderboards } = require("./leaderboardLogic");
const { getBangkokDateKey, getBangkokWeekKey, getBangkokMonthKey } = require("./dateUtil");
const { recordDomiiaEarning, achievementEarningId } = require("./ledgerLogic");

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function syncAchievementsCore(db, { uid, now, FieldValue }) {
  const userRef = db.collection("users").doc(uid);

  // Step 8: this reconciliation runs NOW — these are not backdated to
  // whenever the achievement was actually first qualified for (we don't
  // reliably know that, and the spec is explicit: never fabricate a
  // historical date). The Domiia is genuinely being credited to the
  // user's balance at this moment, so recording it against the CURRENT
  // week/month is correct, not a guess (spec section 29).
  const nowDate = now.toDate();
  const dateKey = getBangkokDateKey(nowDate);
  const weekKey = getBangkokWeekKey(nowDate);
  const monthKey = getBangkokMonthKey(nowDate);

  return db.runTransaction(async (tx) => {
    // ---- READS ----
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const userData = userSnap.data();

    // The CURRENT authoritative progression stats — same fields
    // recordMissionActionCore itself reads/writes, never recomputed or
    // guessed from historical records. streamingStats/uniqueActionsSupported/
    // campaign stats simply read whatever currently exists (see the file
    // header's Step 10.5 note) — 0 for any counter never populated yet.
    const streamingStatsRaw = userData.streamingStats || {};
    const statsRound1 = {
      missionsCompleted: safeNumber(userData.missionsCompleted),
      daysCompleted: safeNumber(userData.daysCompleted),
      currentStreak: safeNumber(userData.currentStreak),
      longestStreak: safeNumber(userData.longestStreak),
      lifetimeDomiias: safeNumber(userData.lifetimeDomiias),
      campaignMissionsCompleted: safeNumber(userData.campaignMissionsCompleted),
      campaignDailySetsCompleted: safeNumber(userData.campaignDailySetsCompleted),
      streamingStats: {
        totalActions: safeNumber(streamingStatsRaw.totalActions),
        youtubeActions: safeNumber(streamingStatsRaw.youtubeActions),
        spotifyActions: safeNumber(streamingStatsRaw.spotifyActions),
        tiktokActions: safeNumber(streamingStatsRaw.tiktokActions)
      },
      uniqueActionsSupported: safeNumber(userData.uniqueActionsSupported)
    };

    const achievementRefs = ACHIEVEMENTS.map((def) => userRef.collection("achievements").doc(def.id));
    const achievementSnaps = await Promise.all(achievementRefs.map((ref) => tx.get(ref)));
    const alreadyUnlockedIds = new Set();
    achievementSnaps.forEach((snap, i) => {
      if (snap.exists) alreadyUnlockedIds.add(ACHIEVEMENTS[i].id);
    });

    // Bounded 2-round evaluation — same semantics/rationale as
    // missionLogic.js's live path (see achievements.js's
    // evaluateNewlyUnlocked doc comment): round 1's OWN reconciled
    // rewards can themselves cross a Domiia threshold not yet reconciled.
    let qualifying = evaluateNewlyUnlocked(statsRound1, alreadyUnlockedIds);
    let round1Reward = qualifying.reduce((sum, def) => sum + def.rewardDomiias, 0);
    if (round1Reward > 0) {
      const round1Ids = new Set(qualifying.map((def) => def.id));
      const statsRound2 = { ...statsRound1, lifetimeDomiias: statsRound1.lifetimeDomiias + round1Reward };
      const round2 = evaluateNewlyUnlocked(statsRound2, alreadyUnlockedIds, round1Ids);
      qualifying = qualifying.concat(round2);
    }

    // Cosmetic grants for any newly-qualifying achievement's
    // cosmeticRewards — reads only, same pattern as missionLogic.js's
    // inline achievement-unlock block (definition + existing ownership,
    // both read before any write below).
    const cosmeticGrantCandidates = [];
    qualifying.forEach((def) => {
      (def.cosmeticRewards || []).forEach((cosmeticId) => {
        cosmeticGrantCandidates.push({ cosmeticId, achievementId: def.id });
      });
    });
    const cosmeticDefSnaps = cosmeticGrantCandidates.length
      ? await Promise.all(cosmeticGrantCandidates.map((g) => tx.get(db.collection("cosmetics").doc(g.cosmeticId))))
      : [];
    const cosmeticOwnershipSnaps = cosmeticGrantCandidates.length
      ? await Promise.all(cosmeticGrantCandidates.map((g) => tx.get(userRef.collection("cosmetics").doc(g.cosmeticId))))
      : [];

    if (!qualifying.length) {
      // Nothing to backfill — zero-write transaction, trivially commits.
      return { ok: true, achievementsUnlocked: [] };
    }

    // ---- WRITES (strictly after every read above) ----
    let totalDomiias = 0;
    qualifying.forEach((def) => {
      totalDomiias += def.rewardDomiias;
      tx.set(userRef.collection("achievements").doc(def.id), {
        achievementId: def.id,
        title: def.title,
        unlockedAt: now,
        rewardDomiias: def.rewardDomiias,
        rewardAwarded: true
      });
      // Step 8 — SAME earningId missionLogic.js's live path would use for
      // this achievement (see ledgerLogic.js's achievementEarningId). This
      // achievement only ever reaches `qualifying` here because its doc
      // does NOT already exist (the `alreadyUnlocked` filter above), which
      // is exactly what guarantees the live path hasn't already written
      // this same ledger row — so this can never double-log it.
      if (def.rewardDomiias > 0) {
        recordDomiiaEarning(db, {
          tx,
          uid,
          earningId: achievementEarningId(def.id),
          amount: def.rewardDomiias,
          sourceType: "achievement",
          sourceId: def.id,
          achievementId: def.id,
          dateKey,
          weekKey,
          monthKey,
          now
        });
      }
    });

    const grantedCosmeticsByAchievement = {}; // achievementId -> [{cosmeticId, title}]
    cosmeticGrantCandidates.forEach((grant, i) => {
      const defSnap = cosmeticDefSnaps[i];
      const ownershipSnap = cosmeticOwnershipSnaps[i];
      if (!defSnap || !defSnap.exists) return; // definition not created yet — skip gracefully
      if (ownershipSnap && ownershipSnap.exists) return; // already owned — idempotent skip

      const cosmetic = defSnap.data();
      tx.set(userRef.collection("cosmetics").doc(grant.cosmeticId), {
        cosmeticId: grant.cosmeticId,
        type: cosmetic.type,
        unlockedAt: now,
        sourceType: "achievement",
        sourceId: grant.achievementId
      });
      if (!grantedCosmeticsByAchievement[grant.achievementId]) grantedCosmeticsByAchievement[grant.achievementId] = [];
      grantedCosmeticsByAchievement[grant.achievementId].push({
        cosmeticId: grant.cosmeticId,
        title: cosmetic.title || grant.cosmeticId
      });
    });

    // Exactly one combined update — the increments below total correctly
    // across every achievement reconciled in this single call, same
    // "fold it all into one write" convention missionLogic.js uses.
    tx.update(userRef, {
      domiiaBalance: FieldValue.increment(totalDomiias),
      lifetimeDomiias: FieldValue.increment(totalDomiias),
      achievementsUnlocked: FieldValue.increment(qualifying.length),
      updatedAt: now
    });

    // Step 7: keep the public leaderboard mirror in sync — no-ops if the
    // user isn't opted in. userData is still the PRE-update snapshot, so
    // the new lifetimeDomiias is computed explicitly here.
    syncLeaderboardIfOptedIn(db, {
      tx,
      uid,
      leaderboardOptIn: userData.leaderboardOptIn === true,
      displayName: userData.displayName,
      avatarPath: userData.selectedAvatar,
      lifetimeDomiias: safeNumber(userData.lifetimeDomiias) + totalDomiias,
      now
    });

    // Step 8: one combined weekly/monthly increment for every achievement
    // reconciled in this single call — same "fold it all into one write"
    // convention as the domiiaBalance/lifetimeDomiias update above.
    incrementPeriodLeaderboards(db, {
      tx,
      uid,
      leaderboardOptIn: userData.leaderboardOptIn === true,
      displayName: userData.displayName,
      avatarPath: userData.selectedAvatar,
      weekKey,
      monthKey,
      scoreIncrement: totalDomiias,
      now,
      FieldValue
    });

    return {
      ok: true,
      achievementsUnlocked: qualifying.map((def) => ({
        id: def.id,
        title: def.title,
        rewardDomiias: def.rewardDomiias,
        cosmeticRewards: grantedCosmeticsByAchievement[def.id] || []
      }))
    };
  });
}

module.exports = { syncAchievementsCore };
