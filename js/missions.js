/*
  PerthSanta Streaming — Daily Missions page controller.
  ------------------------------------------------------------------
  Step 10: missions now belong to one of several independent DAILY SETS —
  exactly one GENERAL set (evergreen missions) and one set PER CURRENT
  CAMPAIGN (temporary priorities) — each rendered as its own section with
  its own summary card, own live X/Y, and own historical completion
  banner. See functions/missionLogic.js's file header for the full
  ACTION/MISSION/DAILY SET vocabulary this mirrors.

  Listeners owned here (all shared, never one per card/section):
    1. active mission DEFINITIONS (missions where active == true)
    2. the signed-in user's ENTIRE missionProgress subcollection
    3. the public `campaigns` collection (to find which are "current" —
       the SAME canonical status field campaigns-current.html uses, never
       a second current-campaign concept)
    4. the GENERAL dailyCompletions doc for today (+ a legacy fallback
       listener at the OLD global doc id, for compatibility with
       completions recorded before Step 10 — see subscribeGeneralDailyCompletion)
    5. one dailyCompletions listener PER CURRENT campaign, added/removed
       as the current-campaign set itself changes

  Mission progress numbers shown here come ONLY from the missionProgress
  listener (the authoritative Firestore state) — never from the
  recordMissionAction response, which this file only uses for a transient
  inline cooldown note per card. The completion toast is shown globally by
  js/mission-tracking.js (so it also fires when a mission completes from
  another page), not here. The existing realtime profile listener in
  js/auth.js is what updates the header/profile Domiia balance; this file
  never touches that UI directly.
*/

import { onAuthChange, openAuthModal, getCurrentUserProfile, safeProgressField } from "./auth.js";
import { db } from "./firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { renderDomiiaAmount, updateDomiiaAmount } from "./domiia.js";
import { wireTrackedLinks } from "./mission-tracking.js";

// Used only until the real site/gamification config resolves (see
// loadGamificationConfig below) and if that read fails/is invalid — the
// GENERAL set's bonus only; each campaign's own bonus comes straight off
// its own campaign document (no separate config read needed there).
const GAMIFICATION_CONFIG_FALLBACK_BONUS = 10;

/* ==========================================================================
   Bangkok date — READ-SIDE ONLY. See the Step 5-era comment this carries
   forward: never sent anywhere, never the authority for counting/
   rewarding — that's entirely server-side.
   ========================================================================== */
const bangkokFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function todayBangkokKey() {
  return bangkokFormatter.format(new Date());
}

// Mirrors functions/missionLogic.js's isRequiredDailyMission() — a
// mission counts toward "today's required set" if it's active, daily,
// and currently within its startsAt/endsAt window. Display-only: the
// backend recomputes this independently and is the sole authority on
// what actually counts — this just keeps each section's "X / Y completed
// today" summary honest instead of counting every active mission
// regardless of window.
function isRequiredToday(mission, now) {
  if (mission.frequency !== "daily") return false;
  const starts = mission.startsAt && typeof mission.startsAt.toDate === "function" ? mission.startsAt.toDate() : null;
  const ends = mission.endsAt && typeof mission.endsAt.toDate === "function" ? mission.endsAt.toDate() : null;
  if (starts && starts > now) return false;
  if (ends && ends < now) return false;
  return true;
}

// Step 10: every mission belongs to one daily SET — "general" or a
// specific campaign's. missionScope is the explicit field going forward;
// a mission saved before Step 10 never had it, so this falls back to
// inferring scope from campaignId — the SAME fallback functions/
// missionLogic.js and js/admin.js use, kept in sync by hand since this is
// a browser script (can't import the Cloud Function's copy, and admin.js
// is a separate plain script too).
function effectiveScope(mission) {
  if (mission.missionScope === "campaign" || mission.missionScope === "general") return mission.missionScope;
  return mission.campaignId ? "campaign" : "general";
}

