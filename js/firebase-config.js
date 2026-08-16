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

  Imported as an ES module by js/admin.js (admin console) and
  js/firestore-content.js (public pages' Firestore fallback loader).
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
