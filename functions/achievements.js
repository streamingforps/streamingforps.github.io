/*
  Achievement definitions — Step 5, expanded in Step 10.5 ("Expand the
  Gamification System").
  ------------------------------------------------------------------
  Centralized, static, code-defined (per spec — an achievements/{id}
  Firestore collection is the natural next step if these ever need admin
  editing, but isn't needed yet — see the file-end recommendation note).
  User UNLOCKS are still stored in Firestore (users/{uid}/achievements/
  {achievementId}) — this file only holds the read-only definitions used
  to evaluate and describe them.

  Each `check(stats)` predicate is pure and monotonic (a stat only ever
  goes up), so it's safe to re-evaluate on every mission completion
  without worrying about an achievement "flickering" unlocked then
  locked again. `stats` is the current/post-update snapshot, now much
  larger than Step 5's four fields:

    {
      missionsCompleted, daysCompleted, currentStreak, longestStreak,
      lifetimeDomiias,
      campaignMissionsCompleted, campaignDailySetsCompleted,
      streamingStats: { totalActions, youtubeActions, spotifyActions, tiktokActions },
      uniqueActionsSupported
    }

  Streak achievements deliberately check `longestStreak`, NOT
  `currentStreak` — see Step 5's original note (still true): these are
  one-time LIFETIME milestones, and currentStreak is volatile.

  Step 10 note: daysCompleted/currentStreak/longestStreak are now
  GENERAL-set-only (campaign completion never touches them) — these
  achievements are therefore implicitly "General Daily consistency"
  achievements, not "any daily set" achievements.

  cosmeticRewards: [cosmeticId, ...] — IDs only, referencing
  cosmetics/{cosmeticId} Firestore documents. An achievement with no
  cosmetic reward simply omits the field (Step 10.5 spec section 32:
  "do not make every achievement unlock a cosmetic" — most award Domiias
  only; a cosmetic is reserved for meaningful/major milestones so it
  stays a special moment rather than the default).

  ==========================================================================
  evaluateNewlyUnlocked — bounded 2-round Domiia-threshold chaining
  ==========================================================================
  A Domiia-lifetime-threshold achievement's OWN reward can itself push the
  user over a HIGHER Domiia threshold in the same call (e.g. crossing 95->
  100 unlocks "Domiia Collector" (+10), which alone would reach 110 — still
  short of the next tier, but in principle a large enough reward could
  cross one). The spec requires this to be ALLOWED (achievement rewards do
  count toward future thresholds) but BOUNDED (never an unlimited/
  recursive chain in one transaction).

  The chosen semantics: exactly TWO rounds, never more.
    Round 1: evaluate every achievement against the stats snapshot AFTER
             the primary reward (mission/daily-set/campaign-bonus) but
             BEFORE any achievement reward.
    Round 2: evaluate every achievement NOT already unlocked (by the user
             historically, or by round 1) against the stats snapshot
             AFTER round 1's own reward total is added. Round 2's own
             rewards are included in the final total but are NEVER
             re-evaluated against a third round.
  This is safe against runaway chains (hard cap of 2 passes, not "keep
  going until nothing new unlocks") while still correctly handling the
  case the spec calls out. Every call site (missionLogic.js's live path,
  achievementLogic.js's retroactive sync) uses this SAME function so the
  chaining semantics can never drift between the two.
*/