// Step 10.5: mirrors functions/missionLogic.js's isRequiredForDailySet() —
// a mission counts toward (and can block) its daily set's completion only
// when this is true; defaults to true so a mission saved before this field
// existed keeps behaving exactly as before. Display-only, same convention
// as effectiveScope() above — the backend is the sole authority on what
// actually gates set completion.
function isRequiredForDailySet(mission) {
  return mission.requiredForDailySet !== false;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/* ==========================================================================
   DOM refs
   ========================================================================== */

const els = {
  signedOut: document.querySelector("[data-missions-signedout]"),
  signInBtn: document.querySelector("[data-missions-signin-btn]"),
  signedIn: document.querySelector("[data-missions-signedin]"),
  generalSection: document.querySelector("[data-general-section]"),
  campaignGroup: document.querySelector("[data-campaign-group]"),
  campaignGroupEyebrow: document.querySelector("[data-campaign-group-eyebrow]"),
  campaignSections: document.querySelector("[data-campaign-sections]")
};

if (els.signInBtn) {
  els.signInBtn.addEventListener("click", () => openAuthModal("signin", els.signInBtn));
}

/* ==========================================================================
   Gamification config — site/gamification.generalDailyCompletionBonus is
   the single source of truth for the GENERAL set's bonus shown here (the
   backend independently reads/validates the same doc). A one-time getDoc
   is enough: this value changes rarely and nothing else on this page
   needs it reactively.
   ========================================================================== */
let generalBonusAmount = GAMIFICATION_CONFIG_FALLBACK_BONUS;
async function loadGamificationConfig() {
  try {
    const snap = await getDoc(doc(db, "site", "gamification"));
    const raw = snap.exists() ? snap.data().generalDailyCompletionBonus : undefined;
    if (Number.isInteger(raw) && raw >= 0) generalBonusAmount = raw;
  } catch (error) {
    console.warn("[missions] could not load site/gamification config — using fallback", error);
  }
  render();
}
loadGamificationConfig();

/* ==========================================================================
   State + listeners
   ========================================================================== */

let activeMissions = [];
let progressByMissionId = {};
let campaignsRaw = []; // every campaigns/{id} doc, unfiltered
let generalDailyCompletion = null; // preferred (general_{dateKey}) or legacy ({dateKey}) fallback — see subscribeGeneralDailyCompletion
const campaignDailyCompletion = new Map(); // campaignId -> data|null, only for CURRENT campaigns

let currentUid = null;
let missionsUnsub = null;
let progressUnsub = null;
let campaignsUnsub = null;
let generalCompletionUnsub = null;
let generalLegacyCompletionUnsub = null;
const campaignCompletionUnsubs = new Map(); // campaignId -> unsubscribe fn

function subscribeMissions() {
  if (missionsUnsub) return; // already subscribed — definitions don't depend on which user is signed in
  const activeMissionsQuery = query(collection(db, "missions"), where("active", "==", true));
  missionsUnsub = onSnapshot(
    activeMissionsQuery,
    (snap) => {
      activeMissions = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));
      render();
    },
    (error) => console.error("[missions] could not load active missions", error)
  );
}

// Public data, same as campaigns-current.html's own source — loaded once
// per page (not tied to sign-in) since campaign IDENTITY/status is public
// regardless of who's viewing.
function subscribeCampaigns() {
  if (campaignsUnsub) return;
  campaignsUnsub = onSnapshot(
    collection(db, "campaigns"),
    (snap) => {
      campaignsRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      syncCampaignCompletionListeners();
      render();
    },
    (error) => console.error("[missions] could not load campaigns", error)
  );
}

function currentCampaigns() {
  // The SAME canonical "current" rule campaigns-current.html uses (spec
  // section 26) — never a second current-campaign concept invented here.
  return campaignsRaw.filter((c) => c.status === "current");
}

