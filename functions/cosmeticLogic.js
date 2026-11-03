/*
  Core cosmetic-equip and achievement-cosmetic-reconciliation logic —
  separated from the callable wrappers (index.js) the same way
  missionLogic.js is, so both can be exercised directly in tests.

  Cosmetic DEFINITIONS (cosmetics/{cosmeticId}) live in Firestore and are
  admin-authored/public-read (see firestore.rules) — never client-written.
  OWNERSHIP (users/{uid}/cosmetics/{cosmeticId}) is backend-write-only;
  the client only ever asks "equip this cosmetic I already own" via
  equipCosmetic, never asserts ownership or a cosmetic's type itself.
*/

const { HttpsError } = require("firebase-functions/v2/https");
const { ADMIN_UID } = require("./config");
const { syncLeaderboardIfOptedIn, incrementPeriodLeaderboards } = require("./leaderboardLogic");
const { getBangkokWeekKey, getBangkokMonthKey } = require("./dateUtil");

const COSMETIC_TYPES = ["avatar", "background", "theme"];

// Mirrors js/cosmetics.js's client-side THEME_REGISTRY keys. Kept as an
// explicit allow-list here (not just "trust whatever's in the admin-
// authored cosmetic doc") so a stray/typo'd themeKey in Firestore can
// never reach a user's profile and silently fail to apply client-side —
// equipping would instead fail loudly with a clear error.
const KNOWN_THEME_KEYS = [
  "default",
  "purple-night",
  "heartbound-red",
  "midnight-blue",
  "golden-supporter",
  "soft-pink",
  "domiia-night"
];

function isNonEmptyTrimmedString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fieldForType(type) {
  if (type === "avatar") return "selectedAvatar";
  if (type === "background") return "selectedBackground";
  if (type === "theme") return "selectedTheme";
  return null;
}

// Step 7: only AVATAR changes are public leaderboard data (spec section
// 12 — theme/background selections are never stored on the mirror).
// Reads the user doc once (equipping isn't a hot path like mission
// clicks, so this extra read is cheap) purely to learn
// leaderboardOptIn/displayName/lifetimeDomiias; syncLeaderboardIfOptedIn
// itself no-ops entirely for a user who isn't opted in.
async function syncLeaderboardAvatarIfOptedIn(db, uid, newAvatarPath, now, FieldValue) {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return;
  const userData = userSnap.data();
  const leaderboardOptIn = userData.leaderboardOptIn === true;

  await syncLeaderboardIfOptedIn(db, {
    uid,
    leaderboardOptIn,
    displayName: userData.displayName,
    avatarPath: newAvatarPath,
    lifetimeDomiias: userData.lifetimeDomiias,
    now
  });

  // Step 8 (spec section 17): an avatar change also refreshes the
  // CURRENT weekly/monthly mirror's avatarPath — scoreIncrement 0, since
  // equipping a cosmetic never earns Domiias. No-ops entirely if not
  // opted in, same as the all-time sync above.
  const nowDate = now.toDate();
  await incrementPeriodLeaderboards(db, {
    uid,
    leaderboardOptIn,
    displayName: userData.displayName,
    avatarPath: newAvatarPath,
    weekKey: getBangkokWeekKey(nowDate),
    monthKey: getBangkokMonthKey(nowDate),
    scoreIncrement: 0,
    now,
    FieldValue
  });
}

