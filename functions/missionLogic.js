/*
  Core recordMissionAction business logic — separated from the callable
  wrapper (index.js) so it can be exercised directly against a real
  (emulated) Firestore instance in tests, without needing the Functions
  emulator or an Auth emulator just to verify the transaction semantics.
  index.js is the only thing that should actually be deployed/triggered;
  this file is plain, framework-agnostic logic.

  ==========================================================================
  ACTION vs MISSION vs DAILY SET (read this before touching anything below)
  ==========================================================================
  ACTION = what the fan actually did (e.g. "opened the official Heartbound
           YouTube link"). Identified by actionId. One underlying event.
  MISSION = a goal that SUBSCRIBES to an action (e.g. "stream it 3 times",
            "stream it 10 times"). Identified by missionId. Many missions
            may subscribe to the same actionId (tiered missions, Step 9).
  DAILY SET (Step 10) = a GROUP of missions whose completion is tracked
            together and rewarded with its own one-time bonus — exactly
            one GENERAL set, plus one set PER CAMPAIGN. Only missions
            flagged requiredForDailySet (Step 10.5, see below) count
            toward whether a set is complete.

  Step 10.5 ("expand the gamification system") added:
    - requiredForDailySet: a mission can now be part of a daily set's
      MISSION LIST (trackable, rewards individually, counts toward
      lifetime missionsCompleted) WITHOUT being required for that set's
      completion bonus/streak. Defaults to true when absent (spec section
      10 — existing missions must not silently stop counting).
    - platform + streamingStats/uniqueActionsSupported/supportedActions:
      trusted, backend-only aggregate counters so achievements can measure
      "how much have you supported us on YouTube/Spotify" etc. without
      ever scanning actionHistory. Incremented ONCE per ACCEPTED action
      (never per mission it advances, never on a cooldown/daily-limit
      rejection — spec sections 22, 28-29), exactly the same "action vs
      mission" discipline Step 9 already established for actionHistory.
    - campaignMissionsCompleted / campaignDailySetsCompleted: lifetime
      counters for Category 4 achievements, incremented alongside the
      existing missionsCompleted/daysCompleted logic.

  One accepted action -> exactly ONE actionHistory increment and ONE set
  of stat increments, but potentially MANY missionProgress updates and
  MANY independent mission rewards, spanning MULTIPLE daily sets. The
  action-level gates (cooldown, max count per day) are evaluated ONCE,
  against the shared actionHistory doc — never per mission.

  Achievement evaluation (and the stats it reads) now happens on EVERY
  accepted action, not only ones that complete a mission — streaming/
  unique-action achievements can unlock from a single non-completing
  click (e.g. a user's first-ever click on a brand new song is their
  10th tracked YouTube action). See evaluateNewlyUnlocked's own doc
  comment (functions/achievements.js) for the bounded 2-round Domiia-
  threshold chaining this implies.

  Everything here is still evaluated and written INSIDE the SAME
  transaction as the action itself, never split across transactions —
  Firestore's optimistic-concurrency retry is what keeps the whole
  cascade exactly-once under concurrent/retried calls.
*/

const { HttpsError } = require("firebase-functions/v2/https");
const { getBangkokDateKey, getPreviousBangkokDateKey, getBangkokWeekKey, getBangkokMonthKey } = require("./dateUtil");
const { GENERAL_DAILY_COMPLETION_BONUS_FALLBACK, CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK } = require("./config");
const { ACHIEVEMENTS, evaluateNewlyUnlocked } = require("./achievements");
const { syncLeaderboardIfOptedIn, incrementPeriodLeaderboards } = require("./leaderboardLogic");
const {
  recordDomiiaEarning,
  missionEarningId,
  generalDailyCompletionEarningId,
  campaignDailyCompletionEarningId,
  achievementEarningId
} = require("./ledgerLogic");

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/*
  effectiveScope(missionData) / groupKeyFor(missionData)
  ------------------------------------------------------------------
  Step 10's core model: every mission belongs to exactly one DAILY SET —
  "general" or a specific campaign's set. missionScope is the explicit
  field going forward, but existing missions authored before Step 10
  never had it (spec section 2) — rather than a destructive migration,
  effectiveScope falls back to inferring scope from campaignId, exactly
  as the spec's own preferred fallback describes.
*/
function effectiveScope(missionData) {
  if (missionData.missionScope === "campaign" || missionData.missionScope === "general") {
    return missionData.missionScope;
  }
  return missionData.campaignId ? "campaign" : "general";
}