function subscribeProgress(uid) {
  unsubscribeProgress();
  progressUnsub = onSnapshot(
    collection(db, "users", uid, "missionProgress"),
    (snap) => {
      const todayKey = todayBangkokKey();
      const map = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.dateKey === todayKey) map[data.missionId] = data;
      });
      progressByMissionId = map;
      render();
    },
    (error) => console.error("[missions] could not load mission progress", error)
  );
}

function unsubscribeProgress() {
  if (progressUnsub) {
    progressUnsub();
    progressUnsub = null;
  }
  progressByMissionId = {};
}

// The daily bonus/streak/achievement cascade is final once recorded — so
// "is the GENERAL set complete" must come from this authoritative record,
// NOT be re-derived from "are all CURRENTLY required general missions
// showing completed right now". A legacy doc at the OLD global
// dailyCompletions/{dateKey} id (recorded before Step 10 split the single
// daily set into General + per-campaign sets) counts as a historical
// GENERAL completion too (spec sections 41, 54) — preferred over the new
// general_{dateKey} doc only when the new one doesn't exist, so a day
// that's already been migrated/re-recorded under the new id is never
// shadowed by a stale legacy doc.
function subscribeGeneralDailyCompletion(uid) {
  unsubscribeGeneralDailyCompletion();
  const todayKey = todayBangkokKey();
  let newDoc = null;
  let legacyDoc = null;
  const recompute = () => {
    generalDailyCompletion = newDoc || legacyDoc;
    render();
  };
  generalCompletionUnsub = onSnapshot(
    doc(db, "users", uid, "dailyCompletions", `general_${todayKey}`),
    (snap) => {
      newDoc = snap.exists() ? snap.data() : null;
      recompute();
    },
    (error) => console.error("[missions] could not load today's general daily completion", error)
  );
  generalLegacyCompletionUnsub = onSnapshot(
    doc(db, "users", uid, "dailyCompletions", todayKey),
    (snap) => {
      legacyDoc = snap.exists() ? snap.data() : null;
      recompute();
    },
    (error) => console.error("[missions] could not load today's legacy daily completion", error)
  );
}

function unsubscribeGeneralDailyCompletion() {
  if (generalCompletionUnsub) {
    generalCompletionUnsub();
    generalCompletionUnsub = null;
  }
  if (generalLegacyCompletionUnsub) {
    generalLegacyCompletionUnsub();
    generalLegacyCompletionUnsub = null;
  }
  generalDailyCompletion = null;
}

// One listener per CURRENT campaign, added/removed as that set itself
// changes (a campaign going current/no-longer-current, Step 10 spec
// section 56) — never one per campaign that has ever existed.
function syncCampaignCompletionListeners() {
  if (!currentUid) return;
  const todayKey = todayBangkokKey();
  const currentIds = new Set(currentCampaigns().map((c) => c.id));

  campaignCompletionUnsubs.forEach((unsub, campaignId) => {
    if (currentIds.has(campaignId)) return;
    unsub();
    campaignCompletionUnsubs.delete(campaignId);
    campaignDailyCompletion.delete(campaignId);
  });

  currentIds.forEach((campaignId) => {
    if (campaignCompletionUnsubs.has(campaignId)) return;
    const unsub = onSnapshot(
      doc(db, "users", currentUid, "dailyCompletions", `campaign_${campaignId}_${todayKey}`),
      (snap) => {
        campaignDailyCompletion.set(campaignId, snap.exists() ? snap.data() : null);
        render();
      },
      (error) => console.error(`[missions] could not load today's ${campaignId} daily completion`, error)
    );
    campaignCompletionUnsubs.set(campaignId, unsub);
  });
}

function unsubscribeAllCampaignCompletionListeners() {
  campaignCompletionUnsubs.forEach((unsub) => unsub());
  campaignCompletionUnsubs.clear();
  campaignDailyCompletion.clear();
}

