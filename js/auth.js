/*
  PerthSanta Streaming — public account authentication (Phase 1).
  ------------------------------------------------------------------
  Loaded as a module on every public page (not admin.html). Provides:
    - Google Sign-In + Email/Password sign up / sign in / sign out
    - A users/{uid} Firestore profile, created on first sign-in and
      merge-safe on every later sign-in (never resets Domiia/mission/
      reward fields — see ensureUserProfile() below)
    - A header auth control (Sign In button <-> avatar/name + menu),
      injected into the existing .header-right on every page that has it
    - A reusable "Sign In" modal, injected once into <body>
    - A small public API (getCurrentUser/getCurrentUserProfile/
      requireAuth/openAuthModal/onAuthChange) so future features (e.g.
      missions) can ask "is this visitor logged in?" without touching
      Firebase directly. Exposed as both ES module exports and
      window.PSAuth for convenience from the site's classic <script>s.

  Every DOM lookup here is guarded (element may not exist on every page)
  so this file is safe to include everywhere — same convention as
  js/main.js and js/campaigns.js.
*/

import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  validatePassword
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { auth, db } from "./firebase-app.js";
import { renderDomiiaAmount, updateDomiiaAmount } from "./domiia.js";
import { applyCosmeticsToPage, syncAchievements } from "./cosmetics.js";
import { syncLeaderboardProfile } from "./leaderboard.js";

/* ==========================================================================
   Display names — validation, normalization, and the uniqueness
   reservation system.
   ------------------------------------------------------------------
   Two display names "collide" if they're equal after trimming, collapsing
   internal whitespace, and lowercasing — "Moon", "moon", "  Moon  " and
   "MOON" are all the same name. That normalized string becomes the lookup
   key via SHA-256 (hex-encoded) rather than being used as a Firestore
   document ID directly: hashing sidesteps every doc-ID restriction
   (slashes, length, reserved "__...__" patterns) for what is otherwise a
   free-text, intentionally non-ASCII-friendly field, while still giving
   exact case-insensitive matching for free (two names that normalize the
   same always hash to the same key).

   displayNames/{nameKey} is the reservation: { uid, displayName,
   displayNameNormalized, createdAt, updatedAt }. Firestore rules enforce
   that only a reservation's own uid can overwrite or delete it — that
   ownership check, combined with every create/rename running inside a
   single transaction (see ensureUserProfile() and renameDisplayName()
   below), is what makes this race-free: Firestore itself serializes two
   concurrent attempts to claim the same key, so one transaction commits
   and the other sees the (now-existing) reservation and fails cleanly.
   ========================================================================== */

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 30;

function normalizeDisplayName(raw) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function validateDisplayNameValue(raw) {
  const value = normalizeDisplayName(raw);
  if (!value) return { ok: false, message: "Please enter a display name." };
  if (value.length < DISPLAY_NAME_MIN) {
    return { ok: false, message: `Display name must be at least ${DISPLAY_NAME_MIN} characters.` };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, message: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

async function computeNameKey(normalizedLower) {
  const bytes = new TextEncoder().encode(normalizedLower);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Thrown by ensureUserProfile() when a brand-new uid has no usable display
// name yet (Google gave none, or it's already taken) — callers must
// collect one from the user before a profile can exist at all.
class ProfileNeedsDisplayNameError extends Error {
  constructor(attemptedName) {
    super("A display name is needed to finish setting up this account.");
    this.code = "profile/needs-display-name";
    this.attemptedName = attemptedName || "";
  }
}

// Public, read-only check used by the signup form's pre-flight check, the
// "choose your display name" modal, and profile.html's rename control.
// Never the final authority on its own — whoever calls this still goes
// through the transactional reserve/rename path, which re-checks at
// commit time and is what actually prevents a race.
async function checkDisplayNameAvailability(rawValue, uidToExclude) {
  const validation = validateDisplayNameValue(rawValue);
  if (!validation.ok) return { status: "invalid", message: validation.message };

  const key = await computeNameKey(validation.value.toLowerCase());
  let snap;
  try {
    snap = await getDoc(doc(db, "displayNames", key));
  } catch (error) {
    console.error("[auth] could not check display name availability", error);
    return { status: "unknown", message: "Couldn't check availability right now." };
  }

  if (snap.exists() && snap.data().uid !== uidToExclude) {
    return { status: "taken", message: "That display name is already taken." };
  }
  return { status: "available", value: validation.value, key };
}

/* ==========================================================================
   Default avatar — inline SVG so Phase 1 doesn't need a new image asset.
   Google users get their Google photoURL instead; selectedAvatar (future
   unlockable profile pictures) will override both once that ships.
   ========================================================================== */

const DEFAULT_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
  '<circle cx="20" cy="20" r="20" fill="#242424"/>' +
  '<circle cx="20" cy="16" r="7" fill="#888888"/>' +
  '<path d="M5 36c0-8.3 6.7-14 15-14s15 5.7 15 14" fill="#888888"/>' +
  "</svg>"
);

// selectedAvatar (Step 6) is always a site-root-relative asset path (the
// cosmetic's assetPath, same convention every other asset path in this
// codebase uses — never absolute/https) — unlike user.photoURL, which is
// always an absolute Google URL and never needs this. basePrefix() is
// defined further down this file; function declarations hoist, so this
// is safe to call from here regardless of source order.
function resolveAvatarAssetUrl(rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return null;
  if (/^(https?:|data:)/i.test(rawPath)) return rawPath;
  return `${basePrefix()}${rawPath}`;
}

function avatarUrlFor(user, profile) {
  const cosmeticUrl = profile && resolveAvatarAssetUrl(profile.selectedAvatar);
  if (cosmeticUrl) return cosmeticUrl;
  if (user && user.photoURL) return user.photoURL;
  return DEFAULT_AVATAR;
}

/* ==========================================================================
   Firebase Auth error mapping — split per flow (sign-up / sign-in /
   Google), because the same error code often needs a different message —
   or a different home (a specific field vs. the general status area) —
   depending which form raised it. Every mapper falls back to a shared
   "network / rate-limited / unknown" tail so those three are handled
   identically everywhere. Unknown errors are always console.error'd (raw
   Firebase codes are never shown to the user) and resolve to the generic
   fallback message, which is reserved for genuinely unexpected errors.
   ========================================================================== */

const GENERIC_AUTH_ERROR = "Something went wrong. Please try again.";

// Applied last in every mapper below. Returns a message for the codes that
// mean the same thing regardless of which form triggered them, or null if
// the caller should keep looking / fall back to the generic message.
function mapCommonAuthError(code) {
  switch (code) {
    case "auth/network-request-failed":
      return "We couldn't connect. Check your internet connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a little and try again.";
    default:
      return null;
  }
}

function applySignUpError(error) {
  const code = error && error.code;

  if (code === "auth/email-already-in-use") {
    setFieldError("email", "An account with this email already exists. Sign in instead.");
    modalEls.fields.email.input.focus();
    return;
  }

  if (code === "auth/invalid-email") {
    setFieldError("email", "Please enter a valid email address.");
    modalEls.fields.email.input.focus();
    return;
  }

  if (code === "auth/weak-password") {
    setFieldError("password", "Your password doesn't meet the required security rules. Please check the requirements above.");
    modalEls.fields.password.input.focus();
    return;
  }

  if (code === "auth/operation-not-allowed") {
    showStatus("Email and password sign-up is currently unavailable.");
    return;
  }

  const commonMessage = mapCommonAuthError(code);
  if (commonMessage) {
    showStatus(commonMessage);
    return;
  }

  console.error("[auth]", error);
  showStatus(GENERIC_AUTH_ERROR);
}

function applySignInError(error) {
  const code = error && error.code;

  if (code === "auth/invalid-email") {
    setFieldError("email", "Please enter a valid email address.");
    modalEls.fields.email.input.focus();
    return;
  }

  // Privacy-safe: never reveal whether the account exists at all, or
  // which of the two fields was wrong. Covers both the current SDK's
  // consolidated auth/invalid-credential and the older per-case codes.
  if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
    showStatus("The email or password is incorrect.");
    return;
  }

  if (code === "auth/user-disabled") {
    showStatus("This account has been disabled. Please contact support.");
    return;
  }

  const commonMessage = mapCommonAuthError(code);
  if (commonMessage) {
    showStatus(commonMessage);
    return;
  }

  console.error("[auth]", error);
  showStatus(GENERIC_AUTH_ERROR);
}

function applyGoogleError(error) {
  const code = error && error.code;

  // A user simply closing the popup isn't an error worth alarming them
  // over — shown in the neutral "info" style, not the red error style.
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    showStatus("Google sign-in was cancelled.", "info");
    return;
  }

  if (code === "auth/popup-blocked") {
    showStatus("Your browser blocked the Google sign-in window. Please allow popups and try again.");
    return;
  }

  if (code === "auth/operation-not-allowed") {
    showStatus("Google sign-in is not currently available.");
    return;
  }

  const commonMessage = mapCommonAuthError(code);
  if (commonMessage) {
    showStatus(commonMessage);
    return;
  }

  console.error("[auth]", error);
  showStatus(GENERIC_AUTH_ERROR);
}