function groupKeyFor(missionData) {
  return effectiveScope(missionData) === "campaign" ? `campaign:${missionData.campaignId}` : "general";
}

// Step 10.5: a mission is always TRACKABLE (progress/reward/achievement-
// eligible) if it's otherwise eligible — this predicate only controls
// whether it's counted toward its daily SET's required total/completion.
// Absent (pre-Step-10.5) or explicitly `true` -> required, exactly
// preserving today's behavior for every existing mission (spec section
// 10's explicit backward-compatibility requirement). Only an EXPLICIT
// `false` makes a mission optional.
function isRequiredForDailySet(missionData) {
  return missionData.requiredForDailySet !== false;
}

// Trusted platform tag for streaming-stat counters (spec section 27).
// Explicit `platform` field wins when present (set explicitly by the
// Step 10.5 mission generator); otherwise inferred from destinationUrl as
// a fallback for missions authored before this field existed. Only the
// 3 platforms streamingStats actually tracks a dedicated counter for
// (spec section 22's exact suggested shape) resolve to a non-null value
// here — everything else still counts toward streamingStats.totalActions
// via the caller, just not a platform-specific counter.
const PLATFORM_COUNTER_FIELDS = ["youtube", "spotify", "tiktok"];
function inferPlatformFromUrl(url) {
  if (typeof url !== "string") return null;
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("spotify.com")) return "spotify";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "x";
  if (lower.includes("facebook.com")) return "facebook";
  return null;
}
function resolvePlatform(missionData) {
  if (typeof missionData.platform === "string" && missionData.platform) return missionData.platform;
  return inferPlatformFromUrl(missionData.destinationUrl);
}

// site/gamification.generalDailyCompletionBonus is the single source of
// truth for the GENERAL set's bonus. Read ONCE per function invocation,
// outside the transaction, so a transaction retry never re-reads it.
async function getGeneralDailyBonus(db) {
  try {
    const snap = await db.collection("site").doc("gamification").get();
    const raw = snap.exists ? snap.data().generalDailyCompletionBonus : undefined;
    if (Number.isInteger(raw) && raw >= 0) return raw;
    console.warn(
      `[missionLogic] site/gamification.generalDailyCompletionBonus is missing or invalid (${JSON.stringify(raw)}) — using fallback ${GENERAL_DAILY_COMPLETION_BONUS_FALLBACK}`
    );
    return GENERAL_DAILY_COMPLETION_BONUS_FALLBACK;
  } catch (error) {
    console.warn("[missionLogic] could not read site/gamification — using fallback", error);
    return GENERAL_DAILY_COMPLETION_BONUS_FALLBACK;
  }
}

// campaigns/{campaignId}.dailyMissionBonus — read from the CAMPAIGN'S OWN
// document (spec section 15). A MISSING field is normal (means 0, never
// silently reuses the general bonus); only an actually-invalid value
// logs a warning. Also returns the campaign's title for toast copy.
async function getCampaignDailyInfo(db, campaignId) {
  try {
    const snap = await db.collection("campaigns").doc(campaignId).get();
    const data = snap.exists ? snap.data() : {};
    const raw = data.dailyMissionBonus;
    const title = typeof data.title === "string" && data.title ? data.title : campaignId;
    if (raw === undefined || raw === null) return { bonus: CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK, title };
    if (Number.isInteger(raw) && raw >= 0) return { bonus: raw, title };
    console.warn(
      `[missionLogic] campaigns/${campaignId}.dailyMissionBonus is invalid (${JSON.stringify(raw)}) — using fallback ${CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK}`
    );
    return { bonus: CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK, title };
  } catch (error) {
    console.warn(`[missionLogic] could not read campaigns/${campaignId} — using fallback`, error);
    return { bonus: CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK, title: campaignId };
  }
}