/* ==========================================================================
   Mission card (unchanged from Step 5/9 — per-mission concerns are
   independent of which daily SET a mission belongs to).
   ========================================================================== */

function getMissionActionUrl(mission) {
  const url = typeof mission.destinationUrl === "string" ? mission.destinationUrl.trim() : "";
  return /^https?:\/\//i.test(url) ? url : null;
}

function buildMissionCard(mission) {
  const progress = progressByMissionId[mission.id];
  const completed = !!(progress && progress.completed);
  const current = progress ? Number(progress.progress) || 0 : 0;

  // Once completed, target is FROZEN to the snapshot stored on the
  // progress doc itself at the moment it completed — never the live
  // mission definition, which admin may have since changed. Unfinished
  // missions always follow the current/live mission definition.
  const target = completed
    ? (Number(progress.target) || 0)
    : (Number(mission.target) || 0);

  const card = document.createElement("article");
  card.className = "mission-card";
  card.dataset.missionId = mission.id;

  const title = document.createElement("h2");
  title.className = "mission-card-title";
  title.textContent = mission.title;
  card.appendChild(title);

  if (mission.description) {
    const desc = document.createElement("p");
    desc.className = "mission-card-desc";
    desc.textContent = mission.description;
    card.appendChild(desc);
  }

  const progressRow = document.createElement("div");
  progressRow.className = "mission-card-progress-row";
  const progressLabel = document.createElement("span");
  progressLabel.className = "mission-card-progress-label";
  progressLabel.textContent = completed ? "✓ Completed" : "Progress";
  const progressValue = document.createElement("span");
  progressValue.className = "mission-card-progress-value";
  progressValue.textContent = `${current} / ${target}`;
  progressRow.append(progressLabel, progressValue);
  card.appendChild(progressRow);

  const track = document.createElement("div");
  track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.width = `${target > 0 ? Math.min(100, (current / target) * 100) : 0}%`;
  track.appendChild(fill);
  card.appendChild(track);

  const rewardRow = document.createElement("div");
  rewardRow.className = "mission-card-reward-row";
  const rewardLabel = document.createElement("span");
  rewardLabel.className = "mission-card-reward-label";
  rewardLabel.textContent = "Reward";
  rewardRow.append(rewardLabel, renderDomiiaAmount(mission.rewardDomiias, { size: "medium" }));
  card.appendChild(rewardRow);

  const actionUrl = getMissionActionUrl(mission);
  const actionBtn = document.createElement("a");
  actionBtn.className = "btn btn-primary mission-card-action";
  if (actionUrl) {
    actionBtn.href = actionUrl;
    actionBtn.target = "_blank";
    actionBtn.rel = "noopener noreferrer";
    actionBtn.setAttribute("data-track-action", mission.actionId);
    actionBtn.textContent = completed ? "Stream Again" : mission.title;
  } else {
    actionBtn.setAttribute("aria-disabled", "true");
    actionBtn.textContent = "Link unavailable";
  }
  card.appendChild(actionBtn);

  const statusEl = document.createElement("p");
  statusEl.className = "mission-card-status";
  statusEl.setAttribute("data-mission-card-status", "");
  statusEl.setAttribute("role", "status");
  statusEl.hidden = true;
  card.appendChild(statusEl);

  return card;
}

/* ==========================================================================
   Daily-set section — one of these per General + per visible current
   campaign. Builds a fresh summary-card + mission-list DOM subtree each
   render (same "rebuild from state" convention the original single-
   section page always used) rather than a static HTML template, since the
   number of campaign sections is dynamic.
   ========================================================================== */

function emptyMessageFor() {
  return "No active missions right now. Check back soon!";
}

