/*
  PerthSanta Streaming — cosmetic application + equip API (Step 6, extended
  Step 10.6 for responsive background variants).
  ------------------------------------------------------------------
  Two separate concerns live here:

  1. applyCosmeticsToPage(profile) — called by js/auth.js on EVERY public
     page, every time the realtime users/{uid} profile snapshot updates
     (so equipping something updates the page immediately, with no
     reload, from wherever the equip happened). Applies:
       - selectedTheme: a THEME_KEY (never raw CSS) validated against a
         fixed client-side allow-list, reflected as a single attribute on
         <html> — the actual color values live in css/style.css as
         `:root[data-cosmetic-theme="..."] { ... }` blocks. This is what
         keeps "no arbitrary CSS from Firestore" airtight: even if
         Firestore held something unexpected, only a recognized key can
         ever become a real visual change, and that change is a static,
         reviewed stylesheet rule, never injected/eval'd style text.
       - selectedBackground: a background cosmetic can need TWO asset
         variants (desktop/landscape, mobile/portrait), so this now holds
         the STABLE COSMETIC ID (never a device-specific asset path) — see
         the "Responsive background resolution" section below for how that
         ID becomes actual image URLs. A legacy literal asset path (from
         before this existed) is still recognized and applied as-is to
         both devices, for backward compatibility — see isLikelyCosmeticId.

  2. equipCosmetic(cosmeticId) / unequipCosmetic(type) /
     syncAchievementCosmetics() — thin callable wrappers used by
     profile.html's Customize Profile UI. All real verification (does the
     user own this, is it active, what type is it, is the themeKey
     recognized) happens server-side in functions/cosmeticLogic.js — this
     file never trusts or re-implements any of that client-side.
*/

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { functions, db } from "./firebase-app.js";

/* ==========================================================================
   Theme registry — ONLY these keys may ever be reflected as the
   data-cosmetic-theme attribute. Keep in sync with
   functions/cosmeticLogic.js's KNOWN_THEME_KEYS and with the matching
   `:root[data-cosmetic-theme="..."]` block(s) in css/style.css.
   ========================================================================== */
const KNOWN_THEME_KEYS = new Set([
  "purple-night",
  "heartbound-red",
  "midnight-blue",
  "golden-supporter",
  "soft-pink",
  "domiia-night"
]);

// Same convention as js/domiia.js's own basePrefix() — each shared
// component file carries its own tiny copy rather than cross-importing a
// five-line helper (every file here is meant to be safely includable on
// its own). Derives how deep the current page is nested (e.g. "../" for
// guides/*.html) from the page's own .site-logo link.
function basePrefix() {
  const logo = document.querySelector(".site-logo");
  const href = (logo && logo.getAttribute("href")) || "index.html";
  return href.endsWith("index.html") ? href.slice(0, -"index.html".length) : "";
}

// Cosmetic asset paths are always stored site-root-relative, same
// convention as every other asset path in this codebase (favicon,
// domiia-token.png, etc.) — never absolute/https, so this always needs
// basePrefix() to resolve correctly from a nested page like guides/*.html.
// Already-absolute values (http(s):/data:) pass through untouched, purely
// defensive (selectedAvatar can still legitimately hold a Google photoURL
// instead of a cosmetic path).
function resolveAssetUrl(rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return null;
  if (/^(https?:|data:)/i.test(rawPath)) return rawPath;
  return `${basePrefix()}${rawPath}`;
}

function applySelectedTheme(selectedTheme) {
  const root = document.documentElement;
  if (typeof selectedTheme === "string" && KNOWN_THEME_KEYS.has(selectedTheme)) {
    root.setAttribute("data-cosmetic-theme", selectedTheme);
  } else {
    root.removeAttribute("data-cosmetic-theme");
  }
}

/* ==========================================================================
   Responsive background resolution (Step 10.6)
   ------------------------------------------------------------------
   One background COSMETIC now carries two asset variants (desktop/
   landscape, mobile/portrait) rather than two separate unlockable
   cosmetics. selectedBackground therefore stores the cosmetic's stable ID,
   and this module resolves that ID to actual URLs by reading the ONE
   cosmetic definition doc it names (cosmetics/{id} is public-read — see
   firestore.rules). Definitions change rarely, so results are cached by
   ID for the lifetime of the page, same "load once, nothing here needs it
   reactively" convention profile.html's own cosmetic-definitions load
   already uses.
   ========================================================================== */
const backgroundVariantCache = new Map(); // cosmeticId -> {desktop, mobile, desktopPosition, mobilePosition}