// True if this mission counts toward "today's required set" evaluated AT
// `now` — active, daily frequency, and currently within its startsAt/
// endsAt window. Recomputed fresh on every call, never cached.
function isRequiredDailyMission(mission, nowDate) {
  if (!mission.active || mission.frequency !== "daily") return false;
  if (mission.startsAt && mission.startsAt.toDate() > nowDate) return false;
  if (mission.endsAt && mission.endsAt.toDate() < nowDate) return false;
  return true;
}

function hasValidMissionConfig(mission) {
  const target = Number(mission.target);
  const rewardDomiias = Number(mission.rewardDomiias);
  return Number.isFinite(target) && target > 0 && Number.isFinite(rewardDomiias) && rewardDomiias >= 0;
}

/*
  deriveActionConfig(eligibleMissions)
  ------------------------------------------------------------------
  cooldownSeconds/maxCountPerDay/platform are ACTION-level concepts (spec
  sections 12-14 from Step 9, section 27 from Step 10.5) — deterministically
  taken from the first mission (sorted by missionId) sharing this actionId,
  stable across calls/retries regardless of Firestore's query result
  ordering. js/admin.js's validation keeps these consistent across every
  active mission sharing an actionId; this stays defensive rather than
  trusting that blindly.
*/
function deriveActionConfig(eligibleMissions) {
  const sorted = eligibleMissions.slice().sort((a, b) => a.id.localeCompare(b.id));
  const primary = sorted[0].data;

  const cooldownSeconds = Number.isFinite(Number(primary.cooldownSeconds)) ? Number(primary.cooldownSeconds) : 0;

  const largestTarget = Math.max(...eligibleMissions.map((m) => Number(m.data.target) || 0));
  const maxCountPerDay = Number.isFinite(Number(primary.maxCountPerDay)) && Number(primary.maxCountPerDay) > 0
    ? Number(primary.maxCountPerDay)
    : largestTarget;

  const platform = resolvePlatform(primary);

  return { cooldownSeconds, maxCountPerDay, platform };
}

function missionResultEntry(id, data, progress, target, completed, newlyCompleted, rewardDomiias) {
  return { missionId: id, progress, target, completed, newlyCompleted, rewardDomiias };
}

function reportedTargetFor(missionState) {
  if (missionState.alreadyCompleted && missionState.progressData) {
    return Number(missionState.progressData.target) || missionState.target;
  }
  return missionState.target;
}

