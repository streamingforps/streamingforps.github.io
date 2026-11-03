/*
  Firestore content overrides — public pages.
  ------------------------------------------------------------------
  Loaded (as a module) after js/data.js, js/main.js, and js/campaigns.js on
  every public page. js/main.js already renders the whole page immediately
  from the siteData object defined in js/data.js — that happens first and
  is completely unaffected by anything in this file.

  This module then tries to fetch admin-managed content from Firestore in
  the background. For each collection/doc that loads successfully, it
  overrides the corresponding siteData value and re-runs the page's render
  functions (window.renderAllContent, exposed by js/main.js) so the swap
  from fallback -> live content happens automatically.

  If Firestore is slow, offline, empty, or errors out, every fetch below
  fails safe: the page simply keeps showing the js/data.js content it
  already rendered. A Firebase outage cannot break the public site.

  ------------------------------------------------------------------
  Campaign system + legacy compatibility layer
  ------------------------------------------------------------------
  campaigns/{id} is the canonical source for every campaign's identity,
  status, links, platforms, goBook targets, missions, quick links, and
  feature flags. It's fetched as a whole collection and merged over the
  siteData.campaigns fallback array by id — a live doc overrides its
  matching fallback entry field-by-field; a brand-new admin-created
  campaign with no fallback entry is simply appended.

  Heartbound is a normal campaign in that collection once
  `campaigns/heartbound` has been created (via the "Migrate Heartbound to
  Firestore" admin action). Until then, two older paths remain load-bearing
  for it specifically:

    - campaign/current  — while campaigns/heartbound doesn't exist yet,
      its title/subtitle/description/heroMessage/status/links fill in
      Heartbound's identity on top of the data.js fallback. The moment
      campaigns/heartbound exists, this path is no longer read at all.

    - campaign/goals, campaign/tiktokGoals, stats/tiktok — these remain
      the real source for Heartbound's YouTube/TikTok goal targets and
      current TikTok view count *regardless* of migration status, because
      the admin's "Streaming Goals" and "TikTok Views" panels still write
      to them. This is intentional and temporary until those are
      generalized per-campaign.

  data/youtube-stats.json (fetched by js/campaigns.js, not here) is
  unaffected by any of this — it's keyed off each campaign's own
  stats.youtubeStatsSource field, not a hardcoded path.
*/

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db as sharedDb } from "./firebase-app.js";

const FETCH_TIMEOUT_MS = 2500;
const COMMENT_HELPER_BATCH_SIZE = 40;

// Firestore instance comes from js/firebase-app.js, the single shared
// singleton for the whole page (also used by js/auth.js on public pages).
// Kept behind this function, rather than imported and used directly,
// purely so a Firebase init failure fails safe here too: every call site
// already treats a null db as "Firebase unavailable, keep data.js content".
function ensureFirebaseApp() {
  return sharedDb;
}

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