/*
  equipCosmeticCore(db, { uid, cosmeticId, type, now, FieldValue })
  ------------------------------------------------------------------
  Two modes:
    - cosmeticId is a non-empty string: equip that cosmetic. Verifies the
      definition exists/active, that the type is recognized, that the
      CALLER actually owns it (users/{uid}/cosmetics/{cosmeticId} exists),
      and derives which field to update + what value to store FROM THE
      DEFINITION — never from client input.
    - cosmeticId is null/undefined: revert `type` to its default (no
      ownership check needed — every user may always use the default).
      `type` must still be provided and be one of COSMETIC_TYPES here,
      since there's no definition to derive it from.

  Admin testing bypass: when uid === ADMIN_UID, the ownership check below
  is skipped — admin can equip any active, validly-configured cosmetic
  without an ownership doc, for testing. `uid` comes exclusively from the
  verified callable auth context (request.auth.uid in index.js), never
  from request.data, so this can't be spoofed by a client-sent flag.
  EVERY OTHER check (exists, active, valid type, valid themeKey) still
  applies unconditionally to admin too — this bypasses ownership only,
  nothing else. The bypass also never creates a fake ownership doc (see
  the WRITE below: only the user's selected* field changes), so it
  doesn't interfere with testing the real achievement-unlock inventory
  separately, and it never touches achievements/Domiia/progression.

  Not run inside a transaction — equipping is a single-document update
  with no counters/currency involved, so there's no double-award risk to
  guard against (unlike mission/achievement rewards).
*/
async function equipCosmeticCore(db, { uid, cosmeticId, type, now, FieldValue }) {
  const userRef = db.collection("users").doc(uid);
  const isAdmin = uid === ADMIN_UID;

  if (cosmeticId === null || cosmeticId === undefined) {
    if (!COSMETIC_TYPES.includes(type)) {
      throw new HttpsError("invalid-argument", "type must be one of: avatar, background, theme.");
    }
    const field = fieldForType(type);
    await userRef.update({ [field]: null, updatedAt: now });
    if (type === "avatar") {
      await syncLeaderboardAvatarIfOptedIn(db, uid, null, now, FieldValue);
    }
    return { ok: true, type, selectedValue: null };
  }

  if (typeof cosmeticId !== "string" || !cosmeticId.trim()) {
    throw new HttpsError("invalid-argument", "cosmeticId must be a non-empty string, or null to revert to default.");
  }

  const cosmeticSnap = await db.collection("cosmetics").doc(cosmeticId).get();
  if (!cosmeticSnap.exists) {
    throw new HttpsError("not-found", "That cosmetic does not exist.");
  }
  const cosmetic = cosmeticSnap.data();

  if (!cosmetic.active) {
    throw new HttpsError("failed-precondition", "That cosmetic is not currently available.");
  }
  if (!COSMETIC_TYPES.includes(cosmetic.type)) {
    throw new HttpsError("failed-precondition", "That cosmetic has an invalid type.");
  }

  if (!isAdmin) {
    const ownershipSnap = await userRef.collection("cosmetics").doc(cosmeticId).get();
    if (!ownershipSnap.exists) {
      throw new HttpsError("permission-denied", "You have not unlocked that cosmetic.");
    }
  }

  let selectedValue = null;
  if (cosmetic.type === "theme") {
    selectedValue = KNOWN_THEME_KEYS.includes(cosmetic.themeKey) ? cosmetic.themeKey : null;
  } else if (cosmetic.type === "background") {
    // Step 10.6 — backgrounds now need TWO device-specific asset variants
    // (desktop/landscape, mobile/portrait), so selectedBackground can no
    // longer hold a single device-specific asset URL the way selectedAvatar
    // does. Store the STABLE cosmeticId instead; the client resolves the
    // right variant for the current viewport at render time from this
    // cosmetic's own definition (see js/cosmetics.js). Still validate here
    // that the cosmetic has at least one usable asset path configured
    // (desktopAssetPath, or the legacy single assetPath), so equipping a
    // misconfigured background still fails loudly instead of silently
    // going blank — same failure mode as before, just checked differently.
    const hasUsableAsset = isNonEmptyTrimmedString(cosmetic.desktopAssetPath) || isNonEmptyTrimmedString(cosmetic.assetPath);
    selectedValue = hasUsableAsset ? cosmeticId : null;
  } else {
    // avatar stores a directly-usable asset URL — same convention
    // selectedAvatar already used pre-Step-6 for Google photoURL. Never
    // needed responsive variants (profile pictures render the same small
    // size everywhere), so this is unchanged.
    selectedValue = typeof cosmetic.assetPath === "string" && cosmetic.assetPath.trim() ? cosmetic.assetPath : null;
  }

  if (selectedValue === null) {
    throw new HttpsError("failed-precondition", "That cosmetic is misconfigured (missing asset path or theme key).");
  }

  const field = fieldForType(cosmetic.type);
  await userRef.update({ [field]: selectedValue, updatedAt: now });
  if (cosmetic.type === "avatar") {
    await syncLeaderboardAvatarIfOptedIn(db, uid, selectedValue, now, FieldValue);
  }
  return { ok: true, type: cosmetic.type, selectedValue };
}

/*
  syncAchievementCosmeticsCore(db, { uid, now, ACHIEVEMENTS })
  ------------------------------------------------------------------
  Backfills cosmetic ownership for achievements the user unlocked BEFORE
  Step 6 existed (or before a given cosmetic's definition/mapping was
  added) — see spec section 23. Reads the user's own unlocked-achievement
  docs, cross-references each against ACHIEVEMENTS' cosmeticRewards, and
  creates any missing ownership doc. Idempotent (skips cosmetics already
  owned) and NEVER touches Domiia balance, lifetimeDomiias,
  achievementsUnlocked, or re-creates/modifies an achievement doc — purely
  additive inventory backfill. Not transactional: each ownership write is
  independently idempotent (same doc, same shape) and nothing here is a
  counter, so there's no double-award race to protect against the way
  mission/achievement rewards need.
*/
async function syncAchievementCosmeticsCore(db, { uid, now, ACHIEVEMENTS }) {
  const userRef = db.collection("users").doc(uid);
  const achievementsSnap = await userRef.collection("achievements").get();
  const unlockedIds = new Set(achievementsSnap.docs.map((d) => d.id));

  const grants = [];
  ACHIEVEMENTS.forEach((def) => {
    if (!unlockedIds.has(def.id)) return;
    (def.cosmeticRewards || []).forEach((cosmeticId) => {
      grants.push({ cosmeticId, achievementId: def.id });
    });
  });

  let cosmeticsGranted = 0;
  for (const grant of grants) {
    const ownershipRef = userRef.collection("cosmetics").doc(grant.cosmeticId);
    const ownershipSnap = await ownershipRef.get();
    if (ownershipSnap.exists) continue; // already owned — nothing to backfill

    const cosmeticSnap = await db.collection("cosmetics").doc(grant.cosmeticId).get();
    if (!cosmeticSnap.exists) continue; // definition not created yet — skip gracefully, not an error

    await ownershipRef.set({
      cosmeticId: grant.cosmeticId,
      type: cosmeticSnap.data().type,
      unlockedAt: now,
      sourceType: "achievement",
      sourceId: grant.achievementId
    });
    cosmeticsGranted++;
  }

  return { ok: true, cosmeticsGranted };
}

module.exports = { equipCosmeticCore, syncAchievementCosmeticsCore, COSMETIC_TYPES, KNOWN_THEME_KEYS };