/* ==========================================================================
   users/{uid} profile — create-on-first-login (reserving a display name in
   the same transaction), merge-safe after that.
   ------------------------------------------------------------------
   Firestore rules are the real enforcement boundary (only this exact set
   of identity fields is owner-writable on update; Domiia/mission/reward
   fields are owner-writable only at creation, and only as their locked
   starting values). This function mirrors that contract client-side so a
   returning user's progress is never clobbered by a later login.

   displayName is deliberately NOT re-synced from the auth provider on
   every login (only email/photoURL are) — once reserved, a display name
   only ever changes via the explicit rename flow (renameDisplayName()
   below). Re-syncing it here would silently revert a Google user's custom
   site name back to their Google name on their next login.
   ========================================================================== */

async function ensureUserProfile(user, candidateDisplayName) {
  const userRef = doc(db, "users", user.uid);

  // Fast path: already has a profile. No uniqueness decision to make, so
  // no transaction needed — just keep the safe identity fields in sync.
  const existingSnap = await getDoc(userRef);
  if (existingSnap.exists()) {
    const identityFields = {
      email: user.email || null,
      photoURL: user.photoURL || null,
      updatedAt: serverTimestamp()
    };
    await setDoc(userRef, identityFields, { merge: true });
    return { ...existingSnap.data(), ...identityFields };
  }

  // No profile yet — this uid needs a reserved display name before one
  // can be created. Falls back to whatever the auth provider gave us
  // (Google's display name) when the caller didn't pass one explicitly
  // (email/password signup always passes the name the user typed).
  const candidate = (candidateDisplayName || user.displayName || "").trim();
  const validation = candidate ? validateDisplayNameValue(candidate) : { ok: false };
  if (!validation.ok) {
    throw new ProfileNeedsDisplayNameError(candidate);
  }

  const displayName = validation.value;
  const displayNameNormalized = displayName.toLowerCase();
  const nameKey = await computeNameKey(displayNameNormalized);
  const nameRef = doc(db, "displayNames", nameKey);

  try {
    await runTransaction(db, async (tx) => {
      const nameSnap = await tx.get(nameRef);
      const userSnap = await tx.get(userRef);

      // Lost a race to another concurrent call for this same brand-new
      // uid (e.g. this module's own onAuthStateChanged handler firing
      // alongside an explicit caller) — the other one already finished.
      if (userSnap.exists()) return;

      if (nameSnap.exists() && nameSnap.data().uid !== user.uid) {
        throw Object.assign(new Error("Display name already taken"), { code: "name/taken" });
      }

      const timestamp = serverTimestamp();
      tx.set(nameRef, {
        uid: user.uid,
        displayName,
        displayNameNormalized,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      tx.set(userRef, {
        uid: user.uid,
        displayName,
        displayNameNormalized,
        email: user.email || null,
        photoURL: user.photoURL || null,
        domiiaBalance: 0,
        lifetimeDomiias: 0,
        missionsCompleted: 0,
        leaderboardOptIn: false,
        selectedAvatar: null,
        selectedTheme: null,
        selectedBackground: null,
        selectedBadge: null,
        // Progression (Step 5) — backend-controlled from here on (see
        // firestore.rules' users/{uid} update rule); recordMissionAction
        // is the only thing that ever changes these after creation.
        currentStreak: 0,
        longestStreak: 0,
        daysCompleted: 0,
        lastCompletedDay: null,
        achievementsUnlocked: 0,
        joinedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
  } catch (error) {
    if (error && error.code === "name/taken") {
      throw new ProfileNeedsDisplayNameError(displayName);
    }
    throw error;
  }

  const finalSnap = await getDoc(userRef);
  return finalSnap.exists() ? finalSnap.data() : null;
}

/* ==========================================================================
   Rename — atomic: reserve the new name, update the profile, release the
   old reservation, all inside one transaction. If the new name is taken,
   the transaction throws before any write happens, so the old reservation
   is never touched. Renaming to the current name with only capitalization/
   spacing differences is handled naturally: both names hash to the same
   key, so the "new" reservation IS the existing one (just re-saved with
   the new casing) and there is no old reservation to release.
   ========================================================================== */

async function renameDisplayName(rawNewName) {
  const user = currentUser;
  if (!user) throw new Error("You need to be signed in to do that.");

  const validation = validateDisplayNameValue(rawNewName);
  if (!validation.ok) throw new Error(validation.message);

  const displayName = validation.value;
  const displayNameNormalized = displayName.toLowerCase();
  const newKey = await computeNameKey(displayNameNormalized);

  const currentDisplayName = (currentProfile && currentProfile.displayName) || user.displayName || "";
  const previousKey = currentDisplayName
    ? await computeNameKey(normalizeDisplayName(currentDisplayName).toLowerCase())
    : null;

  const newRef = doc(db, "displayNames", newKey);
  const userRef = doc(db, "users", user.uid);

  await runTransaction(db, async (tx) => {
    const newSnap = await tx.get(newRef);
    if (newSnap.exists() && newSnap.data().uid !== user.uid) {
      throw Object.assign(new Error("That display name is already taken."), { code: "name/taken" });
    }

    const timestamp = serverTimestamp();
    tx.set(newRef, {
      uid: user.uid,
      displayName,
      displayNameNormalized,
      createdAt: newSnap.exists() ? newSnap.data().createdAt : timestamp,
      updatedAt: timestamp
    });
    tx.update(userRef, {
      displayName,
      displayNameNormalized,
      updatedAt: timestamp
    });

    if (previousKey && previousKey !== newKey) {
      tx.delete(doc(db, "displayNames", previousKey));
    }
  });

  // Mirrors the name into the Firebase Auth user record for consistency
  // (e.g. so it shows correctly anywhere else that reads auth.currentUser
  // directly) — this never touches the user's actual Google account.
  try {
    await updateProfile(user, { displayName });
  } catch (error) {
    console.error("[auth] could not sync Auth displayName", error);
  }

  // Keep the public leaderboard mirror in sync right after a successful
  // rename (spec section 11) — a no-op server-side if this account isn't
  // opted in. The rename itself stays this existing client-side
  // transaction (unchanged/low-risk); this is a secondary, non-blocking
  // side effect, same treatment as the updateProfile() call above — a
  // failure here never undoes or fails the rename that already committed.
  syncLeaderboardProfile().catch((error) => {
    console.error("[auth] could not sync leaderboard entry after rename", error);
  });

  // No manual currentProfile update here on purpose — the users/{uid}
  // listener we're already subscribed to (see subscribeToUserProfile())
  // picks up the transaction's own write above and updates
  // currentProfile/the header/onAuthChange subscribers on its own. One
  // source of truth, not two racing to set the same state.
  return displayName;
}

/* ==========================================================================
   Module state + public API
   ========================================================================== */

let currentUser = null;
let currentProfile = null;
let authResolvedOnce = false;
const stateListeners = [];
let pendingAuthResolvers = [];

function getCurrentUser() {
  return currentUser;
}

function getCurrentUserProfile() {
  return currentProfile;
}

// True once the realtime users/{uid} listener has delivered at least one
// snapshot for the CURRENTLY signed-in user — lets the UI distinguish
// "still loading, don't know the balance yet" from "loaded, balance is
// genuinely 0" (see js/domiia.js: passing null/undefined renders "—"
// instead of a misleading 0).
function isProfileLoaded() {
  return profileLoaded;
}

function onAuthChange(listener) {
  stateListeners.push(listener);
  if (authResolvedOnce) listener(currentUser, currentProfile, profileLoaded);
  return () => {
    const i = stateListeners.indexOf(listener);
    if (i !== -1) stateListeners.splice(i, 1);
  };
}

function requireAuth() {
  return new Promise((resolve) => {
    if (authResolvedOnce && currentUser) {
      resolve(currentUser);
      return;
    }
    pendingAuthResolvers.push(resolve);
    openAuthModal("signin");
  });
}

async function signOutUser() {
  await signOut(auth);
}

function notifyAuthListeners() {
  stateListeners.forEach((listener) => {
    try {
      listener(currentUser, currentProfile, profileLoaded);
    } catch (error) {
      console.error("[auth] listener error", error);
    }
  });
  if (currentUser && pendingAuthResolvers.length) {
    const resolvers = pendingAuthResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(currentUser));
  }
}

/* ==========================================================================
   Realtime profile sync — ONE shared users/{uid} listener.
   ------------------------------------------------------------------
   This is the single source of truth for currentProfile from here on.
   ensureUserProfile()/renameDisplayName() still WRITE to Firestore (the
   one-time create and the rename transaction), but neither of them sets
   currentProfile directly anymore — this listener picks up every write
   (its own included) and is what actually updates currentProfile,
   re-renders the header, and notifies onAuthChange subscribers. That
   means a Cloud Function reward write in a later phase will show up here
   automatically too, with zero changes needed on this end.

   subscribeToUserProfile() is idempotent per uid (calling it again for
   the uid it's already attached to is a no-op) and always tears down any
   previous listener first — covering both "user signs out" (the
   onAuthStateChanged handler below calls unsubscribeFromUserProfile()
   directly) and "a different account signs in without an intermediate
   sign-out" (e.g. signInWithPopup for another Google account), where
   subscribeToUserProfile() sees the uid has changed and swaps listeners
   itself.
   ========================================================================== */

let profileUnsubscribe = null;
let profileListenerUid = null;
let profileLoaded = false;
let syncedAchievementsForUid = null;

// Historical achievement reconciliation (fixes accounts whose qualifying
// stats were reached before the achievement system existed — see
// functions/achievementLogic.js) — once per uid per sign-in/session, not
// on every profile snapshot (spec section 10). Lives here, not just on
// profile.html, specifically because the fix affects domiiaBalance shown
// in the HEADER on every page, not only the Customize Profile UI.
//
// Reaches js/mission-tracking.js's toast via window.PSMissionTracking
// rather than an ES import: mission-tracking.js already imports
// getCurrentUser FROM this file, so an import the other way round would
// be circular. The window global is set synchronously at that module's
// own top level, long before this callback ever actually fires (which
// only happens once Firebase Auth resolves), so it's reliably present by
// the time it's read here regardless of script load order.
function triggerAchievementSync(uid) {
  if (syncedAchievementsForUid === uid) return;
  syncedAchievementsForUid = uid;
  syncAchievements()
    .then((result) => {
      const unlocked = result && Array.isArray(result.achievementsUnlocked) ? result.achievementsUnlocked : [];
      if (unlocked.length && window.PSMissionTracking && typeof window.PSMissionTracking.showBackfilledAchievementsToast === "function") {
        window.PSMissionTracking.showBackfilledAchievementsToast(unlocked);
      }
    })
    .catch((error) => {
      console.error("[auth] syncAchievements failed", error);
    });
}

let syncedLeaderboardForUid = null;

// Idempotent leaderboard-mirror repair (spec sections 13, 38) — once per
// uid per sign-in/session, same guard pattern as triggerAchievementSync
// above. Covers a stale/missing mirror doc; never awards anything.
function triggerLeaderboardSync(uid) {
  if (syncedLeaderboardForUid === uid) return;
  syncedLeaderboardForUid = uid;
  syncLeaderboardProfile().catch((error) => {
    console.error("[auth] syncLeaderboardProfile failed", error);
  });
}

function subscribeToUserProfile(uid) {
  if (profileListenerUid === uid && profileUnsubscribe) return;
  unsubscribeFromUserProfile();

  profileListenerUid = uid;
  profileUnsubscribe = onSnapshot(
    doc(db, "users", uid),
    (snap) => {
      currentProfile = snap.exists() ? snap.data() : null;
      profileLoaded = true;
      renderHeaderState();
      // Applies selectedTheme/selectedBackground site-wide, on EVERY
      // public page, every time this fires — including the instant an
      // equip/unequip Cloud Function call lands, with no reload needed
      // (spec sections 13, 26).
      applyCosmeticsToPage(currentProfile);
      // Only once the profile doc genuinely exists — right after a
      // brand-new sign-up there's a brief window before
      // ensureUserProfile()'s own transaction has created it yet, and
      // syncAchievements would just fail-precondition for nothing.
      if (currentProfile) {
        triggerAchievementSync(uid);
        triggerLeaderboardSync(uid);
      }
      notifyAuthListeners();
    },
    (error) => {
      console.error("[auth] profile listener error", error);
      // Stop showing a "loading" state forever just because the listener
      // itself failed (offline, rules rejection, etc.) — fall back to
      // whatever currentProfile already held (possibly null).
      profileLoaded = true;
      renderHeaderState();
      notifyAuthListeners();
    }
  );
}

function unsubscribeFromUserProfile() {
  if (profileUnsubscribe) {
    profileUnsubscribe();
    profileUnsubscribe = null;
  }
  // Signing out reverts the page to the default look — a signed-out
  // visitor must never keep seeing another account's equipped theme/
  // background (spec section 13: "Logged-out users use default theme").
  applyCosmeticsToPage(null);
  profileListenerUid = null;
  profileLoaded = false;
  syncedAchievementsForUid = null;
  syncedLeaderboardForUid = null;
}

// Set by the signup/Google handlers immediately before the Firebase call
// that will cause onAuthStateChanged to fire, so that generic handler
// skips its own ensureUserProfile() call for this one event — the caller
// is about to run handleFirstSignIn() itself, with the one piece of
// information the generic handler can't have: the display name the user
// actually typed (for signup) or whether this needs the "choose a display
// name" flow (for Google). Without this, both would call ensureUserProfile
// independently and whichever ran first (unpredictable) would win.
let suppressNextProfileEnsure = false;

// Shared by the email-signup submit handler and the Google button handler
// — anything that might be a brand-new uid needing a reserved display
// name. Opens the "choose a display name" modal on that specific failure;
// re-throws anything else for the caller's own error handling. Doesn't
// touch currentProfile itself — the users/{uid} listener (already
// subscribed by the time this runs; see onAuthStateChanged below) picks
// up the write this makes and updates currentProfile on its own.
async function handleFirstSignIn(user, candidateDisplayName) {
  try {
    await ensureUserProfile(user, candidateDisplayName);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProfileNeedsDisplayNameError) {
      openChooseNameModal(user, error.attemptedName);
      return { ok: false, needsName: true };
    }
    throw error;
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    // Subscribed unconditionally and before anything else: it's safe to
    // attach even before a profile document exists (onSnapshot just
    // reports exists():false until it's created), and attaching early
    // means the listener is already live for handleFirstSignIn()'s own
    // writes below, regardless of which runs first.
    subscribeToUserProfile(user.uid);

    if (suppressNextProfileEnsure) {
      suppressNextProfileEnsure = false;
      // handleFirstSignIn() (triggered by whichever flow caused this
      // sign-in) owns creating the profile for this event — see the
      // comment on suppressNextProfileEnsure above.
    } else {
      try {
        await ensureUserProfile(user);
      } catch (error) {
        if (error instanceof ProfileNeedsDisplayNameError) {
          openChooseNameModal(user, error.attemptedName);
        } else {
          console.error("[auth] could not load/create user profile", error);
        }
      }
    }
  } else {
    unsubscribeFromUserProfile();
    currentProfile = null;
  }
  authResolvedOnce = true;
  renderHeaderState();
  notifyAuthListeners();
});

/* ==========================================================================
   Header auth control — Sign In button <-> avatar/name + dropdown menu.
   Injected into the existing .header-right (same markup on every public
   page), right before the settings gear, so it needs zero markup changes
   on any page beyond loading this script.
   ========================================================================== */

let headerEls = null;

function basePrefix() {
  const logo = document.querySelector(".site-logo");
  const href = (logo && logo.getAttribute("href")) || "index.html";
  return href.endsWith("index.html") ? href.slice(0, -"index.html".length) : "";
}

function buildHeaderControl() {
  const headerRight = document.querySelector(".header-right");
  if (!headerRight) return;

  const wrap = document.createElement("div");
  wrap.className = "auth-control is-loading";

  const signInBtn = document.createElement("button");
  signInBtn.type = "button";
  signInBtn.className = "auth-signin-btn";
  signInBtn.textContent = "Sign In";
  signInBtn.addEventListener("click", () => openAuthModal("signin", signInBtn));

  // Appears before the avatar/name, logged-in users only (section 4) —
  // null renders the "—" loading state (see js/domiia.js) rather than a
  // misleading 0 while the profile listener's first snapshot is in flight.
  const domiiaEl = renderDomiiaAmount(null, { size: "small" });
  domiiaEl.classList.add("header-domiia");
  domiiaEl.hidden = true;
  domiiaEl.title = "Your Domiia balance";

  const userWrap = document.createElement("div");
  userWrap.className = "auth-user";
  userWrap.hidden = true;

  const userTrigger = document.createElement("button");
  userTrigger.type = "button";
  userTrigger.className = "auth-user-trigger";
  userTrigger.setAttribute("aria-haspopup", "true");
  userTrigger.setAttribute("aria-expanded", "false");
  userTrigger.setAttribute("aria-controls", "auth-user-menu");

  const avatarImg = document.createElement("img");
  avatarImg.className = "auth-user-avatar";
  avatarImg.alt = "";
  avatarImg.width = 28;
  avatarImg.height = 28;
  // A cosmetic avatar's asset file may not actually exist yet (spec
  // section 31/15: "if cosmetic asset is missing, fallback safely, no
  // broken-image icon"). DEFAULT_AVATAR is an inline data: URI, which
  // can't itself fail to decode, so this can't loop.
  avatarImg.addEventListener("error", () => {
    if (avatarImg.src !== DEFAULT_AVATAR) avatarImg.src = DEFAULT_AVATAR;
  });

  const nameSpan = document.createElement("span");
  nameSpan.className = "auth-user-name";

  userTrigger.append(avatarImg, nameSpan);

  const menu = document.createElement("div");
  menu.className = "auth-user-menu";
  menu.id = "auth-user-menu";
  menu.hidden = true;

  const profileLink = document.createElement("a");
  profileLink.className = "auth-user-menu-item";
  profileLink.href = `${basePrefix()}profile.html`;
  profileLink.textContent = "Profile";

  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.className = "auth-user-menu-item auth-signout-btn";
  signOutBtn.textContent = "Sign Out";

  menu.append(profileLink, signOutBtn);
  userWrap.append(userTrigger, menu);
  wrap.append(signInBtn, domiiaEl, userWrap);

  const settingsEl = headerRight.querySelector(".site-settings");
  if (settingsEl) headerRight.insertBefore(wrap, settingsEl);
  else headerRight.appendChild(wrap);

  function closeUserMenu() {
    menu.hidden = true;
    userTrigger.setAttribute("aria-expanded", "false");
  }

  userTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeUserMenu();
    if (willOpen) {
      menu.hidden = false;
      userTrigger.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (event) => {
    if (!userWrap.contains(event.target)) closeUserMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeUserMenu();
      userTrigger.focus();
    }
  });

  signOutBtn.addEventListener("click", async () => {
    closeUserMenu();
    try {
      await signOutUser();
    } catch (error) {
      console.error("[auth] sign-out failed", error);
    }
  });

  headerEls = { wrap, signInBtn, domiiaEl, userWrap, avatarImg, nameSpan };
}

// Protected currency fields (domiiaBalance/lifetimeDomiias/missionsCompleted)
// are backend-written only — this never writes anything, it just covers a
// legacy/edge-case profile doc that's somehow missing one, so display code
// doesn't crash on `undefined`. Logs once per read so it's visible in the
// console without spamming on every re-render.
function safeDomiiaField(profile, field) {
  if (!profile) return 0;
  const value = profile[field];
  if (typeof value !== "number") {
    console.warn(`[auth] profile is missing numeric "${field}" — showing 0`, profile);
    return 0;
  }
  return value;
}

// Same spirit as safeDomiiaField, but WITHOUT the console.warn — missing
// progression fields (currentStreak/longestStreak/daysCompleted/
// lastCompletedDay/achievementsUnlocked) are the EXPECTED, normal state
// for every profile created before Step 5, until that user's next
// recordMissionAction call backfills them. Warning on every such profile
// view would just spam the console for completely ordinary accounts.
function safeProgressField(profile, field, fallback) {
  if (!profile) return fallback;
  const value = profile[field];
  return value === undefined ? fallback : value;
}

function renderHeaderState() {
  if (!headerEls) return;
  headerEls.wrap.classList.remove("is-loading");

  if (currentUser) {
    const displayName = (currentProfile && currentProfile.displayName) || currentUser.displayName || "Fan";
    headerEls.signInBtn.hidden = true;
    headerEls.domiiaEl.hidden = false;
    headerEls.userWrap.hidden = false;
    headerEls.avatarImg.src = avatarUrlFor(currentUser, currentProfile);
    headerEls.nameSpan.textContent = displayName;
    // .auth-user-name caps its width with an ellipsis (reserving room for
    // the Domiia display) — the title attribute surfaces the full name on
    // hover/focus for anything long enough to get truncated.
    headerEls.nameSpan.title = displayName;

    // null (not 0) while the profile listener hasn't delivered its first
    // snapshot yet — renders the "—" loading state instead of a balance
    // that falsely reads as zero (section 11).
    const balance = profileLoaded ? safeDomiiaField(currentProfile, "domiiaBalance") : null;
    updateDomiiaAmount(headerEls.domiiaEl, balance);
  } else {
    headerEls.signInBtn.hidden = false;
    headerEls.domiiaEl.hidden = true;
    headerEls.userWrap.hidden = true;
  }
}

/* ==========================================================================
   Auth modal — Sign In / Create Account, injected once into <body>.
   ========================================================================== */

let modalEls = null;
let modalMode = "signin";
let modalTriggerEl = null;

// Order fields are validated/focused in — matches the DOM's visual order
// in signup mode, so "focus the first invalid field" always makes sense
// regardless of which fields are currently visible.
const FIELD_ORDER = ["name", "email", "password", "confirm"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildModal() {
  const overlay = document.createElement("div");
  overlay.className = "auth-modal-overlay";
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button type="button" class="auth-modal-close" aria-label="Close">&times;</button>

      <h2 class="auth-modal-title" id="auth-modal-title">Sign In</h2>

      <button type="button" class="btn btn-secondary auth-google-btn">Continue with Google</button>

      <div class="auth-modal-divider"><span>or</span></div>

      <form class="auth-form" novalidate>
        <div class="auth-field auth-field-name" hidden>
          <label for="auth-field-displayname">Display name</label>
          <input type="text" id="auth-field-displayname" autocomplete="name" />
          <p class="auth-field-error" id="auth-field-displayname-error" role="alert" hidden></p>
        </div>

        <div class="auth-field">
          <label for="auth-field-email">Email</label>
          <input type="email" id="auth-field-email" autocomplete="email" required />
          <p class="auth-field-error" id="auth-field-email-error" role="alert" hidden></p>
        </div>

        <div class="auth-field">
          <label for="auth-field-password">Password</label>
          <div class="auth-field-input-wrap">
            <input type="password" id="auth-field-password" autocomplete="current-password" required />
            <button type="button" class="auth-toggle-password" aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          <ul class="auth-password-requirements" id="auth-password-requirements" hidden></ul>
          <p class="auth-field-error" id="auth-field-password-error" role="alert" hidden></p>
        </div>

        <div class="auth-field auth-field-confirm" hidden>
          <label for="auth-field-confirm">Confirm password</label>
          <div class="auth-field-input-wrap">
            <input type="password" id="auth-field-confirm" autocomplete="new-password" />
            <button type="button" class="auth-toggle-password" aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          <p class="auth-field-error" id="auth-field-confirm-error" role="alert" hidden></p>
        </div>

        <p class="auth-status" role="alert" hidden></p>

        <button type="submit" class="btn btn-primary auth-submit-btn">Sign In</button>
      </form>

      <p class="auth-modal-switch">
        <span class="auth-switch-prompt">Don't have an account?</span>
        <button type="button" class="auth-modal-switch-btn">Create one</button>
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector("#auth-field-displayname");
  const emailInput = overlay.querySelector("#auth-field-email");
  const passwordInput = overlay.querySelector("#auth-field-password");
  const confirmInput = overlay.querySelector("#auth-field-confirm");

  const els = {
    overlay,
    dialog: overlay.querySelector(".auth-modal"),
    closeBtn: overlay.querySelector(".auth-modal-close"),
    title: overlay.querySelector("#auth-modal-title"),
    googleBtn: overlay.querySelector(".auth-google-btn"),
    form: overlay.querySelector(".auth-form"),
    nameField: overlay.querySelector(".auth-field-name"),
    nameInput,
    emailInput,
    passwordInput,
    passwordRequirements: overlay.querySelector("#auth-password-requirements"),
    confirmField: overlay.querySelector(".auth-field-confirm"),
    confirmInput,
    status: overlay.querySelector(".auth-status"),
    submitBtn: overlay.querySelector(".auth-submit-btn"),
    switchPrompt: overlay.querySelector(".auth-switch-prompt"),
    switchBtn: overlay.querySelector(".auth-modal-switch-btn"),
    fields: {
      name: { input: nameInput, errorEl: overlay.querySelector("#auth-field-displayname-error"), wrapper: nameInput.closest(".auth-field") },
      email: { input: emailInput, errorEl: overlay.querySelector("#auth-field-email-error"), wrapper: emailInput.closest(".auth-field") },
      password: { input: passwordInput, errorEl: overlay.querySelector("#auth-field-password-error"), wrapper: passwordInput.closest(".auth-field") },
      confirm: { input: confirmInput, errorEl: overlay.querySelector("#auth-field-confirm-error"), wrapper: confirmInput.closest(".auth-field") }
    }
  };

  modalEls = els;

  // Deliberately NOT closable by clicking the backdrop (or by a text
  // selection/drag that ends outside the modal, which is indistinguishable
  // from a backdrop click via the `click` event) — losing typed-in
  // credentials to an accidental outside click is worse than the modal
  // being slightly harder to dismiss. Only the explicit X button and
  // Escape (handleModalKeydown) close it.
  els.closeBtn.addEventListener("click", () => closeAuthModal());
  els.switchBtn.addEventListener("click", () => {
    setModalMode(modalMode === "signin" ? "signup" : "signin");
  });

  overlay.querySelectorAll(".auth-toggle-password").forEach((btn) => {
    const input = btn.previousElementSibling;
    btn.addEventListener("click", () => {
      const willShow = input.type === "password";
      input.type = willShow ? "text" : "password";
      btn.textContent = willShow ? "Hide" : "Show";
      btn.setAttribute("aria-label", willShow ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", willShow ? "true" : "false");
      input.focus();
    });
  });

  nameInput.addEventListener("input", () => {
    if (hasFieldError("name")) validateNameField();
  });

  emailInput.addEventListener("input", () => {
    if (hasFieldError("email")) validateEmailField();
  });

  passwordInput.addEventListener("input", () => {
    if (modalMode === "signup") {
      refreshPasswordRequirements();
      if (hasFieldError("password")) validatePasswordForSignup();
    } else if (hasFieldError("password")) {
      validatePasswordRequired();
    }
    if (hasFieldError("confirm")) validateConfirmField();
  });

  confirmInput.addEventListener("input", () => {
    if (hasFieldError("confirm")) validateConfirmField();
  });

  els.googleBtn.addEventListener("click", async () => {
    clearStatus();
    setSubmitting(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      suppressNextProfileEnsure = true;
      const result = await signInWithPopup(auth, provider);
      await handleFirstSignIn(result.user);
      closeAuthModal();
    } catch (error) {
      suppressNextProfileEnsure = false;
      applyGoogleError(error);
    } finally {
      setSubmitting(false);
    }
  });

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();

    if (modalMode === "signup") {
      const nameOk = validateNameField();
      const emailOk = validateEmailField();
      const passwordOk = await validatePasswordForSignup();
      const confirmOk = validateConfirmField();
      const nameAvailable = nameOk ? await validateNameAvailableForSignup() : true;

      if (!nameOk || !nameAvailable || !emailOk || !passwordOk || !confirmOk) {
        focusFirstInvalidField();
        return;
      }

      const displayName = normalizeDisplayName(nameInput.value);
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      setSubmitting(true, "Creating account…");
      try {
        await setPersistence(auth, browserLocalPersistence);
        suppressNextProfileEnsure = true;
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const outcome = await handleFirstSignIn(credential.user, displayName);
        if (outcome.ok) {
          updateProfile(credential.user, { displayName }).catch((error) => {
            console.error("[auth] could not sync Auth displayName", error);
          });
        }
        // outcome.needsName only happens on an extremely rare race (the
        // name was taken in the moment between our pre-check above and
        // account creation) — the choose-name modal is already open and
        // takes over from here either way, so this modal always closes.
        closeAuthModal();
      } catch (error) {
        suppressNextProfileEnsure = false;
        applySignUpError(error);
      } finally {
        setSubmitting(false);
      }
    } else {
      const emailOk = validateEmailField();
      const passwordOk = validatePasswordRequired();

      if (!emailOk || !passwordOk) {
        focusFirstInvalidField();
        return;
      }

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      setSubmitting(true, "Signing in…");
      try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        closeAuthModal();
      } catch (error) {
        applySignInError(error);
      } finally {
        setSubmitting(false);
      }
    }
  });
}

/* ---- Field-level validation ----
   Each validator both returns a boolean and sets/clears that field's
   error — so the same function works for "validate on submit" and
   "revalidate while the user is fixing a stale error" (section 4). */

function fieldDescriptor(key) {
  return modalEls.fields[key];
}

function hasFieldError(key) {
  const { errorEl } = fieldDescriptor(key);
  return !errorEl.hidden;
}

function setFieldError(key, message) {
  const { input, errorEl, wrapper } = fieldDescriptor(key);
  errorEl.textContent = message;
  errorEl.hidden = false;
  input.setAttribute("aria-invalid", "true");
  if (wrapper) wrapper.classList.add("is-invalid");
  updateDescribedBy(key);
}

function clearFieldError(key) {
  const { input, errorEl, wrapper } = fieldDescriptor(key);
  errorEl.hidden = true;
  errorEl.textContent = "";
  input.removeAttribute("aria-invalid");
  if (wrapper) wrapper.classList.remove("is-invalid");
  updateDescribedBy(key);
}

function updateDescribedBy(key) {
  const { input, errorEl } = fieldDescriptor(key);
  const ids = [];
  if (key === "password" && modalMode === "signup" && !modalEls.passwordRequirements.hidden) {
    ids.push("auth-password-requirements");
  }
  if (!errorEl.hidden) ids.push(errorEl.id);
  if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
  else input.removeAttribute("aria-describedby");
}

function focusFirstInvalidField() {
  for (const key of FIELD_ORDER) {
    const field = fieldDescriptor(key);
    if (field.input.offsetParent !== null && hasFieldError(key)) {
      field.input.focus();
      return;
    }
  }
}

function validateNameField() {
  const result = validateDisplayNameValue(modalEls.nameInput.value);
  if (!result.ok) {
    setFieldError("name", result.message);
    return false;
  }
  clearFieldError("name");
  return true;
}

// Only called once format validation (above) already passed. Fails open
// on a lookup error (network, etc.) — the transaction inside
// ensureUserProfile() at account-creation time is the real authority and
// will still catch a genuine collision; this is purely a fast, friendly
// pre-check so the common case never has to create-then-roll-back an
// orphaned Firebase Auth account.
async function validateNameAvailableForSignup() {
  const result = await checkDisplayNameAvailability(modalEls.nameInput.value, null);
  if (result.status === "taken" || result.status === "invalid") {
    setFieldError("name", result.message);
    return false;
  }
  clearFieldError("name");
  return true;
}

function validateEmailField() {
  const value = modalEls.emailInput.value.trim();
  if (!value) {
    setFieldError("email", "Please enter your email address.");
    return false;
  }
  if (!EMAIL_RE.test(value)) {
    setFieldError("email", "Please enter a valid email address.");
    return false;
  }
  clearFieldError("email");
  return true;
}

function validatePasswordRequired() {
  if (!modalEls.passwordInput.value) {
    setFieldError("password", "Please enter a password.");
    return false;
  }
  clearFieldError("password");
  return true;
}

// Checks the password against the project's ACTUAL configured Firebase
// Auth password policy via validatePassword() (SDK 10.7+) rather than any
// hardcoded rule set — see renderPasswordRequirements() for how the same
// result also drives the live checklist under the field. Falls back to
// Firebase's absolute floor (6 characters) only if the policy can't be
// fetched at all (e.g. offline), so the field is never left unvalidated.
async function validatePasswordForSignup() {
  const value = modalEls.passwordInput.value;
  if (!value) {
    setFieldError("password", "Please enter a password.");
    return false;
  }

  let status = null;
  try {
    status = await validatePassword(auth, value);
  } catch (error) {
    console.error("[auth] could not check password policy", error);
  }

  if (status) {
    renderPasswordRequirements(status);
    if (!status.isValid) {
      setFieldError("password", "Your password doesn't meet the requirements below.");
      return false;
    }
  } else if (value.length < 6) {
    setFieldError("password", "Password must be at least 6 characters.");
    return false;
  }

  clearFieldError("password");
  return true;
}

function validateConfirmField() {
  const value = modalEls.confirmInput.value;
  if (!value) {
    setFieldError("confirm", "Please confirm your password.");
    return false;
  }
  if (value !== modalEls.passwordInput.value) {
    setFieldError("confirm", "Passwords do not match.");
    return false;
  }
  clearFieldError("confirm");
  return true;
}

/* ---- Live password requirements checklist ----
   Built entirely from whatever validatePassword() reports for THIS
   project — nothing here is hardcoded, so it automatically reflects
   Firebase's default minimum-length-only rule unless a custom Identity
   Platform password policy has been configured, in which case it shows
   exactly those requirements instead. */

let passwordChecklistToken = 0;

async function refreshPasswordRequirements() {
  const password = modalEls.passwordInput.value;
  const token = ++passwordChecklistToken;
  let status = null;
  try {
    status = await validatePassword(auth, password);
  } catch (error) {
    console.error("[auth] could not fetch password policy", error);
    return;
  }
  if (token !== passwordChecklistToken) return; // superseded by a later keystroke
  renderPasswordRequirements(status);
}

function renderPasswordRequirements(status) {
  const container = modalEls.passwordRequirements;
  const options = (status && status.passwordPolicy && status.passwordPolicy.customStrengthOptions) || {};

  // NOTE: Firebase's PasswordValidationStatus names the per-character-class
  // flags identically to the policy's own customStrengthOptions keys
  // (containsLowercaseLetter, containsUppercaseLetter, etc.) — NOT
  // "meetsXRequirement" as you might expect by analogy with
  // meetsMinPasswordLength. Using the wrong names here previously made
  // every row but length read as `undefined` (always falsy), so e.g.
  // "Aa123456" showed only length as met despite satisfying all four.
  const rows = [];
  if (options.minPasswordLength) {
    rows.push({ label: `At least ${options.minPasswordLength} characters`, met: !!status.meetsMinPasswordLength });
  }
  if (options.containsLowercaseLetter) {
    rows.push({ label: "One lowercase letter", met: !!status.containsLowercaseLetter });
  }
  if (options.containsUppercaseLetter) {
    rows.push({ label: "One uppercase letter", met: !!status.containsUppercaseLetter });
  }
  if (options.containsNumericCharacter) {
    rows.push({ label: "One number", met: !!status.containsNumericCharacter });
  }
  if (options.containsNonAlphanumericCharacter) {
    rows.push({ label: "One special character", met: !!status.containsNonAlphanumericCharacter });
  }

  container.innerHTML = "";
  rows.forEach((row) => {
    const li = document.createElement("li");
    li.className = "auth-password-requirement" + (row.met ? " is-met" : "");
    const icon = document.createElement("span");
    icon.className = "auth-password-requirement-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = row.met ? "✓" : "•";
    li.append(icon, document.createTextNode(row.label));
    container.appendChild(li);
  });

  container.hidden = rows.length === 0;
  updateDescribedBy("password");
}

/* ---- Modal chrome: mode switching, status area, submit state ---- */

function setModalMode(mode) {
  modalMode = mode;
  if (!modalEls) return;
  clearStatus();
  FIELD_ORDER.forEach(clearFieldError);

  const isSignup = mode === "signup";
  modalEls.title.textContent = isSignup ? "Create Account" : "Sign In";
  modalEls.nameField.hidden = !isSignup;
  modalEls.nameInput.required = isSignup;
  modalEls.confirmField.hidden = !isSignup;
  modalEls.confirmInput.required = isSignup;
  modalEls.passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  modalEls.submitBtn.textContent = isSignup ? "Create Account" : "Sign In";
  modalEls.switchPrompt.textContent = isSignup ? "Already have an account?" : "Don't have an account?";
  modalEls.switchBtn.textContent = isSignup ? "Sign in" : "Create one";

  if (isSignup) {
    refreshPasswordRequirements();
  } else {
    modalEls.passwordRequirements.hidden = true;
    modalEls.passwordRequirements.innerHTML = "";
  }
  updateDescribedBy("password");
}

function clearStatus() {
  if (!modalEls) return;
  modalEls.status.hidden = true;
  modalEls.status.textContent = "";
  modalEls.status.classList.remove("auth-status--info");
}

function showStatus(message, variant) {
  if (!modalEls) return;
  modalEls.status.hidden = false;
  modalEls.status.textContent = message;
  modalEls.status.classList.toggle("auth-status--info", variant === "info");
}

function setSubmitting(isSubmitting, label) {
  if (!modalEls) return;
  modalEls.submitBtn.disabled = isSubmitting;
  modalEls.googleBtn.disabled = isSubmitting;

  if (isSubmitting) {
    if (!modalEls.submitBtn.dataset.restoreLabel) {
      modalEls.submitBtn.dataset.restoreLabel = modalEls.submitBtn.textContent;
    }
    if (label) modalEls.submitBtn.textContent = label;
  } else if (modalEls.submitBtn.dataset.restoreLabel) {
    modalEls.submitBtn.textContent = modalEls.submitBtn.dataset.restoreLabel;
    delete modalEls.submitBtn.dataset.restoreLabel;
  }
}

function clearForm() {
  if (!modalEls) return;
  modalEls.form.reset();
  clearStatus();
  FIELD_ORDER.forEach(clearFieldError);
  modalEls.overlay.querySelectorAll(".auth-toggle-password").forEach((btn) => {
    const input = btn.previousElementSibling;
    input.type = "password";
    btn.textContent = "Show";
    btn.setAttribute("aria-label", "Show password");
    btn.setAttribute("aria-pressed", "false");
  });
}

function handleModalKeydown(event) {
  if (event.key === "Escape") {
    closeAuthModal();
    return;
  }
  if (event.key === "Tab" && modalEls) {
    const focusable = modalEls.dialog.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), a[href]"
    );
    const visible = Array.from(focusable).filter((el) => el.offsetParent !== null);
    if (!visible.length) return;
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

// Reference-counts body scroll-locking across the two independent modals
// (auth modal + choose-name modal) — a plain add/remove in each modal's
// open/close would have one modal's close wrongly un-lock scrolling while
// the other is still open (this happens for real: the Google handler
// closes the auth modal right after handleFirstSignIn() may have already
// opened the choose-name modal on top of it).
function updateBodyScrollLock() {
  const anyOpen = (modalEls && !modalEls.overlay.hidden) || (chooseNameEls && !chooseNameEls.overlay.hidden);
  document.body.classList.toggle("auth-modal-open", !!anyOpen);
}

function openAuthModal(mode, triggerEl) {
  if (!modalEls) buildModal();
  modalTriggerEl = triggerEl || document.activeElement;
  setModalMode(mode || "signin");
  clearForm();
  modalEls.overlay.hidden = false;
  updateBodyScrollLock();
  document.addEventListener("keydown", handleModalKeydown);
  requestAnimationFrame(() => {
    modalEls.emailInput.focus();
  });
}

function closeAuthModal() {
  if (!modalEls || modalEls.overlay.hidden) return;
  modalEls.overlay.hidden = true;
  updateBodyScrollLock();
  document.removeEventListener("keydown", handleModalKeydown);
  if (modalTriggerEl && typeof modalTriggerEl.focus === "function") {
    modalTriggerEl.focus();
  }
}

/* ==========================================================================
   "Choose your display name" — shown when a brand-new user's only name
   candidate (Google's display name, or none at all) isn't usable, because
   it's already taken on this site or missing entirely. Not dismissable by
   backdrop/X: there's no profile yet for this uid, so there's nothing
   sensible to "cancel" back to — Escape and the secondary link both just
   sign the user back out instead.
   ========================================================================== */

let chooseNameEls = null;
let chooseNameUser = null;
let chooseNameCheckToken = 0;

function buildChooseNameModal() {
  const overlay = document.createElement("div");
  overlay.className = "auth-modal-overlay";
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="choose-name-title">
      <h2 class="auth-modal-title" id="choose-name-title">Choose your display name</h2>
      <p class="auth-modal-lede">That name is already taken on PerthSanta Streaming — pick another to finish setting up your account.</p>

      <form class="auth-form" novalidate>
        <div class="auth-field">
          <label for="choose-name-input">Display name</label>
          <input type="text" id="choose-name-input" autocomplete="name" />
          <p class="name-availability" id="choose-name-status" role="status" hidden></p>
        </div>

        <button type="submit" class="btn btn-primary" id="choose-name-submit" disabled>Continue</button>
      </form>

      <p class="auth-modal-secondary-action">
        <button type="button" id="choose-name-signout">Sign out instead</button>
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  const els = {
    overlay,
    dialog: overlay.querySelector(".auth-modal"),
    lede: overlay.querySelector(".auth-modal-lede"),
    form: overlay.querySelector(".auth-form"),
    input: overlay.querySelector("#choose-name-input"),
    status: overlay.querySelector("#choose-name-status"),
    submitBtn: overlay.querySelector("#choose-name-submit"),
    signOutBtn: overlay.querySelector("#choose-name-signout")
  };
  chooseNameEls = els;

  function setStatus(message, variant) {
    els.status.hidden = !message;
    els.status.textContent = message || "";
    els.status.className = "name-availability" + (variant ? ` name-availability--${variant}` : "");
  }

  let lastCheckedAsAvailable = null;

  els.input.addEventListener("input", () => {
    lastCheckedAsAvailable = null;
    els.submitBtn.disabled = true;
    const token = ++chooseNameCheckToken;
    const value = els.input.value;

    const format = validateDisplayNameValue(value);
    if (!format.ok) {
      setStatus(value.trim() ? format.message : "", "invalid");
      return;
    }

    setStatus("Checking availability…");
    checkDisplayNameAvailability(value, chooseNameUser && chooseNameUser.uid).then((result) => {
      if (token !== chooseNameCheckToken) return; // a newer keystroke superseded this check
      if (result.status === "available") {
        lastCheckedAsAvailable = format.value;
        setStatus("✓ Available", "available");
        els.submitBtn.disabled = false;
      } else if (result.status === "unknown") {
        // Fail open — Continue stays enabled; the transaction at submit
        // time is the real authority and will catch a genuine collision.
        lastCheckedAsAvailable = format.value;
        setStatus(result.message, "invalid");
        els.submitBtn.disabled = false;
      } else {
        setStatus(result.message, "taken");
      }
    });
  });

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!lastCheckedAsAvailable || els.submitBtn.disabled) return;

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "Continuing…";
    try {
      const outcome = await handleFirstSignIn(chooseNameUser, lastCheckedAsAvailable);
      if (outcome.ok) {
        updateProfile(chooseNameUser, { displayName: lastCheckedAsAvailable }).catch((error) => {
          console.error("[auth] could not sync Auth displayName", error);
        });
        closeChooseNameModal();
      }
      // outcome.needsName (lost a last-second race) re-opens this same
      // modal via openChooseNameModal() inside handleFirstSignIn, which
      // already refreshes the lede/status — nothing else to do here.
    } catch (error) {
      console.error("[auth] could not finish account setup", error);
      setStatus("Something went wrong. Please try again.", "taken");
    } finally {
      els.submitBtn.textContent = "Continue";
      els.submitBtn.disabled = !lastCheckedAsAvailable;
    }
  });

  els.signOutBtn.addEventListener("click", async () => {
    closeChooseNameModal();
    try {
      await signOutUser();
    } catch (error) {
      console.error("[auth] sign-out failed", error);
    }
  });
}