async function fetchCollectionDocs(db, path) {
  try {
    const snap = await withTimeout(getDocs(collection(db, path)), FETCH_TIMEOUT_MS);
    if (!snap) return [];
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn(`[firestore-content] Could not load collection "${path}" — using data.js fallback.`, error);
    return [];
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

  // site/settings.campaignPageImage (a single global "the campaign page's
  // image" setting from back when campaign.html only ever showed
  // Heartbound) is intentionally NOT applied here anymore. campaign.html's
  // hero image is now built entirely from the resolved campaign's own
  // `image` field (see js/campaigns.js renderCampaignHeroImage) into a
  // [data-campaign-image] container with no static <img> for a global
  // setting to target — reintroducing one here would just recreate the
  // "two sources of truth for one image" bug this file used to have.
  // This Firestore field is now unused; it's safe to leave as-is or clear
  // it from Site Settings whenever convenient.
}

function mergeCampaignFields(base, overrides) {
  if (!overrides) return base;
  const merged = { ...base };
  Object.keys(overrides).forEach((key) => {
    if (overrides[key] !== undefined) merged[key] = overrides[key];
  });
  return merged;
}

// Legacy status vocabulary -> new vocabulary. Only used for campaign/current,
// which may still contain "active"/"ended" from before this migration.
const LEGACY_STATUS_MAP = { active: "current", upcoming: "upcoming", ended: "previous" };

// Pre-migration compatibility only: fills Heartbound's identity fields from
// the legacy campaign/current doc. Never runs once campaigns/heartbound
// exists (see applyFirestoreOverrides below).
function applyLegacyHeartboundIdentity(heartbound, legacyCurrent) {
  if (!legacyCurrent) return heartbound;

  const merged = { ...heartbound, links: { ...heartbound.links } };
  if (legacyCurrent.title !== undefined) merged.title = legacyCurrent.title;
  if (legacyCurrent.subtitle !== undefined) merged.subtitle = legacyCurrent.subtitle;
  if (legacyCurrent.description !== undefined) merged.description = legacyCurrent.description;
  if (legacyCurrent.heroMessage !== undefined) merged.heroMessage = legacyCurrent.heroMessage;
  if (legacyCurrent.status !== undefined) {
    merged.status = LEGACY_STATUS_MAP[legacyCurrent.status] || merged.status;
  }
  if (legacyCurrent.primaryLink) merged.links.youtube = legacyCurrent.primaryLink;
  if (legacyCurrent.tiktokLink) merged.links.tiktok = legacyCurrent.tiktokLink;
  return merged;
}

// Always applies to Heartbound, migrated or not — campaign/goals,
// campaign/tiktokGoals, and stats/tiktok remain the real source for these
// three values until they're generalized per-campaign later.
function applyLegacyHeartboundStats(heartbound, legacyGoals, legacyTiktokGoals, legacyStatsTiktok) {
  const merged = {
    ...heartbound,
    goals: { ...heartbound.goals },
    stats: { ...heartbound.stats }
  };

  if (legacyGoals && Array.isArray(legacyGoals.items)) {
    merged.goals.youtube = legacyGoals.items.map((g) => ({ label: g.label, target: g.target }));
  }
  if (legacyTiktokGoals && Array.isArray(legacyTiktokGoals.items)) {
    merged.goals.tiktok = legacyTiktokGoals.items.map((g) => ({ label: g.label, target: g.target }));
  }
  if (legacyStatsTiktok && typeof legacyStatsTiktok.currentViews === "number") {
    merged.stats.tiktokCurrentViews = legacyStatsTiktok.currentViews;
  }

  return merged;
}

async function applyFirestoreOverrides() {
  if (typeof siteData === "undefined") return;

  const db = ensureFirebaseApp();
  if (!db) return;

  const [
    campaignDocs,
    legacyCampaignCurrent,
    legacyCampaignGoals,
    legacyCampaignTiktokGoals,
    legacyStatsTiktok,
    contentAnnouncements,
    contentFaq,
    contentMusic,
    siteSettings
  ] = await Promise.all([
    fetchCollectionDocs(db, "campaigns"),
    fetchDoc(db, "campaign/current"),
    fetchDoc(db, "campaign/goals"),
    fetchDoc(db, "campaign/tiktokGoals"),
    fetchDoc(db, "stats/tiktok"),
    fetchDoc(db, "content/announcements"),
    fetchDoc(db, "content/faq"),
    fetchDoc(db, "content/music"),
    fetchDoc(db, "site/settings")
  ]);

  // Merge the live `campaigns` collection over the data.js fallback array by
  // id — a live doc overrides its matching fallback entry field-by-field; a
  // brand-new admin-created campaign with no fallback entry is appended.
  const campaignDocsById = new Map(campaignDocs.map((d) => [d.id, d]));
  let mergedCampaigns = siteData.campaigns.map((fallback) =>
    mergeCampaignFields(fallback, campaignDocsById.get(fallback.id))
  );
  campaignDocsById.forEach((docData, id) => {
    if (!mergedCampaigns.some((c) => c.id === id)) {
      mergedCampaigns.push({ id, ...docData });
    }
  });

  // Heartbound compatibility layer — see the file header comment.
  const heartboundHasLiveDoc = campaignDocsById.has("heartbound");
  mergedCampaigns = mergedCampaigns.map((c) => {
    if (c.id !== "heartbound") return c;
    let result = c;
    if (!heartboundHasLiveDoc) {
      result = applyLegacyHeartboundIdentity(result, legacyCampaignCurrent);
    }
    result = applyLegacyHeartboundStats(result, legacyCampaignGoals, legacyCampaignTiktokGoals, legacyStatsTiktok);
    return result;
  });

  siteData.campaigns = mergedCampaigns;

  if (contentAnnouncements && Array.isArray(contentAnnouncements.items)) {
    siteData.announcements = contentAnnouncements.items;
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

  applySiteSettings(siteSettings);

  if (typeof window.renderAllContent === "function") {
    window.renderAllContent();
  }
}

applyFirestoreOverrides();

/* ==========================================================================
   Comment Helper — on-demand random phrase batch
   ------------------------------------------------------------------
   Called from js/campaigns.js (a classic script, no Firestore access of
   its own) whenever a fan clicks "Generate Comment" on a campaign whose
   features.commentHelper is enabled. Exposed on window since campaigns.js
   can't `import` this module.

   Same bounded-randomization approach as js/trending.js's phrase pool:
   each phrase carries a `randomKey` set once at creation, and this pulls
   one bounded batch (40) via a single-field range query starting from a
   random point, wrapping around when the key space runs out. That query
   only range-filters/orders on `randomKey` — a single field, which
   Firestore indexes automatically — so no composite index is required.
   `enabled` is deliberately NOT part of the query (an equality filter
   combined with a range filter on a different field would require a
   composite index); instead disabled phrases are filtered out of the
   result client-side, exactly like js/trending.js already does. The
   library is never fetched in full.
   ========================================================================== */

async function fetchCommentHelperBatch(campaignId) {
  const dbRef = ensureFirebaseApp();
  if (!dbRef) return null;

  const phrasesRef = collection(dbRef, `campaigns/${campaignId}/commentHelperPhrases`);
  const randomStart = Math.random();
  const merged = new Map();

  try {
    const firstQuery = query(
      phrasesRef,
      where("randomKey", ">=", randomStart),
      orderBy("randomKey"),
      limit(COMMENT_HELPER_BATCH_SIZE)
    );
    const firstSnap = await withTimeout(getDocs(firstQuery), FETCH_TIMEOUT_MS);
    if (firstSnap) firstSnap.docs.forEach((d) => merged.set(d.id, d));

    if (merged.size < COMMENT_HELPER_BATCH_SIZE) {
      const wrapQuery = query(phrasesRef, orderBy("randomKey"), limit(COMMENT_HELPER_BATCH_SIZE));
      const wrapSnap = await withTimeout(getDocs(wrapQuery), FETCH_TIMEOUT_MS);
      if (wrapSnap) wrapSnap.docs.forEach((d) => merged.set(d.id, d));
    }
  } catch (error) {
    console.warn(`[comment-helper] Could not load phrase batch for campaign "${campaignId}".`, error);
    return null;
  }

  return Array.from(merged.values())
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.enabled !== false && typeof p.text === "string" && p.text.length > 0);
}

window.fetchCommentHelperBatch = fetchCommentHelperBatch;