// A legacy selectedBackground value (written before responsive variants
// existed) is a literal asset path or absolute URL — it contains a "/" or
// is already http(s)/data:. A cosmetic ID is a plain kebab-case slug with
// neither, so this cheaply and reliably tells the two apart without
// needing a schema-version flag anywhere.
function isLikelyCosmeticId(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("/") && !/^(https?:|data:)/i.test(value);
}

// Position values can come from an admin-authored Firestore doc, which is
// public-read — sanitize against a small fixed allow-list before it ever
// reaches a CSS custom property, the same "never arbitrary CSS from
// Firestore" posture applySelectedTheme already uses for themeKey.
const ALLOWED_BACKGROUND_POSITIONS = new Set([
  "center", "top", "bottom", "left", "right",
  "center top", "center bottom", "top center", "bottom center"
]);
function sanitizeBackgroundPosition(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ALLOWED_BACKGROUND_POSITIONS.has(normalized) ? normalized : null;
}

// Resolves a selectedBackground value (cosmeticId OR legacy literal path)
// to {desktop, mobile, desktopPosition, mobilePosition} — every field
// already carries the correct fallback chain (desktopAssetPath ->
// assetPath; mobileAssetPath -> desktopAssetPath -> assetPath), so callers
// never need to re-apply it. Never throws — any failure just resolves to
// "nothing", which applySelectedBackground treats as "use the default".
async function resolveBackgroundVariants(selectedBackground) {
  if (typeof selectedBackground !== "string" || !selectedBackground) return null;

  if (!isLikelyCosmeticId(selectedBackground)) {
    // Legacy literal asset path — the SAME single image on every device,
    // exactly the pre-Step-10.6 behavior, for anyone who equipped a
    // background before responsive variants existed.
    return { desktop: selectedBackground, mobile: selectedBackground, desktopPosition: null, mobilePosition: null };
  }

  if (backgroundVariantCache.has(selectedBackground)) {
    return backgroundVariantCache.get(selectedBackground);
  }

  let variants = { desktop: null, mobile: null, desktopPosition: null, mobilePosition: null };
  try {
    const snap = await getDoc(doc(db, "cosmetics", selectedBackground));
    if (snap.exists()) {
      const cosmetic = snap.data();
      const desktop = cosmetic.desktopAssetPath || cosmetic.assetPath || null;
      const mobile = cosmetic.mobileAssetPath || cosmetic.desktopAssetPath || cosmetic.assetPath || null;
      variants = {
        desktop,
        mobile,
        desktopPosition: sanitizeBackgroundPosition(cosmetic.desktopPosition),
        mobilePosition: sanitizeBackgroundPosition(cosmetic.mobilePosition)
      };
    }
  } catch (error) {
    console.error("[cosmetics] could not resolve background cosmetic", selectedBackground, error);
  }
  backgroundVariantCache.set(selectedBackground, variants);
  return variants;
}

// CSS custom properties are a special case for relative url()s: per spec,
// a url() token carried in a custom property is resolved relative to the
// STYLESHEET that contains the var() reference consuming it — NOT
// relative to the document the property was set from, and NOT relative to
// wherever the JS that called setProperty() runs. body.has-cosmetic-
// background's var(--cosmetic-bg-desktop) reference lives in
// css/style.css, so a relative value here (even one already correctly
// site-root/base-prefixed by resolveAssetUrl for <img src>-style usage)
// resolves against css/style.css's own location — producing a wrong
// "/css/assets/rewards/..." request, 404, regardless of which page or
// nesting depth set the property. Converting to a fully qualified
// absolute URL (reusing resolveAssetUrl's own document-relative result,
// then resolving THAT against the current document's location) sidesteps
// this entirely: an absolute URL has no relative base left to resolve
// against, so it behaves identically from a stylesheet, inline style, or
// anywhere else. Never duplicates resolveAssetUrl's own
// basePrefix/absolute-passthrough logic — this only adds the one extra
// step CSS custom properties specifically need on top of it.
function toAbsoluteUrl(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url, window.location.href).href;
  } catch (error) {
    return url;
  }
}