function handleChooseNameKeydown(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  chooseNameEls.signOutBtn.click();
}

function openChooseNameModal(user, attemptedName) {
  if (!chooseNameEls) buildChooseNameModal();
  chooseNameUser = user;

  chooseNameEls.lede.textContent = attemptedName
    ? `"${attemptedName}" is already taken on PerthSanta Streaming — pick another to finish setting up your account.`
    : "Pick a display name to finish setting up your account.";
  chooseNameEls.form.reset();
  chooseNameEls.status.hidden = true;
  chooseNameEls.submitBtn.disabled = true;
  chooseNameEls.submitBtn.textContent = "Continue";

  chooseNameEls.overlay.hidden = false;
  updateBodyScrollLock();
  document.addEventListener("keydown", handleChooseNameKeydown);
  requestAnimationFrame(() => chooseNameEls.input.focus());
}

function closeChooseNameModal() {
  if (!chooseNameEls || chooseNameEls.overlay.hidden) return;
  chooseNameEls.overlay.hidden = true;
  updateBodyScrollLock();
  document.removeEventListener("keydown", handleChooseNameKeydown);
  chooseNameUser = null;
}

/* ==========================================================================
   Boot
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  buildHeaderControl();
  if (authResolvedOnce) renderHeaderState();
});

export {
  getCurrentUser,
  getCurrentUserProfile,
  isProfileLoaded,
  safeDomiiaField,
  safeProgressField,
  onAuthChange,
  requireAuth,
  openAuthModal,
  closeAuthModal,
  signOutUser,
  renameDisplayName,
  checkDisplayNameAvailability,
  validateDisplayNameValue
};

window.PSAuth = {
  getCurrentUser,
  getCurrentUserProfile,
  isProfileLoaded,
  safeDomiiaField,
  safeProgressField,
  onAuthChange,
  requireAuth,
  openAuthModal,
  closeAuthModal,
  signOutUser,
  renameDisplayName,
  checkDisplayNameAvailability,
  validateDisplayNameValue
};
