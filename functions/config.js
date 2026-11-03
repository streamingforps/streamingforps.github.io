/*
  Centralized backend config constants.
  ------------------------------------------------------------------
  Step 10 split the single global daily-completion bonus into two
  independent sources (spec section 15):
    - site/gamification.generalDailyCompletionBonus — the GENERAL daily
      set's bonus (evergreen missions). site/gamification is the real
      source of truth; see missionLogic.js's getGeneralDailyBonus().
    - campaigns/{campaignId}.dailyMissionBonus — each CAMPAIGN's own daily
      set bonus, read from that campaign's own document (not a shared
      config doc), so a high-priority campaign can be made more
      rewarding without affecting any other campaign or the general set.
  This file now holds only the DEFENSIVE fallbacks used when the
  respective doc/field is missing, unreadable, or holds an invalid value
  — never the primary source.
*/

// Used ONLY when site/gamification is missing/invalid/unreadable (see
// missionLogic.js's getGeneralDailyBonus, which logs a warning whenever
// this fallback is actually used).
const GENERAL_DAILY_COMPLETION_BONUS_FALLBACK = 10;

// Used ONLY when a campaign doc is missing its own dailyMissionBonus
// field (or holds an invalid value) — deliberately 0, NOT the general
// bonus (spec section 15: "do not silently reuse the general bonus
// unless we explicitly want that" — we don't; an unconfigured campaign
// simply has no completion bonus until the admin sets one).
const CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK = 0;

// The ONE admin account, used server-side to grant the cosmetic-testing
// ownership bypass in cosmeticLogic.js's equipCosmeticCore — never
// trusted from client input (request.data), only ever compared against
// request.auth.uid. This exact string is unavoidably duplicated in
// firestore.rules' isAdmin() and js/firebase-config.js's own ADMIN_UID
// (a Firestore rules file can't require() this module, and a Cloud
// Function can't import frontend js/ files) — keep all three in sync if
// it's ever rotated.
const ADMIN_UID = "Y5r0wou7RITpiLjlitGZpnMfMiC2";

module.exports = { GENERAL_DAILY_COMPLETION_BONUS_FALLBACK, CAMPAIGN_DAILY_COMPLETION_BONUS_FALLBACK, ADMIN_UID };