function renderSection({
  container,
  label,            // "General" or the campaign's title, used in the bonus-row copy
  headingHtml,      // full heading markup for this section
  missions,         // this set's mission DEFINITIONS
  completionDoc,    // this set's dailyCompletions data, or null
  pendingBonusAmount, // Domiia amount to show in the PENDING row
  showStreak,       // only the General section shows the streak chip
  requiredSubsectionLabel, // "Daily Goals" / "Campaign Goals"
  optionalSubsectionLabel  // "More Ways to Support" / "Additional Support"
}) {
  const now = new Date();
  // Step 10.5: only missions that both fall in today's window AND are
  // flagged requiredForDailySet can block/count toward this set's
  // completion — mirrors functions/missionLogic.js's requiredByGroup
  // filter exactly, so this summary's X/Y never disagrees with what the
  // backend actually requires to pay the completion bonus.
  const requiredToday = missions.filter((m) => isRequiredToday(m, now) && isRequiredForDailySet(m));
  const setComplete = !!(completionDoc && completionDoc.completed);

  // ALWAYS live — current mission set + today's progress docs. Never the
  // frozen completionDoc counts (that was the exact bug a mid-day mission
  // add/remove previously caused — see the Daily Missions summary fix).
  const liveMissionCount = requiredToday.length;
  const liveCompletedCount = requiredToday.filter((m) => {
    const p = progressByMissionId[m.id];
    return !!(p && p.completed);
  }).length;

  container.innerHTML = "";
  if (headingHtml) container.insertAdjacentHTML("beforeend", headingHtml);

  if (!missions.length) {
    const empty = document.createElement("p");
    empty.className = "cosmetic-section-status";
    empty.textContent = emptyMessageFor();
    container.appendChild(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "daily-summary";

  const top = document.createElement("div");
  top.className = "daily-summary-top";
  const summaryText = document.createElement("p");
  summaryText.className = "missions-summary";
  summaryText.textContent = `${liveCompletedCount} / ${liveMissionCount} completed today`;
  top.appendChild(summaryText);

  if (showStreak) {
    const profile = getCurrentUserProfile();
    const currentStreak = safeProgressField(profile, "currentStreak", 0);
    if (currentStreak > 0) {
      const streakEl = document.createElement("p");
      streakEl.className = "daily-streak";
      streakEl.textContent = `🔥 ${currentStreak} day streak`;
      top.appendChild(streakEl);
    }
  }
  summary.appendChild(top);

  const track = document.createElement("div");
  track.className = "progress-track daily-summary-track";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.width = `${liveMissionCount > 0 ? Math.min(100, (liveCompletedCount / liveMissionCount) * 100) : 0}%`;
  track.appendChild(fill);
  summary.appendChild(track);

  const pendingRow = document.createElement("div");
  pendingRow.className = "daily-bonus-row";
  pendingRow.hidden = setComplete || liveMissionCount === 0;
  const pendingLabel = document.createElement("span");
  pendingLabel.textContent = `Complete all ${label} missions today`;
  const pendingReward = document.createElement("span");
  pendingReward.className = "daily-bonus-reward";
  pendingReward.appendChild(document.createTextNode("Reward: "));
  pendingReward.appendChild(renderDomiiaAmount(pendingBonusAmount, { size: "small" }));
  pendingRow.append(pendingLabel, pendingReward);
  summary.appendChild(pendingRow);

  const completeRow = document.createElement("div");
  completeRow.className = "daily-bonus-row daily-bonus-row--complete";
  completeRow.hidden = !setComplete;
  const completeLabel = document.createElement("span");
  completeLabel.textContent = `✓ ${label} daily set complete`;
  const completeEarned = document.createElement("span");
  completeEarned.className = "daily-bonus-reward";
  if (setComplete) {
    // The actual recorded amount, not whatever config currently says —
    // historical records are final.
    completeEarned.appendChild(renderDomiiaAmount(Number(completionDoc.baseBonusDomiias) || 0, { size: "small" }));
    completeEarned.appendChild(document.createTextNode(" bonus earned"));
  }
  completeRow.append(completeLabel, completeEarned);
  summary.appendChild(completeRow);

  container.appendChild(summary);

  // Step 10.5: visually separate required ("Daily Goals"/"Campaign Goals")
  // from optional ("More Ways to Support"/"Additional Support") missions
  // within this one set — they still share the same bonus/streak above,
  // this is purely a display grouping so an optional bonus mission never
  // reads as something the admin forgot to mark required. If there are no
  // optional missions in this set, skip the subsection headings entirely
  // and render one plain list, exactly as before Step 10.5.
  const requiredMissions = missions.filter((m) => isRequiredForDailySet(m));
  const optionalMissions = missions.filter((m) => !isRequiredForDailySet(m));

  function appendMissionList(missionList) {
    const list = document.createElement("div");
    list.className = "missions-list";
    missionList.forEach((mission) => list.appendChild(buildMissionCard(mission)));
    container.appendChild(list);
    return list;
  }

  const builtLists = [];
  if (optionalMissions.length) {
    if (requiredMissions.length) {
      const requiredHeading = document.createElement("h3");
      requiredHeading.className = "mission-subsection-heading";
      requiredHeading.textContent = requiredSubsectionLabel;
      const requiredWrap = document.createElement("div");
      requiredWrap.className = "mission-subsection";
      requiredWrap.appendChild(requiredHeading);
      container.appendChild(requiredWrap);
      const requiredList = document.createElement("div");
      requiredList.className = "missions-list";
      requiredMissions.forEach((mission) => requiredList.appendChild(buildMissionCard(mission)));
      requiredWrap.appendChild(requiredList);
      builtLists.push(requiredList);
    }

    const optionalHeading = document.createElement("h3");
    optionalHeading.className = "mission-subsection-heading";
    optionalHeading.textContent = optionalSubsectionLabel;
    const optionalWrap = document.createElement("div");
    optionalWrap.className = "mission-subsection";
    optionalWrap.appendChild(optionalHeading);
    container.appendChild(optionalWrap);
    const optionalList = document.createElement("div");
    optionalList.className = "missions-list";
    optionalMissions.forEach((mission) => optionalList.appendChild(buildMissionCard(mission)));
    optionalWrap.appendChild(optionalList);
    builtLists.push(optionalList);
  } else {
    builtLists.push(appendMissionList(missions));
  }

  builtLists.forEach((list) => wireTrackedLinks(list, handleTrackResult));
}

function render() {
  if (!els.generalSection || !els.campaignSections || !els.campaignGroup) return;

  // Step 11: Campaign missions are the PRIORITY — this group is built and
  // inserted into the DOM FIRST (real semantic order, not a CSS `order`
  // trick), and the General group always follows it, both as static
  // markup in missions.html with their own top-level headings (never one
  // shared container the two sections both live inside).
  const now = new Date();
  const campaignMissionsById = new Map();
  activeMissions
    .filter((m) => effectiveScope(m) === "campaign" && m.campaignId)
    .forEach((m) => {
      if (!campaignMissionsById.has(m.campaignId)) campaignMissionsById.set(m.campaignId, []);
      campaignMissionsById.get(m.campaignId).push(m);
    });

  // Only CURRENT campaigns that actually have at least one required-today
  // mission get a section — a current campaign contributing nothing is
  // hidden entirely rather than shown empty (spec section 7/25), which is
  // also what lets General naturally become the first visible section
  // when there's nothing to show here at all.
  const visibleCampaigns = currentCampaigns()
    .filter((c) => (campaignMissionsById.get(c.id) || []).some((m) => isRequiredToday(m, now)))
    .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));

  els.campaignGroup.hidden = visibleCampaigns.length === 0;
  if (els.campaignGroupEyebrow) {
    els.campaignGroupEyebrow.textContent = visibleCampaigns.length > 1 ? "CURRENT CAMPAIGNS" : "CURRENT CAMPAIGN";
  }

  els.campaignSections.innerHTML = "";
  visibleCampaigns.forEach((campaign) => {
    const section = document.createElement("section");
    section.className = "daily-set-section daily-set-section--campaign";
    els.campaignSections.appendChild(section);

    const campaignLabel = campaign.title || campaign.id;
    // h3 — nested under the group's own h2 ("Current Campaign Missions"),
    // per spec section 19's real heading hierarchy (never a visual-only
    // div standing in for a heading). An optional one-line tagline (spec
    // section 17) rides along if the campaign has a short `subtitle`;
    // never the long-form `description`, which belongs on campaign.html,
    // not a mission-focused card.
    const headingHtml = `
      <h3 class="daily-set-campaign-title">${escapeHtml(campaignLabel)}</h3>
      ${campaign.subtitle ? `<p class="daily-set-campaign-tagline">${escapeHtml(campaign.subtitle)}</p>` : ""}
    `;

    renderSection({
      container: section,
      // Raw (NOT HTML-escaped) — this flows into .textContent below,
      // which is always safe on its own; escaping it here too would
      // double-escape and show literal "&amp;" etc. in the UI. Only the
      // innerHTML heading above needs escapeHtml().
      label: campaignLabel,
      headingHtml,
      missions: campaignMissionsById.get(campaign.id) || [],
      completionDoc: campaignDailyCompletion.get(campaign.id) || null,
      pendingBonusAmount: Number(campaign.dailyMissionBonus) || 0,
      showStreak: false,
      requiredSubsectionLabel: "Campaign Goals",
      optionalSubsectionLabel: "Additional Support"
    });
  });

  const generalMissions = activeMissions.filter((m) => effectiveScope(m) === "general");
  renderSection({
    container: els.generalSection,
    label: "General",
    // No heading here — "General Daily Missions" + its subtler subtitle
    // are static markup in missions.html now (spec section 4: visually
    // de-emphasized, no "current"/urgency styling), always present
    // regardless of mission count, unlike the Campaign group above.
    headingHtml: null,
    missions: generalMissions,
    completionDoc: generalDailyCompletion,
    pendingBonusAmount: generalBonusAmount,
    showStreak: true,
    requiredSubsectionLabel: "Daily Goals",
    optionalSubsectionLabel: "More Ways to Support"
  });
}