// Sets the two responsive CSS custom properties css/style.css's
// body.has-cosmetic-background rule + its mobile media-query override
// read from — the actual desktop/mobile SWITCH happens entirely in CSS
// (a plain @media query), so resizing the window needs no JS resize
// listener at all; the browser re-evaluates the media query and the
// `var()` reference on its own. Each axis (desktop/mobile) is resolved
// and applied INDEPENDENTLY: if one is missing, that axis simply shows no
// cosmetic image (falling back to the plain scrim/default look) while the
// other axis — if it DOES have an asset — still shows its real image. A
// portrait image is never stretched onto desktop or vice versa.
async function applySelectedBackground(selectedBackground) {
  const variants = await resolveBackgroundVariants(selectedBackground);
  const root = document.documentElement;

  const desktopUrl = variants ? toAbsoluteUrl(resolveAssetUrl(variants.desktop)) : null;
  const mobileUrl = variants ? toAbsoluteUrl(resolveAssetUrl(variants.mobile)) : null;

  if (!desktopUrl && !mobileUrl) {
    document.body.classList.remove("has-cosmetic-background");
    root.style.removeProperty("--cosmetic-bg-desktop");
    root.style.removeProperty("--cosmetic-bg-mobile");
    root.style.removeProperty("--cosmetic-bg-position-desktop");
    root.style.removeProperty("--cosmetic-bg-position-mobile");
    return;
  }

  root.style.setProperty("--cosmetic-bg-desktop", desktopUrl ? `url("${desktopUrl}")` : "none");
  root.style.setProperty("--cosmetic-bg-mobile", mobileUrl ? `url("${mobileUrl}")` : "none");
  root.style.setProperty("--cosmetic-bg-position-desktop", (variants && variants.desktopPosition) || "center");
  // Mobile's ultimate fallback (nothing configured at all) is "center top",
  // not "center" — portrait artwork typically has its subject/faces nearer
  // the top of the frame, and cropping from the bottom first keeps that
  // visible. Still inherits an explicit desktopPosition first if one is
  // set and mobilePosition isn't (unchanged) — this only changes what
  // happens when NEITHER is configured, a pure default/fallback change,
  // never a Firestore write.
  root.style.setProperty("--cosmetic-bg-position-mobile", (variants && (variants.mobilePosition || variants.desktopPosition)) || "center top");
  document.body.classList.add("has-cosmetic-background");
}

/*
  applyCosmeticsToPage(profile) -> void
  ------------------------------------------------------------------
  Safe to call with profile === null/undefined (signed-out, or not yet
  loaded) — reverts to the default theme/background in that case. Never
  throws; a missing/invalid field is just treated as "use the default".
*/
function applyCosmeticsToPage(profile) {
  applySelectedTheme(profile && profile.selectedTheme);
  // Fire-and-forget — applySelectedBackground is async only because
  // resolving a cosmeticId needs one Firestore read; it never throws
  // (internal try/catch), so this .catch is just a defensive backstop.
  applySelectedBackground(profile && profile.selectedBackground).catch((error) => {
    console.error("[cosmetics] applySelectedBackground failed", error);
  });
}

/* ==========================================================================
   Equip API — thin callable wrappers. Resolve to the Cloud Function's
   response, or throw the same error it threw (profile.html's customize UI
   is responsible for catching/displaying it) — unlike trackMissionAction,
   a failed equip IS something the user actively asked for and needs to
   know didn't work.
   ========================================================================== */

const equipCosmeticCallable = httpsCallable(functions, "equipCosmetic");
const syncAchievementCosmeticsCallable = httpsCallable(functions, "syncAchievementCosmetics");
const syncAchievementsCallable = httpsCallable(functions, "syncAchievements");

async function equipCosmetic(cosmeticId) {
  const response = await equipCosmeticCallable({ cosmeticId });
  return response.data;
}

async function unequipCosmetic(type) {
  const response = await equipCosmeticCallable({ cosmeticId: null, type });
  return response.data;
}

// Historical achievement reconciliation (fixes "I completed missions
// before the achievement system existed and First Steps is still
// locked") — see functions/achievementLogic.js. Call this BEFORE
// syncAchievementCosmetics: it already grants cosmetics for whatever it
// reconciles, so syncAchievementCosmetics only ever has the narrower
// "achievement already existed, cosmetic mapping added later" case left
// to repair.
async function syncAchievements() {
  const response = await syncAchievementsCallable({});
  return response.data;
}

async function syncAchievementCosmetics() {
  const response = await syncAchievementCosmeticsCallable({});
  return response.data;
}

export {
  applyCosmeticsToPage,
  equipCosmetic,
  unequipCosmetic,
  syncAchievements,
  syncAchievementCosmetics,
  KNOWN_THEME_KEYS,
  isLikelyCosmeticId,
  resolveBackgroundVariants
};