async function recordMissionActionCore(db, { uid, actionId, now, Timestamp, FieldValue }) {
  const missionsSnap = await db
    .collection("missions")
    .where("actionId", "==", actionId)
    .where("active", "==", true)
    .get();

  if (missionsSnap.empty) {
    return { counted: false, reason: "no-mission", actionId, missions: [] };
  }

  const nowDate = now.toDate();
  const allMatches = missionsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  const scheduleEligible = allMatches.filter((m) => isRequiredDailyMission(m.data, nowDate));
  if (!scheduleEligible.length) {
    return { counted: false, reason: "not-eligible", actionId, missions: [] };
  }

  const eligibleMissions = scheduleEligible.filter((m) => hasValidMissionConfig(m.data));
  if (!eligibleMissions.length) {
    return { counted: false, reason: "invalid-mission", actionId, missions: [] };
  }

  const dateKey = getBangkokDateKey(nowDate);
  const weekKey = getBangkokWeekKey(nowDate);
  const monthKey = getBangkokMonthKey(nowDate);
  const actionKey = `${actionId}_${dateKey}`;

  const userRef = db.collection("users").doc(uid);
  const actionRef = userRef.collection("actionHistory").doc(actionKey);

  const generalDailyBonus = await getGeneralDailyBonus(db);
  const distinctCampaignIds = Array.from(new Set(
    eligibleMissions
      .filter((m) => effectiveScope(m.data) === "campaign" && m.data.campaignId)
      .map((m) => m.data.campaignId)
  ));
  const campaignInfoEntries = await Promise.all(
    distinctCampaignIds.map(async (campaignId) => [campaignId, await getCampaignDailyInfo(db, campaignId)])
  );
  const campaignInfoById = new Map(campaignInfoEntries);

  return db.runTransaction(async (tx) => {
    // ======================================================================
    // READS
    // ======================================================================
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const actionSnap = await tx.get(actionRef);

    // Step 10.5: read ONCE per actionId ever — this is what makes the
    // "unique actions supported" counter trusted and exactly-once (spec
    // sections 26, 49). Read here (read phase) even though we don't yet
    // know if the action will be accepted — the early-return paths below
    // (already-completed/daily-limit/cooldown) simply never use it, which
    // is legal (Firestore only requires reads before writes, not that
    // every read gets used).
    const supportedActionRef = userRef.collection("supportedActions").doc(actionId);
    const supportedActionSnap = await tx.get(supportedActionRef);

    const progressRefs = eligibleMissions.map((m) => ({
      ...m,
      ref: userRef.collection("missionProgress").doc(`${m.id}_${dateKey}`)
    }));
    const progressSnaps = await Promise.all(progressRefs.map((m) => tx.get(m.ref)));

    const missionStates = progressRefs.map((m, i) => {
      const snap = progressSnaps[i];
      const data = snap.exists ? snap.data() : null;
      const currentProgress = data ? Number(data.progress) || 0 : 0;
      const target = Number(m.data.target);
      const alreadyCompleted = !!(data && data.completed) || currentProgress >= target;
      return { ...m, progressData: data, currentProgress, target, alreadyCompleted };
    });

    const notYetComplete = missionStates.filter((m) => !m.alreadyCompleted);

    if (!notYetComplete.length) {
      return {
        counted: false,
        reason: "already-completed",
        actionId,
        missions: missionStates.map((m) =>
          missionResultEntry(m.id, m.data, m.currentProgress, reportedTargetFor(m), true, false, 0)
        )
      };
    }

    // ---- Action-level gate (cooldown / max count per day) ----
    const { cooldownSeconds, maxCountPerDay, platform } = deriveActionConfig(eligibleMissions);
    const actionData = actionSnap.exists ? actionSnap.data() : null;
    const actionCount = actionData ? Number(actionData.count) || 0 : 0;
    const lastCountedAt = actionData && actionData.lastCountedAt ? actionData.lastCountedAt.toDate() : null;

    if (actionCount >= maxCountPerDay) {
      return {
        counted: false,
        reason: "daily-limit",
        actionId,
        missions: missionStates.map((m) =>
          missionResultEntry(m.id, m.data, m.currentProgress, reportedTargetFor(m), m.alreadyCompleted, false, 0)
        )
      };
    }

    if (lastCountedAt && cooldownSeconds > 0) {
      const elapsedSeconds = (nowDate.getTime() - lastCountedAt.getTime()) / 1000;
      if (elapsedSeconds < cooldownSeconds) {
        return {
          counted: false,
          reason: "cooldown",
          retryAfterSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
          actionId,
          missions: missionStates.map((m) =>
            missionResultEntry(m.id, m.data, m.currentProgress, reportedTargetFor(m), m.alreadyCompleted, false, 0)
          )
        };
      }
    }

    // ======================================================================
    // This action is ACCEPTED from here on — spec sections 22, 28-29:
    // streaming/unique-action stats increment EXACTLY ONCE per accepted
    // action, regardless of how many missions it advances or completes.
    // ======================================================================
    const newActionCount = actionCount + 1;
    notYetComplete.forEach((m) => {
      m.newProgress = Math.min(m.currentProgress + 1, m.target);
      m.willComplete = m.newProgress >= m.target;
    });
    const newlyCompletedMissions = notYetComplete.filter((m) => m.willComplete);

    const userData = userSnap.data();
    const priorMissionsCompleted = safeNumber(userData.missionsCompleted);
    const priorDaysCompleted = safeNumber(userData.daysCompleted);
    const priorCurrentStreak = safeNumber(userData.currentStreak);
    const priorLongestStreak = safeNumber(userData.longestStreak);
    const priorLastCompletedDay = userData.lastCompletedDay || null;
    const priorLifetimeDomiias = safeNumber(userData.lifetimeDomiias);
    const priorCampaignMissionsCompleted = safeNumber(userData.campaignMissionsCompleted);
    const priorCampaignDailySetsCompleted = safeNumber(userData.campaignDailySetsCompleted);
    const priorUniqueActionsSupported = safeNumber(userData.uniqueActionsSupported);
    const priorStreamingStats = userData.streamingStats || {};
    const priorTotalActions = safeNumber(priorStreamingStats.totalActions);
    const priorPlatformActions = {
      youtube: safeNumber(priorStreamingStats.youtubeActions),
      spotify: safeNumber(priorStreamingStats.spotifyActions),
      tiktok: safeNumber(priorStreamingStats.tiktokActions)
    };

    // Post-action stat values — plain JS numbers (NOT FieldValue
    // sentinels) so achievement check() predicates can read them directly.
    const isNewUniqueAction = !supportedActionSnap.exists;
    const newUniqueActionsSupported = priorUniqueActionsSupported + (isNewUniqueAction ? 1 : 0);
    const newTotalActions = priorTotalActions + 1;
    const newPlatformActions = { ...priorPlatformActions };
    if (PLATFORM_COUNTER_FIELDS.includes(platform)) {
      newPlatformActions[platform] = priorPlatformActions[platform] + 1;
    }

    let newCurrentStreak = priorCurrentStreak;
    let newLongestStreak = priorLongestStreak;
    let newDaysCompleted = priorDaysCompleted;
    const newMissionsCompleted = priorMissionsCompleted + newlyCompletedMissions.length;
    const newCampaignMissionsCompleted = priorCampaignMissionsCompleted
      + newlyCompletedMissions.filter((m) => effectiveScope(m.data) === "campaign").length;

    const newlyCompletedSets = []; // [{ group, isGeneral, campaignId, campaignTitle, completionRef, requiredCount, bonusDomiias }]
    const eligibleIdsThisCall = new Set(eligibleMissions.map((m) => m.id));

    if (newlyCompletedMissions.length) {
      const groupsToCheck = Array.from(new Set(newlyCompletedMissions.map((m) => groupKeyFor(m.data))));

      // Required set = every active, daily, in-window, requiredForDailySet
      // mission AS OF RIGHT NOW (spec sections 27-28 Step 9, section 10
      // Step 10.5) — optional missions never block or count toward a
      // set's completion, regardless of how many exist.
      const requiredMissionsSnap = await tx.get(
        db.collection("missions").where("active", "==", true).where("frequency", "==", "daily")
      );
      const requiredByGroup = new Map();
      requiredMissionsSnap.docs.forEach((d) => {
        const data = d.data();
        if (!isRequiredDailyMission(data, nowDate)) return;
        if (!isRequiredForDailySet(data)) return;
        const group = groupKeyFor(data);
        if (!requiredByGroup.has(group)) requiredByGroup.set(group, []);
        requiredByGroup.get(group).push({ id: d.id, data });
      });

      for (const group of groupsToCheck) {
        // Only THIS CALL's REQUIRED-for-daily-set missions in this group
        // matter for completion — an optional mission completing (even
        // one sharing an actionId with a required one) can never be what
        // satisfies or blocks a set (spec sections 6-11, Step 10.5).
        const groupStatesThisCall = missionStates.filter(
          (m) => groupKeyFor(m.data) === group && isRequiredForDailySet(m.data)
        );
        if (!groupStatesThisCall.length) continue; // this call only touched optional missions in this group
        const allInCallComplete = groupStatesThisCall.every((m) => m.alreadyCompleted || m.willComplete);
        if (!allInCallComplete) continue;

        const groupRequired = requiredByGroup.get(group) || [];
        if (!groupRequired.length) continue; // zero required missions -> never auto-completes

        const externalIds = groupRequired.filter((m) => !eligibleIdsThisCall.has(m.id)).map((m) => m.id);
        const externalSnaps = await Promise.all(
          externalIds.map((id) => tx.get(userRef.collection("missionProgress").doc(`${id}_${dateKey}`)))
        );
        const allExternalComplete = externalSnaps.every((s) => s.exists && s.data().completed === true);
        if (!allExternalComplete) continue;

        const isGeneral = group === "general";
        const campaignId = isGeneral ? null : group.slice("campaign:".length);
        const completionKey = isGeneral ? `general_${dateKey}` : `campaign_${campaignId}_${dateKey}`;
        const completionRef = userRef.collection("dailyCompletions").doc(completionKey);
        const legacyRef = isGeneral ? userRef.collection("dailyCompletions").doc(dateKey) : null;

        const [completionSnap, legacySnap] = await Promise.all([
          tx.get(completionRef),
          legacyRef ? tx.get(legacyRef) : Promise.resolve(null)
        ]);
        if (completionSnap.exists || (legacySnap && legacySnap.exists)) continue;

        newlyCompletedSets.push({
          group,
          isGeneral,
          campaignId,
          campaignTitle: isGeneral ? null : (campaignInfoById.get(campaignId) || {}).title || campaignId,
          completionRef,
          requiredCount: groupRequired.length,
          bonusDomiias: isGeneral ? generalDailyBonus : (campaignInfoById.get(campaignId) || {}).bonus || 0
        });
      }

      const generalCompletion = newlyCompletedSets.find((s) => s.isGeneral);
      if (generalCompletion) {
        const yesterdayKey = getPreviousBangkokDateKey(nowDate);
        newCurrentStreak = priorLastCompletedDay === yesterdayKey ? priorCurrentStreak + 1 : 1;
        newLongestStreak = Math.max(priorLongestStreak, newCurrentStreak);
        newDaysCompleted = priorDaysCompleted + 1;
      }
    }

    const newCampaignDailySetsCompleted = priorCampaignDailySetsCompleted
      + newlyCompletedSets.filter((s) => !s.isGeneral).length;

    // Pure numeric totals, computed BEFORE any writes so the achievement
    // stats snapshot below can use the POST-reward lifetimeDomiias value
    // (spec section 51) — the actual ledger/progress writes for these
    // same amounts happen later, in the WRITE phase, unchanged.
    const missionDomiiaTotal = newlyCompletedMissions.reduce((sum, m) => sum + (Number(m.data.rewardDomiias) || 0), 0);
    const setBonusTotal = newlyCompletedSets.reduce((sum, s) => sum + s.bonusDomiias, 0);

    // ---- Achievement evaluation — runs on EVERY accepted action now,
    // not only ones that complete a mission (streaming/unique-action
    // achievements can unlock from a single non-completing click). ----
    const achievementRefs = ACHIEVEMENTS.map((def) => userRef.collection("achievements").doc(def.id));
    const achievementSnaps = await Promise.all(achievementRefs.map((ref) => tx.get(ref)));
    const alreadyUnlockedIds = new Set();
    achievementSnaps.forEach((snap, i) => {
      if (snap.exists) alreadyUnlockedIds.add(ACHIEVEMENTS[i].id);
    });

    const statsRound1 = {
      missionsCompleted: newMissionsCompleted,
      daysCompleted: newDaysCompleted,
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      lifetimeDomiias: priorLifetimeDomiias + missionDomiiaTotal + setBonusTotal,
      campaignMissionsCompleted: newCampaignMissionsCompleted,
      campaignDailySetsCompleted: newCampaignDailySetsCompleted,
      streamingStats: {
        totalActions: newTotalActions,
        youtubeActions: newPlatformActions.youtube,
        spotifyActions: newPlatformActions.spotify,
        tiktokActions: newPlatformActions.tiktok
      },
      uniqueActionsSupported: newUniqueActionsSupported
    };

    // Bounded 2-round evaluation (see achievements.js's evaluateNewlyUnlocked
    // doc comment) — round 2 only matters for Domiia-threshold achievements
    // that round 1's OWN reward total newly crosses; never a 3rd round.
    let newlyUnlockedAchievements = evaluateNewlyUnlocked(statsRound1, alreadyUnlockedIds);
    let achievementDomiiaTotal = newlyUnlockedAchievements.reduce((sum, def) => sum + def.rewardDomiias, 0);
    if (achievementDomiiaTotal > 0) {
      const round1Ids = new Set(newlyUnlockedAchievements.map((def) => def.id));
      const statsRound2 = { ...statsRound1, lifetimeDomiias: statsRound1.lifetimeDomiias + achievementDomiiaTotal };
      const round2 = evaluateNewlyUnlocked(statsRound2, alreadyUnlockedIds, round1Ids);
      newlyUnlockedAchievements = newlyUnlockedAchievements.concat(round2);
      achievementDomiiaTotal += round2.reduce((sum, def) => sum + def.rewardDomiias, 0);
    }

    const cosmeticGrantCandidates = [];
    newlyUnlockedAchievements.forEach((def) => {
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

    // ======================================================================
    // WRITES — strictly after every read above.
    // ======================================================================

    tx.set(actionRef, {
      actionId,
      dateKey,
      count: newActionCount,
      lastCountedAt: now,
      createdAt: actionData ? actionData.createdAt : now,
      updatedAt: now
    });

    // Step 10.5: the unique-action marker doc — created ONCE ever per
    // actionId, gated on the SAME existence read from Stage 1, so a
    // transaction retry can never double-create it or double-count the
    // unique-actions-supported increment.
    if (isNewUniqueAction) {
      tx.set(supportedActionRef, { actionId, firstSupportedAt: now });
    }

    notYetComplete.forEach((m) => {
      tx.set(m.ref, {
        missionId: m.id,
        dateKey,
        progress: m.newProgress,
        target: m.target,
        completed: m.willComplete,
        rewardClaimed: m.willComplete,
        lastActionAt: now,
        completedAt: m.willComplete ? now : null,
        createdAt: m.progressData ? m.progressData.createdAt : now,
        updatedAt: now
      });
    });

    const cosmeticsGrantedThisCall = [];
    if (newlyUnlockedAchievements.length) {
      newlyUnlockedAchievements.forEach((def) => {
        tx.set(userRef.collection("achievements").doc(def.id), {
          achievementId: def.id,
          title: def.title,
          unlockedAt: now,
          rewardDomiias: def.rewardDomiias,
          rewardAwarded: true
        });
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

      cosmeticGrantCandidates.forEach((grant, i) => {
        const defSnap = cosmeticDefSnaps[i];
        const ownershipSnap = cosmeticOwnershipSnaps[i];
        if (!defSnap || !defSnap.exists) return;
        if (ownershipSnap && ownershipSnap.exists) return;

        const cosmetic = defSnap.data();
        tx.set(userRef.collection("cosmetics").doc(grant.cosmeticId), {
          cosmeticId: grant.cosmeticId,
          type: cosmetic.type,
          unlockedAt: now,
          sourceType: "achievement",
          sourceId: grant.achievementId
        });
        cosmeticsGrantedThisCall.push({ cosmeticId: grant.cosmeticId, title: cosmetic.title || grant.cosmeticId });
      });
    }

    newlyCompletedSets.forEach((set) => {
      tx.set(set.completionRef, {
        dateKey,
        scope: set.isGeneral ? "general" : "campaign",
        campaignId: set.campaignId,
        completed: true,
        missionsRequired: set.requiredCount,
        missionsCompleted: set.requiredCount,
        baseBonusDomiias: set.bonusDomiias,
        bonusAwarded: true,
        streakAfterCompletion: set.isGeneral ? newCurrentStreak : null,
        completedAt: now,
        createdAt: now,
        updatedAt: now
      });
      if (set.bonusDomiias > 0) {
        recordDomiiaEarning(db, {
          tx,
          uid,
          earningId: set.isGeneral
            ? generalDailyCompletionEarningId(dateKey)
            : campaignDailyCompletionEarningId(set.campaignId, dateKey),
          amount: set.bonusDomiias,
          sourceType: set.isGeneral ? "daily_completion" : "campaign_daily_completion",
          sourceId: set.isGeneral ? "general" : set.campaignId,
          campaignId: set.campaignId,
          dateKey,
          weekKey,
          monthKey,
          now
        });
      }
    });

    newlyCompletedMissions.forEach((m) => {
      const rewardDomiias = Number(m.data.rewardDomiias) || 0;
      if (rewardDomiias > 0) {
        recordDomiiaEarning(db, {
          tx,
          uid,
          earningId: missionEarningId(m.id, dateKey),
          amount: rewardDomiias,
          sourceType: "mission",
          sourceId: m.id,
          missionId: m.id,
          campaignId: m.data.campaignId || null,
          dateKey,
          weekKey,
          monthKey,
          now
        });
      }
    });

    const totalDomiiaThisCall = missionDomiiaTotal + setBonusTotal + achievementDomiiaTotal;
    const generalNewlyCompleted = newlyCompletedSets.some((s) => s.isGeneral);

    // ONE user-doc update per call, covering BOTH the always-on streaming/
    // unique-action stats (every accepted action) and the completion-
    // specific fields (only when something actually completed).
    const userUpdates = {
      updatedAt: now,
      "streamingStats.totalActions": FieldValue.increment(1)
    };
    if (PLATFORM_COUNTER_FIELDS.includes(platform)) {
      userUpdates[`streamingStats.${platform}Actions`] = FieldValue.increment(1);
    }
    if (isNewUniqueAction) {
      userUpdates.uniqueActionsSupported = FieldValue.increment(1);
    }
    if (newlyCompletedMissions.length) {
      userUpdates.missionsCompleted = FieldValue.increment(newlyCompletedMissions.length);
      if (newlyCompletedMissions.some((m) => effectiveScope(m.data) === "campaign")) {
        userUpdates.campaignMissionsCompleted = FieldValue.increment(
          newlyCompletedMissions.filter((m) => effectiveScope(m.data) === "campaign").length
        );
      }
      if (generalNewlyCompleted) {
        userUpdates.currentStreak = newCurrentStreak;
        userUpdates.longestStreak = newLongestStreak;
        userUpdates.daysCompleted = FieldValue.increment(1);
        userUpdates.lastCompletedDay = dateKey;
      }
      if (newlyCompletedSets.some((s) => !s.isGeneral)) {
        userUpdates.campaignDailySetsCompleted = FieldValue.increment(
          newlyCompletedSets.filter((s) => !s.isGeneral).length
        );
      }
    }
    if (newlyUnlockedAchievements.length) {
      userUpdates.achievementsUnlocked = FieldValue.increment(newlyUnlockedAchievements.length);
    }
    if (totalDomiiaThisCall > 0) {
      userUpdates.domiiaBalance = FieldValue.increment(totalDomiiaThisCall);
      userUpdates.lifetimeDomiias = FieldValue.increment(totalDomiiaThisCall);
    }
    tx.update(userRef, userUpdates);

    if (totalDomiiaThisCall > 0) {
      syncLeaderboardIfOptedIn(db, {
        tx,
        uid,
        leaderboardOptIn: userData.leaderboardOptIn === true,
        displayName: userData.displayName,
        avatarPath: userData.selectedAvatar,
        lifetimeDomiias: priorLifetimeDomiias + totalDomiiaThisCall,
        now
      });

      incrementPeriodLeaderboards(db, {
        tx,
        uid,
        leaderboardOptIn: userData.leaderboardOptIn === true,
        displayName: userData.displayName,
        avatarPath: userData.selectedAvatar,
        weekKey,
        monthKey,
        scoreIncrement: totalDomiiaThisCall,
        now,
        FieldValue
      });
    }

    const priorBalance = Number(userSnap.data().domiiaBalance) || 0;

    return {
      counted: true,
      reason: newlyCompletedMissions.length ? "completed" : "counted",
      actionId,
      domiiaBalance: priorBalance + totalDomiiaThisCall,

      missions: missionStates.map((m) => {
        if (m.alreadyCompleted) {
          return missionResultEntry(m.id, m.data, m.currentProgress, reportedTargetFor(m), true, false, 0);
        }
        return missionResultEntry(
          m.id, m.data, m.newProgress, m.target, m.willComplete, m.willComplete,
          m.willComplete ? (Number(m.data.rewardDomiias) || 0) : 0
        );
      }),

      dailyCompletions: newlyCompletedSets.map((s) => ({
        scope: s.isGeneral ? "general" : "campaign",
        campaignId: s.campaignId,
        campaignTitle: s.campaignTitle,
        newlyCompleted: true,
        bonusDomiias: s.bonusDomiias
      })),

      streak: newCurrentStreak,

      achievementsUnlocked: newlyUnlockedAchievements.map((def) => ({
        id: def.id,
        title: def.title,
        rewardDomiias: def.rewardDomiias,
        cosmeticRewards: cosmeticsGrantedThisCall.filter((c) =>
          (def.cosmeticRewards || []).includes(c.cosmeticId)
        )
      }))
    };
  });
}

module.exports = {
  recordMissionActionCore,
  isRequiredDailyMission,
  isRequiredForDailySet,
  effectiveScope,
  groupKeyFor,
  inferPlatformFromUrl,
  resolvePlatform
};