// Campaign titles are admin-authored free text inserted via innerHTML
// (the heading markup above) — escape to avoid any accidental markup
// injection from a title containing "<"/"&".
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ==========================================================================
   Feedback: inline cooldown note (subtle, not an error) only.
   ========================================================================== */

function handleTrackResult(el, result) {
  const card = el.closest(".mission-card");
  const statusEl = card && card.querySelector("[data-mission-card-status]");

  if (result.reason === "cooldown") {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Stream opened. This action can count again in ${formatDuration(result.retryAfterSeconds)}.`;
    }
    return;
  }

  if (statusEl) statusEl.hidden = true;
}

/* ==========================================================================
   Auth-driven signed-in/out switch
   ========================================================================== */

subscribeCampaigns(); // public — loads regardless of sign-in state

onAuthChange((user) => {
  if (!els.signedOut || !els.signedIn) return;

  currentUid = user ? user.uid : null;

  if (!user) {
    unsubscribeProgress();
    unsubscribeGeneralDailyCompletion();
    unsubscribeAllCampaignCompletionListeners();
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    return;
  }

  els.signedOut.hidden = true;
  els.signedIn.hidden = false;
  subscribeMissions();
  subscribeProgress(user.uid);
  subscribeGeneralDailyCompletion(user.uid);
  syncCampaignCompletionListeners();

  // Re-render on every profile snapshot too (not just missions/progress
  // ones) — the streak indicator reads currentStreak straight off the
  // profile, and this is what makes it update live the moment a
  // completing click's transaction lands, without a page reload.
  render();
});
