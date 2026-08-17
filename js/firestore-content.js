/*
  Firestore content overrides — public pages.
  ------------------------------------------------------------------
  Loaded (as a module) after js/data.js and js/main.js on every public
  page. js/main.js already renders the whole page immediately from the
  siteData object defined in js/data.js — that happens first and is
  completely unaffected by anything in this file.

  This module then tries to fetch admin-managed content from Firestore
  in the background. For each collection that loads successfully, it
  overrides the corresponding siteData value and re-runs the page's
  render functions (window.renderAllContent, exposed by js/main.js) so
  the swap from fallback -> live content happens automatically.

  If Firestore is slow, offline, empty, or errors out, every fetch below
  fails safe: the page simply keeps showing the js/data.js content it
  already rendered. A Firebase outage cannot break the public site.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const FETCH_TIMEOUT_MS = 2500;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    );
  });
}

async function fetchDoc(db, path) {
  try {
    const snap = await withTimeout(getDoc(doc(db, path)), FETCH_TIMEOUT_MS);
    if (!snap || typeof snap.exists !== "function" || !snap.exists()) return null;
    return snap.data();
  } catch (error) {
    console.warn(`[firestore-content] Could not load "${path}" — using data.js fallback.`, error);
    return null;
  }
}

function applySiteSettings(settings) {
  if (!settings) return;

  if (settings.footerDescription) {
    document.querySelectorAll(".footer-brand-desc").forEach((el) => {
      el.textContent = settings.footerDescription;
    });
  }

  if (settings.footerAccountUrl) {
    document.querySelectorAll(".footer-brand-link").forEach((el) => {
      el.href = settings.footerAccountUrl;
    });
  }

  if (settings.profileImage) {
    document.querySelectorAll(".footer-brand-avatar").forEach((el) => {
      el.src = settings.profileImage;
    });
  }

  if (settings.homepageCampaignImage) {
    const el = document.querySelector("[data-field='homepage-campaign-image']");
    if (el) el.src = settings.homepageCampaignImage;
  }

  if (settings.campaignPageImage) {
    const el = document.querySelector("[data-field='campaign-page-image']");
    if (el) el.src = settings.campaignPageImage;
  }
}

async function applyFirestoreOverrides() {
  if (typeof siteData === "undefined") return;

  let app;
  let db;
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (error) {
    console.warn("[firestore-content] Firebase failed to initialize — using data.js content only.", error);
    return;
  }

  const [
    campaignCurrent,
    campaignGoals,
    campaignTiktokGoals,
    statsTiktok,
    contentAnnouncements,
    contentMissions,
    contentQuickLinks,
    contentPlatforms,
    contentFaq,
    contentMusic,
    contentCommentHelper,
    siteSettings
  ] = await Promise.all([
    fetchDoc(db, "campaign/current"),
    fetchDoc(db, "campaign/goals"),
    fetchDoc(db, "campaign/tiktokGoals"),
    fetchDoc(db, "stats/tiktok"),
    fetchDoc(db, "content/announcements"),
    fetchDoc(db, "content/missions"),
    fetchDoc(db, "content/quickLinks"),
    fetchDoc(db, "content/platforms"),
    fetchDoc(db, "content/faq"),
    fetchDoc(db, "content/music"),
    fetchDoc(db, "content/commentHelper"),
    fetchDoc(db, "site/settings")
  ]);

  const c = siteData.currentCampaign;

  // Campaign profile fields — plain scalar override.
  if (campaignCurrent) {
    if (campaignCurrent.title !== undefined) c.title = campaignCurrent.title;
    if (campaignCurrent.subtitle !== undefined) c.subtitle = campaignCurrent.subtitle;
    if (campaignCurrent.description !== undefined) c.description = campaignCurrent.description;
    if (campaignCurrent.heroMessage !== undefined) c.heroMessage = campaignCurrent.heroMessage;
    if (campaignCurrent.status !== undefined) c.status = campaignCurrent.status;
    if (campaignCurrent.primaryLink) c.primaryLink = campaignCurrent.primaryLink;
    if (campaignCurrent.tiktokLink) c.tiktokLink = campaignCurrent.tiktokLink;
  }

  // YouTube goal milestones — target/label only. "current" always comes
  // from data/youtube-stats.json inside loadAndRenderGoals(), never from
  // Firestore, so it's intentionally left out of this override entirely.
  if (campaignGoals && Array.isArray(campaignGoals.items)) {
    c.goals = campaignGoals.items.map((g) => ({ label: g.label, target: g.target, current: 0 }));
  }

  // TikTok goal milestones — target/label only, no "current" here either.
  if (campaignTiktokGoals && Array.isArray(campaignTiktokGoals.items)) {
    c.tiktokGoals = campaignTiktokGoals.items.map((g) => ({ label: g.label, target: g.target }));
  }

  // The single shared TikTok "current views" value every TikTok goal
  // card reads from.
  if (statsTiktok && typeof statsTiktok.currentViews === "number") {
    c.tiktokCurrentViews = statsTiktok.currentViews;
  }

  if (contentAnnouncements && Array.isArray(contentAnnouncements.items)) {
    siteData.announcements = contentAnnouncements.items;
  }

  if (contentMissions && Array.isArray(contentMissions.items)) {
    c.missions = contentMissions.items;
  }

  if (contentQuickLinks && Array.isArray(contentQuickLinks.items)) {
    c.quickLinks = contentQuickLinks.items;
  }

  if (contentPlatforms && Array.isArray(contentPlatforms.items)) {
    c.platforms = contentPlatforms.items;
  }

  if (contentFaq && Array.isArray(contentFaq.items)) {
    siteData.faq = contentFaq.items;
  }

  if (contentMusic) {
    siteData.music = {
      osts: Array.isArray(contentMusic.osts) ? contentMusic.osts : siteData.music.osts,
      perthsanta: Array.isArray(contentMusic.perthsanta) ? contentMusic.perthsanta : siteData.music.perthsanta,
      perthSolo: Array.isArray(contentMusic.perthSolo) ? contentMusic.perthSolo : siteData.music.perthSolo,
      jasper: Array.isArray(contentMusic.jasper) ? contentMusic.jasper : siteData.music.jasper
    };
  }

  if (contentCommentHelper && Array.isArray(contentCommentHelper.styles) && contentCommentHelper.phrases) {
    siteData.commentHelper = contentCommentHelper;
  }

  applySiteSettings(siteSettings);

  if (typeof window.renderAllContent === "function") {
    window.renderAllContent();
  }
}

applyFirestoreOverrides();
