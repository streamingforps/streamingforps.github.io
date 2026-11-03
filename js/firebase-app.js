/*
  Firebase app singleton — shared by every script that touches Firebase.
  ------------------------------------------------------------------
  The modular Firebase SDK throws if initializeApp() is called twice for
  the same (default) app within one page. Public pages now load more than
  one Firebase-using module (js/auth.js + js/firestore-content.js), so
  initialization has to happen exactly once, here, and be imported by
  every other module instead of each calling initializeApp() itself.

  getApps().length guards against double-init even if this module is
  somehow evaluated twice (e.g. imported with different cache-busting
  query strings) — it reuses whatever app already exists instead of
  throwing.
*/
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

import { firebaseConfig } from "./firebase-config.js";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Must match the region every Cloud Function in functions/index.js is
// deployed to (set there via setGlobalOptions) — a mismatched region here
// would make every callable silently 404.
export const functions = getFunctions(app, "asia-southeast1");