const ACHIEVEMENTS = [
  // ===== Category 1: Mission completion (missionsCompleted) =====
  {
    id: "first-mission",
    title: "First Steps",
    description: "Complete your first mission.",
    category: "missions",
    rewardDomiias: 5,
    check: (stats) => stats.missionsCompleted >= 1,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 1), target: 1 }),
    cosmeticRewards: ["first-steps-avatar"]
  },
  {
    id: "ten-missions",
    title: "Getting Started",
    description: "Complete 10 missions.",
    category: "missions",
    rewardDomiias: 10,
    check: (stats) => stats.missionsCompleted >= 10,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 10), target: 10 })
  },
  {
    id: "missions-25",
    title: "Supporter",
    description: "Complete 25 missions.",
    category: "missions",
    rewardDomiias: 15,
    check: (stats) => stats.missionsCompleted >= 25,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 25), target: 25 }),
    cosmeticRewards: ["mission-25-avatar"]
  },
  {
    id: "missions-50",
    title: "Dedicated Fan",
    description: "Complete 50 missions.",
    category: "missions",
    rewardDomiias: 20,
    check: (stats) => stats.missionsCompleted >= 50,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 50), target: 50 })
  },
  {
    id: "missions-100",
    title: "Super Supporter",
    description: "Complete 100 missions.",
    category: "missions",
    rewardDomiias: 30,
    check: (stats) => stats.missionsCompleted >= 100,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 100), target: 100 }),
    cosmeticRewards: ["mission-100-avatar"]
  },
  {
    id: "missions-250",
    title: "Mission Master",
    description: "Complete 250 missions.",
    category: "missions",
    rewardDomiias: 50,
    check: (stats) => stats.missionsCompleted >= 250,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 250), target: 250 }),
    cosmeticRewards: ["mission-250-background"]
  },
  {
    id: "missions-500",
    title: "Legendary Supporter",
    description: "Complete 500 missions.",
    category: "missions",
    rewardDomiias: 75,
    check: (stats) => stats.missionsCompleted >= 500,
    progress: (stats) => ({ current: Math.min(stats.missionsCompleted, 500), target: 500 })
  },

  // ===== Category 2: General Daily consistency (daysCompleted) =====
  {
    id: "first-perfect-day",
    title: "Perfect Day",
    description: "Complete all General Daily missions in one day.",
    category: "consistency",
    rewardDomiias: 10,
    check: (stats) => stats.daysCompleted >= 1,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 1), target: 1 }),
    cosmeticRewards: ["perfect-day-background"]
  },
  {
    id: "days-3",
    title: "Making It a Habit",
    description: "Complete the General Daily set 3 times (not necessarily in a row).",
    category: "consistency",
    rewardDomiias: 10,
    check: (stats) => stats.daysCompleted >= 3,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 3), target: 3 })
  },
  {
    id: "days-7",
    title: "Regular Supporter",
    description: "Complete the General Daily set 7 times.",
    category: "consistency",
    rewardDomiias: 15,
    check: (stats) => stats.daysCompleted >= 7,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 7), target: 7 })
  },
  {
    id: "days-14",
    title: "Two Weeks Strong",
    description: "Complete the General Daily set 14 times.",
    category: "consistency",
    rewardDomiias: 20,
    check: (stats) => stats.daysCompleted >= 14,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 14), target: 14 })
  },
  {
    id: "days-30",
    title: "Monthly Supporter",
    description: "Complete the General Daily set 30 times.",
    category: "consistency",
    rewardDomiias: 30,
    check: (stats) => stats.daysCompleted >= 30,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 30), target: 30 }),
    cosmeticRewards: ["midnight-blue-theme"]
  },
  {
    id: "days-60",
    title: "Dedicated Routine",
    description: "Complete the General Daily set 60 times.",
    category: "consistency",
    rewardDomiias: 40,
    check: (stats) => stats.daysCompleted >= 60,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 60), target: 60 })
  },
  {
    id: "days-100",
    title: "100 Perfect Days",
    description: "Complete the General Daily set 100 times.",
    category: "consistency",
    rewardDomiias: 60,
    check: (stats) => stats.daysCompleted >= 100,
    progress: (stats) => ({ current: Math.min(stats.daysCompleted, 100), target: 100 })
  },

  // ===== Category 3: Streaks (longestStreak, lifetime milestone) =====
  {
    id: "three-day-streak",
    title: "On a Roll",
    description: "Complete all General Daily missions 3 days in a row.",
    category: "streaks",
    rewardDomiias: 15,
    check: (stats) => stats.longestStreak >= 3,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 3), target: 3 }),
    cosmeticRewards: ["three-day-theme"]
  },
  {
    id: "seven-day-streak",
    title: "A Week Together",
    description: "Complete all General Daily missions 7 days in a row.",
    category: "streaks",
    rewardDomiias: 25,
    check: (stats) => stats.longestStreak >= 7,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 7), target: 7 }),
    cosmeticRewards: ["streak-7-avatar"]
  },
  {
    id: "streak-14",
    title: "Two Weeks Together",
    description: "Complete all General Daily missions 14 days in a row.",
    category: "streaks",
    rewardDomiias: 30,
    check: (stats) => stats.longestStreak >= 14,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 14), target: 14 }),
    cosmeticRewards: ["streak-14-background"]
  },
  {
    id: "streak-30",
    title: "Unstoppable",
    description: "Complete all General Daily missions 30 days in a row.",
    category: "streaks",
    rewardDomiias: 50,
    check: (stats) => stats.longestStreak >= 30,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 30), target: 30 }),
    cosmeticRewards: ["streak-30-avatar"]
  },
  {
    id: "streak-60",
    title: "Always Here",
    description: "Complete all General Daily missions 60 days in a row.",
    category: "streaks",
    rewardDomiias: 75,
    check: (stats) => stats.longestStreak >= 60,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 60), target: 60 }),
    cosmeticRewards: ["streak-60-background"]
  },
  {
    id: "streak-100",
    title: "100 Days Together",
    description: "Complete all General Daily missions 100 days in a row.",
    category: "streaks",
    rewardDomiias: 100,
    check: (stats) => stats.longestStreak >= 100,
    progress: (stats) => ({ current: Math.min(stats.longestStreak, 100), target: 100 }),
    cosmeticRewards: ["domiia-night-theme"]
  },

  // ===== Category 4: Campaign participation =====
  {
    id: "campaign-mission-1",
    title: "Campaign Supporter",
    description: "Complete 1 Campaign mission.",
    category: "campaigns",
    rewardDomiias: 5,
    check: (stats) => stats.campaignMissionsCompleted >= 1,
    progress: (stats) => ({ current: Math.min(stats.campaignMissionsCompleted, 1), target: 1 }),
    cosmeticRewards: ["campaign-supporter-avatar"]
  },
  {
    id: "campaign-mission-10",
    title: "Campaign Regular",
    description: "Complete 10 Campaign missions.",
    category: "campaigns",
    rewardDomiias: 15,
    check: (stats) => stats.campaignMissionsCompleted >= 10,
    progress: (stats) => ({ current: Math.min(stats.campaignMissionsCompleted, 10), target: 10 })
  },
  {
    id: "campaign-mission-50",
    title: "Campaign Champion",
    description: "Complete 50 Campaign missions.",
    category: "campaigns",
    rewardDomiias: 40,
    check: (stats) => stats.campaignMissionsCompleted >= 50,
    progress: (stats) => ({ current: Math.min(stats.campaignMissionsCompleted, 50), target: 50 })
  },
  {
    id: "campaign-dailyset-1",
    title: "All In",
    description: "Complete 1 Campaign daily set.",
    category: "campaigns",
    rewardDomiias: 10,
    check: (stats) => stats.campaignDailySetsCompleted >= 1,
    progress: (stats) => ({ current: Math.min(stats.campaignDailySetsCompleted, 1), target: 1 })
  },
  {
    id: "campaign-dailyset-10",
    title: "Campaign Veteran",
    description: "Complete 10 Campaign daily sets.",
    category: "campaigns",
    rewardDomiias: 25,
    check: (stats) => stats.campaignDailySetsCompleted >= 10,
    progress: (stats) => ({ current: Math.min(stats.campaignDailySetsCompleted, 10), target: 10 }),
    cosmeticRewards: ["campaign-10-background"]
  },
  {
    id: "campaign-dailyset-25",
    title: "Campaign Hero",
    description: "Complete 25 Campaign daily sets.",
    category: "campaigns",
    rewardDomiias: 50,
    check: (stats) => stats.campaignDailySetsCompleted >= 25,
    progress: (stats) => ({ current: Math.min(stats.campaignDailySetsCompleted, 25), target: 25 }),
    cosmeticRewards: ["heartbound-red-theme"]
  },

  // ===== Category 5: Domiias earned — LIFETIME, never current balance
  // (spending later must never remove an already-unlocked achievement) =====
  {
    id: "domiia-25",
    title: "First Domiias",
    description: "Earn 25 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 5,
    check: (stats) => stats.lifetimeDomiias >= 25,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 25), target: 25 })
  },
  {
    id: "domiia-100",
    title: "Domiia Collector",
    description: "Earn 100 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 10,
    check: (stats) => stats.lifetimeDomiias >= 100,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 100), target: 100 })
  },
  {
    id: "domiia-250",
    title: "Domiia Fan",
    description: "Earn 250 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 15,
    check: (stats) => stats.lifetimeDomiias >= 250,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 250), target: 250 })
  },
  {
    id: "domiia-500",
    title: "Domiia Hoarder",
    description: "Earn 500 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 25,
    check: (stats) => stats.lifetimeDomiias >= 500,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 500), target: 500 })
  },
  {
    id: "domiia-1000",
    title: "Domiia Treasure",
    description: "Earn 1,000 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 40,
    check: (stats) => stats.lifetimeDomiias >= 1000,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 1000), target: 1000 }),
    cosmeticRewards: ["domiia-1000-avatar"]
  },
  {
    id: "domiia-2500",
    title: "Domiia Legend",
    description: "Earn 2,500 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 60,
    check: (stats) => stats.lifetimeDomiias >= 2500,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 2500), target: 2500 }),
    cosmeticRewards: ["domiia-2500-background"]
  },
  {
    id: "domiia-5000",
    title: "Domiia Royalty",
    description: "Earn 5,000 lifetime Domiias.",
    category: "domiias",
    rewardDomiias: 100,
    check: (stats) => stats.lifetimeDomiias >= 5000,
    progress: (stats) => ({ current: Math.min(stats.lifetimeDomiias, 5000), target: 5000 }),
    cosmeticRewards: ["golden-supporter-theme"]
  },

  // ===== Category 6: Total tracked streaming actions
  // (streamingStats.totalActions — deliberately worded as TRACKED SUPPORT
  // ACTIONS, never "verified views/streams" — see category 7/8 notes) =====
  {
    id: "streaming-25",
    title: "Getting the Streams Going",
    description: "Complete 25 tracked streaming support actions.",
    category: "streaming",
    rewardDomiias: 10,
    check: (stats) => (stats.streamingStats.totalActions || 0) >= 25,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.totalActions || 0, 25), target: 25 })
  },
  {
    id: "streaming-100",
    title: "Streamer",
    description: "Complete 100 tracked streaming support actions.",
    category: "streaming",
    rewardDomiias: 20,
    check: (stats) => (stats.streamingStats.totalActions || 0) >= 100,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.totalActions || 0, 100), target: 100 })
  },
  {
    id: "streaming-250",
    title: "Power Streamer",
    description: "Complete 250 tracked streaming support actions.",
    category: "streaming",
    rewardDomiias: 35,
    check: (stats) => (stats.streamingStats.totalActions || 0) >= 250,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.totalActions || 0, 250), target: 250 })
  },
  {
    id: "streaming-500",
    title: "Streaming Machine",
    description: "Complete 500 tracked streaming support actions.",
    category: "streaming",
    rewardDomiias: 50,
    check: (stats) => (stats.streamingStats.totalActions || 0) >= 500,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.totalActions || 0, 500), target: 500 }),
    cosmeticRewards: ["streaming-500-background"]
  },
  {
    id: "streaming-1000",
    title: "Streaming Legend",
    description: "Complete 1,000 tracked streaming support actions.",
    category: "streaming",
    rewardDomiias: 100,
    check: (stats) => (stats.streamingStats.totalActions || 0) >= 1000,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.totalActions || 0, 1000), target: 1000 }),
    cosmeticRewards: ["streaming-legend-avatar"]
  },

  // ===== Category 7: YouTube support (streamingStats.youtubeActions) —
  // tracked support actions through this website, never a claim of
  // verified external YouTube views. =====
  {
    id: "youtube-10",
    title: "Press Play",
    description: "Complete 10 tracked YouTube support actions.",
    category: "streaming",
    rewardDomiias: 5,
    check: (stats) => (stats.streamingStats.youtubeActions || 0) >= 10,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.youtubeActions || 0, 10), target: 10 })
  },
  {
    id: "youtube-50",
    title: "YouTube Supporter",
    description: "Complete 50 tracked YouTube support actions.",
    category: "streaming",
    rewardDomiias: 15,
    check: (stats) => (stats.streamingStats.youtubeActions || 0) >= 50,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.youtubeActions || 0, 50), target: 50 })
  },
  {
    id: "youtube-100",
    title: "Replay Crew",
    description: "Complete 100 tracked YouTube support actions.",
    category: "streaming",
    rewardDomiias: 25,
    check: (stats) => (stats.streamingStats.youtubeActions || 0) >= 100,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.youtubeActions || 0, 100), target: 100 }),
    cosmeticRewards: ["youtube-100-avatar"]
  },
  {
    id: "youtube-250",
    title: "View Booster",
    description: "Complete 250 tracked YouTube support actions.",
    category: "streaming",
    rewardDomiias: 40,
    check: (stats) => (stats.streamingStats.youtubeActions || 0) >= 250,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.youtubeActions || 0, 250), target: 250 })
  },
  {
    id: "youtube-500",
    title: "YouTube Legend",
    description: "Complete 500 tracked YouTube support actions.",
    category: "streaming",
    rewardDomiias: 60,
    check: (stats) => (stats.streamingStats.youtubeActions || 0) >= 500,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.youtubeActions || 0, 500), target: 500 })
  },

  // ===== Category 8: Spotify support (streamingStats.spotifyActions) —
  // same "tracked support action" wording, never verified streams. =====
  {
    id: "spotify-10",
    title: "Now Playing",
    description: "Complete 10 tracked Spotify support actions.",
    category: "streaming",
    rewardDomiias: 5,
    check: (stats) => (stats.streamingStats.spotifyActions || 0) >= 10,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.spotifyActions || 0, 10), target: 10 })
  },
  {
    id: "spotify-50",
    title: "On Repeat",
    description: "Complete 50 tracked Spotify support actions.",
    category: "streaming",
    rewardDomiias: 15,
    check: (stats) => (stats.streamingStats.spotifyActions || 0) >= 50,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.spotifyActions || 0, 50), target: 50 })
  },
  {
    id: "spotify-100",
    title: "Playlist Energy",
    description: "Complete 100 tracked Spotify support actions.",
    category: "streaming",
    rewardDomiias: 25,
    check: (stats) => (stats.streamingStats.spotifyActions || 0) >= 100,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.spotifyActions || 0, 100), target: 100 }),
    cosmeticRewards: ["spotify-100-avatar"]
  },
  {
    id: "spotify-250",
    title: "Spotify Supporter",
    description: "Complete 250 tracked Spotify support actions.",
    category: "streaming",
    rewardDomiias: 40,
    check: (stats) => (stats.streamingStats.spotifyActions || 0) >= 250,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.spotifyActions || 0, 250), target: 250 })
  },
  {
    id: "spotify-500",
    title: "Streaming Star",
    description: "Complete 500 tracked Spotify support actions.",
    category: "streaming",
    rewardDomiias: 60,
    check: (stats) => (stats.streamingStats.spotifyActions || 0) >= 500,
    progress: (stats) => ({ current: Math.min(stats.streamingStats.spotifyActions || 0, 500), target: 500 })
  },

  // ===== Category 9: Variety — unique actionIds ever supported
  // (uniqueActionsSupported) — encourages spreading support across
  // multiple songs/platforms rather than one repeated click. =====
  {
    id: "unique-3",
    title: "Explorer",
    description: "Support 3 different tracked streaming actions.",
    category: "variety",
    rewardDomiias: 10,
    check: (stats) => stats.uniqueActionsSupported >= 3,
    progress: (stats) => ({ current: Math.min(stats.uniqueActionsSupported, 3), target: 3 })
  },
  {
    id: "unique-5",
    title: "Music Explorer",
    description: "Support 5 different tracked streaming actions.",
    category: "variety",
    rewardDomiias: 15,
    check: (stats) => stats.uniqueActionsSupported >= 5,
    progress: (stats) => ({ current: Math.min(stats.uniqueActionsSupported, 5), target: 5 })
  },
  {
    id: "unique-10",
    title: "Everywhere At Once",
    description: "Support 10 different tracked streaming actions.",
    category: "variety",
    rewardDomiias: 25,
    check: (stats) => stats.uniqueActionsSupported >= 10,
    progress: (stats) => ({ current: Math.min(stats.uniqueActionsSupported, 10), target: 10 }),
    cosmeticRewards: ["soft-pink-theme"]
  },
  {
    id: "unique-20",
    title: "Full Support",
    description: "Support 20 different tracked streaming actions.",
    category: "variety",
    rewardDomiias: 40,
    check: (stats) => stats.uniqueActionsSupported >= 20,
    progress: (stats) => ({ current: Math.min(stats.uniqueActionsSupported, 20), target: 20 })
  }
];

/*
  evaluateNewlyUnlocked(stats, alreadyUnlockedIds, excludeIds)
  ------------------------------------------------------------------
  Pure, synchronous, no Firestore access — the caller supplies the
  already-unlocked set (from reading each achievement doc's existence)
  and gets back the list of definitions that newly qualify. See the file
  header for how callers use this across exactly 2 bounded rounds.
*/
function evaluateNewlyUnlocked(stats, alreadyUnlockedIds, excludeIds) {
  const exclude = excludeIds || new Set();
  return ACHIEVEMENTS.filter((def) => !alreadyUnlockedIds.has(def.id) && !exclude.has(def.id) && def.check(stats));
}

module.exports = { ACHIEVEMENTS, evaluateNewlyUnlocked };
