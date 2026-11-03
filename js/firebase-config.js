/*
  Firebase web configuration — PerthSanta Streaming admin console.
  ------------------------------------------------------------------
  This identifies the Firebase PROJECT to the browser SDK. Per Firebase's
  own docs this value is not a secret and is safe to ship in frontend
  code — it is not the security boundary. The actual boundary is:

    1. Firebase Authentication (email/password, no public signup)
    2. Firestore Security Rules (public read, write restricted to
       ADMIN_UID below)

  Never add a password, API secret, or service-account key to this file.

  Imported as an ES module by js/admin.js (admin console),
  js/firestore-content.js (public pages' Firestore fallback loader), and
  js/cosmetics.js (admin cosmetic-testing override — see isAdminUser()
  below). ADMIN_UID itself is also duplicated, unavoidably, in
  firestore.rules' isAdmin() and functions/config.js's own ADMIN_UID — a
  Firestore rules file can't require() this module, and Cloud Functions
  can't import frontend js/ files, so this one identifier has to exist in
  all three places. Keep them in sync if it's ever rotated.
*/

export const firebaseConfig = {
    apiKey: "AIzaSyBz2cC_Q9Cvdv_6sg-hBW_hzPUg7J-qTO0",
    authDomain: "perthsanta-streaming.firebaseapp.com",
    projectId: "perthsanta-streaming",
    storageBucket: "perthsanta-streaming.firebasestorage.app",
    messagingSenderId: "799293130326",
    appId: "1:799293130326:web:9be086469f38db8cabddf7"
  };

// The only UID allowed to write, per Firestore Security Rules. Used by
// admin.js purely as a UX check (show/hide the dashboard) — it is NOT
// what enforces write permission. Firestore rules enforce that.
export const ADMIN_UID = "Y5r0wou7RITpiLjlitGZpnMfMiC2";

// Same UX-convenience-only caveat as above, now also used by the Profile
// customization UI (js/cosmetics.js) to show every active cosmetic as
// usable for the admin account — again NOT the security boundary for
// that: the equipCosmetic Cloud Function independently re-derives admin
// status from request.auth.uid against its own copy of this constant
// (functions/config.js) and would reject the bypass even if this check
// were ever bypassed or spoofed client-side.
export function isAdminUser(user) {
  return !!user && user.uid === ADMIN_UID;
}
