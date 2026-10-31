/*
  PerthSanta Streaming — multi-campaign system
  ------------------------------------------------------------------
  Loaded after js/data.js and js/main.js on every public page. Reads
  siteData.campaigns (array, kept in sync with Firestore's campaigns/{id}
  collection by js/firestore-content.js) and renders:
    - the homepage "Active Campaigns" section (index.html)
    - the generic campaign detail page (campaign.html?id=...)
    - the Current Campaigns page (campaigns-current.html)
    - the All Campaigns page (campaigns.html)

  Every render* function below no-ops if its target container isn't on
  the current page, so this single file is safe to run on every page —
  same convention as js/main.js. renderCampaignSections() is the single
  entry point, called from js/main.js's renderAllContent().
*/

const CAMPAIGN_STATUSES = ["current", "upcoming", "previous"];

/* ==========================================================================
   Campaign lookup helpers
   ========================================================================== */

function getAllCampaigns() {
  return (siteData.campaigns || []).slice();
}

function getCampaignById(id) {
  if (!id) return null;
  return getAllCampaigns().find((c) => c.id === id) || null;
}

function byDisplayOrder(a, b) {
  const orderA = typeof a.displayOrder === "number" ? a.displayOrder : 999;
  const orderB = typeof b.displayOrder === "number" ? b.displayOrder : 999;
  return orderA - orderB;
}

function getCampaignsByStatus(status) {
  return getAllCampaigns()
    .filter((c) => c.status === status)
    .sort(byDisplayOrder);
}

// Only one campaign should normally be isFeatured at a time. If more than
// one is (an admin misconfiguration), the lowest displayOrder wins and a
// console warning is logged — this is the "deterministic fallback" the
// architecture calls for, surfaced in Admin's dashboard too (see admin.js).
function getFeaturedCampaign() {
  const current = getCampaignsByStatus("current");
  if (!current.length) return null;

  const featured = current.filter((c) => c.isFeatured);
  if (featured.length > 1) {
    console.warn(
      `[campaigns] Multiple campaigns are marked isFeatured (${featured.map((c) => c.id).join(", ")}) — using the lowest displayOrder. Only one should normally be featured.`
    );
  }
  if (featured.length) return featured.sort(byDisplayOrder)[0];
  return current[0];
}

/* ==========================================================================
   Campaign detail URL helper
   ------------------------------------------------------------------
   The single place that builds a campaign.html?id=... link. Every
   campaign card/CTA in this file calls this instead of building the URL
   itself, so there is exactly one spot to change if the URL shape ever
   needs to change again.

   On localhost/127.0.0.1 (local preview via e.g. `npx serve`, which
   redirects *.html requests to their extensionless equivalent and drops
   the query string in that redirect) this returns an extensionless URL,
   which that same clean-URL handling serves directly with no redirect —
   so the query string survives. On every other host (GitHub Pages, or
   any other static host serving the repo's real files) this returns the
   production-safe campaign.html?id=... form, since GitHub Pages serves
   committed files as-is with no extension-stripping at all.
   ========================================================================== */

function getCampaignDetailUrl(campaignId) {
  const encodedId = encodeURIComponent(campaignId);
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return isLocal ? `campaign?id=${encodedId}` : `campaign.html?id=${encodedId}`;
}

/* ==========================================================================
   Shared visual building blocks
   ========================================================================== */

const CAMPAIGN_STATUS_BADGE = {
  current: { text: "Current", className: "badge-active" },
  upcoming: { text: "Upcoming", className: "badge-upcoming" },
  previous: { text: "Previous", className: "badge-previous" }
};

function buildStatusBadge(status) {
  const info = CAMPAIGN_STATUS_BADGE[status] || CAMPAIGN_STATUS_BADGE.previous;
  const span = document.createElement("span");
  span.className = `badge ${info.className}`;
  span.textContent = info.text;
  return span;
}

// Fills a cover <div> with an <img> when campaign.image is set, falling
// back to a placeholder (missing image, or a broken path) — same pattern
// as js/main.js's fillMusicCover, so a bad/absent path never ships a
// broken image or a fake-looking blank box.
function buildCampaignImage(campaign, wrapClassName, placeholderClassName) {
  const wrap = document.createElement("div");
  wrap.className = wrapClassName;

  if (campaign.image) {
    const img = document.createElement("img");
    img.src = campaign.image;
    img.alt = campaign.title ? `${campaign.title} campaign image` : "Campaign image";
    img.loading = "lazy";
    img.addEventListener(
      "error",
      () => {
        wrap.innerHTML = "";
        wrap.classList.add(placeholderClassName);
        wrap.textContent = "Image coming soon";
      },
      { once: true }
    );
    wrap.appendChild(img);
  } else {
    wrap.classList.add(placeholderClassName);
    wrap.textContent = "Image coming soon";
  }

  return wrap;
}

function formatCampaignDate(dateStr) {
  if (!dateStr) return "";
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function campaignDateRangeText(campaign) {
  const start = formatCampaignDate(campaign.startDate);
  const end = formatCampaignDate(campaign.endDate);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return "";
}

function campaignGoalSummaryText(campaign) {
  const yt = campaign.goals && campaign.goals.youtube && campaign.goals.youtube[0];
  const tt = campaign.goals && campaign.goals.tiktok && campaign.goals.tiktok[0];
  if (yt) return `Goal: ${yt.label} (YouTube)`;
  if (tt) return `Goal: ${tt.label} (TikTok)`;
  return "";
}

/* ==========================================================================
   Campaign grid card — used by Current Campaigns, All Campaigns, and
   (in a compact variant below) the homepage "Also Streaming" row.
   ========================================================================== */

function buildCampaignGridCard(campaign) {
  const card = document.createElement("div");
  card.className = "card campaign-grid-card";

  card.appendChild(buildCampaignImage(campaign, "campaign-grid-card-cover", "campaign-grid-card-cover-placeholder"));

  const headerRow = document.createElement("div");
  headerRow.className = "campaign-grid-card-header";
  headerRow.appendChild(buildStatusBadge(campaign.status));
  if (campaign.campaignType) {
    const type = document.createElement("span");
    type.className = "campaign-grid-card-type";
    type.textContent = campaign.campaignType;
    headerRow.appendChild(type);
  }
  card.appendChild(headerRow);

  const title = document.createElement("h3");
  title.textContent = campaign.title || "Untitled Campaign";
  card.appendChild(title);

  if (campaign.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "campaign-grid-card-subtitle";
    subtitle.textContent = campaign.subtitle;
    card.appendChild(subtitle);
  }

  if (campaign.description) {
    const desc = document.createElement("p");
    desc.className = "campaign-grid-card-desc";
    desc.textContent = campaign.description;
    card.appendChild(desc);
  }

  const dateRange = campaignDateRangeText(campaign);
  if (dateRange) {
    const dateEl = document.createElement("p");
    dateEl.className = "campaign-grid-card-meta";
    dateEl.textContent = dateRange;
    card.appendChild(dateEl);
  }

  const linkPlatforms = [];
  if (campaign.links && campaign.links.youtube) linkPlatforms.push("YouTube");
  if (campaign.links && campaign.links.tiktok) linkPlatforms.push("TikTok");
  const platformNames = (campaign.platforms || []).map((p) => p.name).filter(Boolean);
  const allPlatformNames = Array.from(new Set([...linkPlatforms, ...platformNames]));
  if (allPlatformNames.length) {
    const platformsEl = document.createElement("p");
    platformsEl.className = "campaign-grid-card-meta";
    platformsEl.textContent = allPlatformNames.join(" • ");
    card.appendChild(platformsEl);
  }

  const goalSummary = campaignGoalSummaryText(campaign);
  if (goalSummary) {
    const goalEl = document.createElement("p");
    goalEl.className = "campaign-grid-card-meta";
    goalEl.textContent = goalSummary;
    card.appendChild(goalEl);
  }

  const cta = document.createElement("a");
  cta.className = "btn btn-primary btn-block";
  cta.href = getCampaignDetailUrl(campaign.id);
  cta.textContent = "View Campaign";
  card.appendChild(cta);

  return card;
}

/* ==========================================================================
   Homepage — Active Campaigns section
   ------------------------------------------------------------------
   One current campaign: renders exactly like the old single-campaign
   "Active Campaign" card (same classes/copy as before this change).
   Multiple current campaigns: the isFeatured one keeps that same large
   card; the rest render as compact "Also Streaming" cards below it.
   ========================================================================== */

// Preserves the exact badge copy the old single-campaign card used
// ("Active now"), rather than the grid vocabulary ("Current") used on
// the new Current/All Campaigns pages — this card already existed with
// this text before the campaign system was generalized.
const HOMEPAGE_FEATURED_STATUS_LABEL = {
  current: "Active now",
  upcoming: "Coming soon",
  previous: "Campaign ended"
};

function buildFeaturedCampaignCard(campaign) {
  const el = document.createElement("div");
  el.className = "campaign-card";

  const header = document.createElement("div");
  header.className = "campaign-card-header";

  const statusBadge = document.createElement("span");
  statusBadge.className = "badge badge-active";
  statusBadge.textContent = HOMEPAGE_FEATURED_STATUS_LABEL[campaign.status] || "Active now";
  header.appendChild(statusBadge);

  const title = document.createElement("h3");
  title.textContent = campaign.subtitle ? `${campaign.title} — ${campaign.subtitle}` : campaign.title;
  header.appendChild(title);

  el.appendChild(header);

  if (campaign.description) {
    const desc = document.createElement("p");
    desc.textContent = campaign.description;
    el.appendChild(desc);
  }

  const links = campaign.links || {};
  const primaryPlatformKey = links.youtube ? "youtube" : links.tiktok ? "tiktok" : null;
  if (primaryPlatformKey) {
    const platformLine = document.createElement("p");
    platformLine.innerHTML = `<strong>Primary platform:</strong> ${capitalize(primaryPlatformKey)}`;
    el.appendChild(platformLine);
  }

  const footer = document.createElement("div");
  footer.className = "campaign-card-footer";

  if (links.youtube) footer.appendChild(createLinkOrPlaceholder(links.youtube.url, "STREAM ON YOUTUBE", "btn btn-primary"));
  if (links.tiktok) footer.appendChild(createLinkOrPlaceholder(links.tiktok.url, "STREAM ON TIKTOK", "btn btn-primary"));

  const detailsLink = document.createElement("a");
  detailsLink.href = getCampaignDetailUrl(campaign.id);
  detailsLink.className = "btn btn-secondary";
  detailsLink.textContent = "Full campaign details";
  footer.appendChild(detailsLink);

  el.appendChild(footer);
  return el;
}

function buildCompactCampaignCard(campaign) {
  const card = document.createElement("div");
  card.className = "card also-streaming-card";

  const header = document.createElement("div");
  header.className = "also-streaming-card-header";
  header.appendChild(buildStatusBadge(campaign.status));
  card.appendChild(header);

  const title = document.createElement("h3");
  title.textContent = campaign.title || "Untitled Campaign";
  card.appendChild(title);

  if (campaign.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "campaign-grid-card-subtitle";
    subtitle.textContent = campaign.subtitle;
    card.appendChild(subtitle);
  }

  const cta = document.createElement("a");
  cta.className = "btn btn-secondary btn-sm";
  cta.href = getCampaignDetailUrl(campaign.id);
  cta.textContent = "View Campaign";
  card.appendChild(cta);

  return card;
}

function renderHomepageActiveCampaigns() {
  const container = document.querySelector("[data-render='active-campaigns']");
  if (!container) return;

  const current = getCampaignsByStatus("current");
  container.innerHTML = "";

  if (!current.length) {
    container.innerHTML = '<p class="empty-state">No current campaigns right now — check back soon.</p>';
    return;
  }

  const featured = getFeaturedCampaign() || current[0];
  const others = current.filter((c) => c.id !== featured.id);

  container.appendChild(buildFeaturedCampaignCard(featured));

  if (others.length) {
    const alsoWrap = document.createElement("div");
    alsoWrap.className = "also-streaming";

    const heading = document.createElement("h3");
    heading.className = "also-streaming-heading";
    heading.textContent = "Also Streaming";
    alsoWrap.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "also-streaming-grid";
    others.forEach((c) => grid.appendChild(buildCompactCampaignCard(c)));
    alsoWrap.appendChild(grid);

    container.appendChild(alsoWrap);
  }

  // The homepage's Goals/Platforms/Missions/Quick Links sections below
  // the fold always mirror the featured campaign, same as today (where
  // they're implicitly "Heartbound's" sections, since it's the only
  // campaign). Switching the featured campaign updates these too.
  renderCampaignSharedSections(featured);
}

// The homepage masthead's small "Current campaign" tag and its "Join the
// Streaming Campaign" button (above the fold, separate from the Active
// Campaigns section) — kept dynamic, with an explicit ?id=, so neither
// shows a stale campaign name/link after the featured campaign changes.
function renderHeroCampaignTag() {
  const nameEl = document.querySelector(".hero-campaign-tag .campaign-name");
  const ctaEl = document.querySelector("[data-field='hero-campaign-cta']");
  if (!nameEl && !ctaEl) return;

  const featured = getFeaturedCampaign();
  if (!featured) return;

  if (nameEl) {
    nameEl.textContent = featured.subtitle ? `${featured.title} — ${featured.subtitle}` : featured.title;
  }
  if (ctaEl) {
    ctaEl.href = getCampaignDetailUrl(featured.id);
  }
}

/* ==========================================================================
   Shared campaign sections — Goals, TikTok Goals, Platforms, Missions,
   Quick Links. Used by both the homepage (for the featured campaign) and
   the generic campaign detail page (for the resolved campaign).
   ========================================================================== */

async function fetchYoutubeStats(source) {
  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data.viewCount !== "number") return null;
    return data;
  } catch (error) {
    console.warn(`YouTube stats unavailable for source "${source}", falling back to placeholder goal values.`, error);
    return null;
  }
}

function renderYoutubeGoalsCards(container, campaign, stats) {
  const goals = (campaign.goals && campaign.goals.youtube) || [];

  if (!goals.length) {
    container.innerHTML = '<p class="empty-state">Goals for this campaign have not been set yet.</p>';
    return;
  }

  const liveViews = stats ? stats.viewCount : null;

  container.innerHTML = "";
  goals.forEach((goal) => {
    const current = liveViews !== null ? liveViews : 0;
    const percent = goal.target > 0 ? Math.min(100, (current / goal.target) * 100) : 0;
    const reached = current >= goal.target;

    const card = document.createElement("div");
    card.className = `card goal-card${reached ? " is-reached" : ""}`;
    card.innerHTML = `
      <h3>${goal.label}${reached ? '<span class="badge badge-reached">Reached</span>' : ""}</h3>
      <div class="goal-values">
        <span>${formatNumber(current)}</span>
        <span>${formatNumber(goal.target)}</span>
      </div>
      <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="${goal.label} progress">
        <div class="progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderGoalsMeta(stats) {
  document.querySelectorAll("[data-field='goals-updated-at']").forEach((el) => {
    if (!stats || !stats.updatedAt) {
      el.textContent = "";
      return;
    }
    const updated = new Date(stats.updatedAt);
    if (Number.isNaN(updated.getTime())) {
      el.textContent = "";
      return;
    }
    const formatted = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    }).format(updated);
    el.textContent = ` · Last updated ${formatted} UTC`;
  });
}

// Only fetches live stats when the campaign explicitly points at a
// source (campaign.stats.youtubeStatsSource) — data-driven, not an
// identity check on which campaign this is. Heartbound is the only
// campaign with a source set today.
async function loadAndRenderYoutubeGoals(campaign) {
  const container = document.querySelector("[data-render='goals']");
  if (!container) return;

  renderYoutubeGoalsCards(container, campaign, null);

  const source = campaign.stats && campaign.stats.youtubeStatsSource;
  const stats = source ? await fetchYoutubeStats(source) : null;
  if (stats) renderYoutubeGoalsCards(container, campaign, stats);
  renderGoalsMeta(stats);
}

function renderTikTokGoalsSection(container, campaign) {
  if (!container) return;
  const goals = (campaign.goals && campaign.goals.tiktok) || [];
  const current = (campaign.stats && campaign.stats.tiktokCurrentViews) || 0;

  if (!goals.length) {
    container.innerHTML = '<p class="empty-state">TikTok goals have not been set yet.</p>';
    return;
  }

  container.innerHTML = "";
  goals.forEach((goal) => {
    const percent = goal.target > 0 ? Math.min(100, (current / goal.target) * 100) : 0;
    const reached = current >= goal.target;

    const card = document.createElement("div");
    card.className = `card goal-card${reached ? " is-reached" : ""}`;
    card.innerHTML = `
      <h3>${goal.label}${reached ? '<span class="badge badge-reached">Reached</span>' : ""}</h3>
      <div class="goal-values">
        <span>${formatNumber(current)}</span>
        <span>${formatNumber(goal.target)}</span>
      </div>
      <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="TikTok ${goal.label} progress">
        <div class="progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderCampaignPlatforms(container, campaign) {
  if (!container) return;
  const platforms = campaign.platforms || [];
  const section = container.closest("section");

  if (!platforms.length) {
    container.innerHTML = "";
    if (section) section.hidden = true;
    return;
  }

  if (section) section.hidden = false;
  container.innerHTML = "";
  platforms.forEach((platform) => {
    const card = document.createElement("div");
    card.className = "card platform-card";

    const heading = document.createElement("h3");
    heading.textContent = platform.name;
    card.appendChild(heading);

    const actions = document.createElement("ul");
    actions.className = "platform-actions";
    (platform.actions || []).forEach((action) => {
      const li = document.createElement("li");
      li.textContent = action;
      actions.appendChild(li);
    });
    card.appendChild(actions);

    card.appendChild(createLinkOrPlaceholder(platform.url, platform.cta, "btn btn-primary btn-block"));
    container.appendChild(card);
  });
}

function renderCampaignMissions(container, campaign) {
  if (!container) return;
  const missions = campaign.missions || [];
  const section = container.closest("section");

  if (!missions.length) {
    container.innerHTML = "";
    if (section) section.hidden = true;
    return;
  }

  if (section) section.hidden = false;
  container.innerHTML = "";
  missions.forEach((mission, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="mission-number" aria-hidden="true">${index + 1}</span>
      <span>${mission}</span>
    `;
    container.appendChild(li);
  });
}

function renderCampaignQuickLinks(container, campaign) {
  if (!container) return;
  const quickLinks = campaign.quickLinks || [];
  const section = container.closest("section");

  if (!quickLinks.length) {
    container.innerHTML = "";
    if (section) section.hidden = true;
    return;
  }

  if (section) section.hidden = false;
  container.innerHTML = "";
  quickLinks.forEach((link) => {
    const card = document.createElement("div");
    card.className = "card";

    const inner = `<span class="quicklink-icon" aria-hidden="true">${link.icon || ""}</span><span class="quicklink-label">${link.label}</span>`;

    if (link.url) {
      const a = document.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "quicklink-card";
      a.innerHTML = inner;
      card.appendChild(a);
    } else {
      const row = document.createElement("div");
      row.className = "quicklink-card btn-placeholder";
      row.setAttribute("aria-disabled", "true");
      row.innerHTML = inner;
      card.appendChild(row);

      const tag = document.createElement("span");
      tag.className = "badge badge-coming-soon";
      tag.style.marginTop = "8px";
      tag.textContent = "Coming soon";
      card.appendChild(tag);
    }

    container.appendChild(card);
  });
}

// Whole Goals section hides when the campaign has no goals on either
// platform; each group (YouTube / TikTok) hides independently when that
// platform's own goals are empty — no empty headings, no Heartbound
// fallback data, just this campaign's own goals object.
function renderCampaignGoalsVisibility(campaign) {
  const section = document.querySelector("[data-campaign-section='goals']");
  if (!section) return;

  const youtubeGoals = (campaign.goals && campaign.goals.youtube) || [];
  const tiktokGoals = (campaign.goals && campaign.goals.tiktok) || [];

  const youtubeGroup = document.querySelector("[data-goals-group='youtube']");
  const tiktokGroup = document.querySelector("[data-goals-group='tiktok']");

  if (youtubeGroup) youtubeGroup.hidden = youtubeGoals.length === 0;
  if (tiktokGroup) tiktokGroup.hidden = tiktokGoals.length === 0;

  section.hidden = youtubeGoals.length === 0 && tiktokGoals.length === 0;
}

function renderCampaignSharedSections(campaign) {
  if (!campaign) return;
  loadAndRenderYoutubeGoals(campaign);
  renderTikTokGoalsSection(document.querySelector("[data-render='tiktok-goals']"), campaign);
  renderCampaignGoalsVisibility(campaign);
  renderCampaignPlatforms(document.querySelector("[data-render='platforms']"), campaign);
  renderCampaignMissions(document.querySelector("[data-render='missions']"), campaign);
  renderCampaignQuickLinks(document.querySelector("[data-render='quick-links']"), campaign);
}

/* ==========================================================================
   Generic campaign detail page (campaign.html?id=...)
   ------------------------------------------------------------------
   No id, or id === "heartbound" -> Heartbound, unchanged from before this
   migration. Any other known id -> the same generic sections, populated
   from that campaign's data. Unknown id -> a friendly not-found state.
   Optional modules (Comment Helper / YouTube Streaming Guide / playlists)
   show or hide based on campaign.features — not on which campaign this is.
   ========================================================================== */

const CAMPAIGN_HERO_STATUS_LABEL = {
  current: "Campaign Active",
  upcoming: "Coming Soon",
  previous: "Campaign Ended"
};

function renderCampaignPrimaryCta(campaign) {
  const ctaSlot = document.querySelector("[data-slot='primary-cta']");
  if (!ctaSlot) return;

  const links = campaign.links || {};
  if (!links.youtube && !links.tiktok) {
    ctaSlot.innerHTML = "";
    ctaSlot.hidden = true;
    return;
  }

  ctaSlot.hidden = false;
  ctaSlot.innerHTML = "";
  ctaSlot.appendChild(createLinkOrPlaceholder(links.youtube ? links.youtube.url : null, "▶ STREAM ON YOUTUBE", "btn btn-primary"));
  ctaSlot.appendChild(createLinkOrPlaceholder(links.tiktok ? links.tiktok.url : null, "♪ STREAM ON TIKTOK", "btn btn-secondary"));
}

function renderCampaignHero(campaign) {
  const el = document.querySelector("[data-render='campaign-hero']");
  if (!el) return;

  el.hidden = false;

  el.querySelectorAll("[data-field]").forEach((field) => {
    const key = field.getAttribute("data-field");
    if (key === "title") field.textContent = campaign.title || "";
    if (key === "subtitle") field.textContent = campaign.subtitle || "";
    if (key === "hero-message") {
      field.textContent = campaign.heroMessage || "";
      field.hidden = !campaign.heroMessage;
    }
  });

  const badge = el.querySelector(".badge");
  if (badge) {
    const statusInfo = CAMPAIGN_STATUS_BADGE[campaign.status] || CAMPAIGN_STATUS_BADGE.previous;
    badge.className = `badge ${statusInfo.className}`;
    badge.textContent = CAMPAIGN_HERO_STATUS_LABEL[campaign.status] || "Campaign Active";
  }

  renderCampaignHeroImage(campaign);
  renderCampaignPrimaryCta(campaign);
}

// Exactly one image area: the container is rebuilt from scratch every call
// (container.innerHTML = "" first) and gets exactly one child — an <img>
// when campaign.image is set, or a placeholder div when it isn't. There is
// no static <img> left in campaign.html for this to leave behind or
// duplicate alongside, and no [hidden] toggling involved, so this is safe
// to call any number of times (fallback render, then again after Firestore
// resolves) without ever producing two image areas.
function renderCampaignHeroImage(campaign) {
  const container = document.querySelector("[data-campaign-image]");
  if (!container) return;

  container.innerHTML = "";

  if (campaign.image) {
    const img = document.createElement("img");
    img.src = campaign.image;
    img.alt = campaign.title ? `${campaign.title} campaign image` : "Campaign image";
    img.className = "campaign-image";
    img.loading = "lazy";
    img.addEventListener(
      "error",
      () => {
        container.innerHTML = "";
        container.appendChild(buildCampaignHeroImagePlaceholder());
      },
      { once: true }
    );
    container.appendChild(img);
  } else {
    container.appendChild(buildCampaignHeroImagePlaceholder());
  }
}

function buildCampaignHeroImagePlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "campaign-hero-image-placeholder";
  placeholder.textContent = "Image coming soon";
  return placeholder;
}

// Heartbound-specific copy stays Heartbound-specific — only this section's
// visibility (via features.youtubeGuide) and its CTA/playlists are generic.
function renderYoutubeStreamingGuideSection(campaign) {
  const ctaSlot = document.querySelector("[data-slot='youtube-guide-cta']");
  if (ctaSlot) {
    const url = campaign.links && campaign.links.youtube ? campaign.links.youtube.url : null;
    const label = campaign.title ? `▶ WATCH THE ${campaign.title.toUpperCase()} PILOT` : "▶ WATCH THE TRAILER";
    ctaSlot.innerHTML = "";
    ctaSlot.appendChild(createLinkOrPlaceholder(url, label, "btn btn-primary"));
  }

  const playlistList = document.querySelector("[data-render='streaming-playlists']");
  if (!playlistList) return;

  playlistList.innerHTML = "";
  (siteData.streamingPlaylists || []).forEach((playlist) => {
    const li = document.createElement("li");
    li.className = "stream-guide-playlist-item";

    const info = document.createElement("span");
    info.className = "stream-guide-playlist-info";

    const name = document.createElement("span");
    name.className = "stream-guide-playlist-name";
    name.textContent = playlist.name;
    info.appendChild(name);

    const platform = document.createElement("span");
    platform.className = "stream-guide-playlist-platform";
    platform.textContent = playlist.platform;
    info.appendChild(platform);

    li.appendChild(info);

    if (playlist.url) {
      const a = document.createElement("a");
      a.href = playlist.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "btn btn-secondary btn-sm";
      a.textContent = "Open Playlist";
      li.appendChild(a);
    } else {
      const badge = document.createElement("span");
      badge.className = "stream-guide-playlist-badge";
      badge.textContent = "PLAYLISTS COMING SOON";
      li.appendChild(badge);
    }

    playlistList.appendChild(li);
  });
}

function applyFeatureVisibility(campaign) {
  const features = campaign.features || {};
  document.querySelectorAll("[data-feature]").forEach((section) => {
    const key = section.getAttribute("data-feature");
    section.hidden = !features[key];
  });
}

/* ==========================================================================
   Comment Helper — generic, data-driven, per-campaign
   ------------------------------------------------------------------
   Reads only campaign.id and campaign.commentHelper (title/description/
   buttonLabel/copyLabel/allowEditing) — no campaign-identity checks here.
   The phrase library itself lives in Firestore at
   campaigns/{campaign.id}/commentHelperPhrases and is fetched on demand,
   in small bounded batches, via window.fetchCommentHelperBatch (exposed by
   js/firestore-content.js, since this file has no Firestore access of its
   own). Heartbound's only special treatment is a small local emergency
   fallback used solely when Firestore itself is unreachable — see
   ensureCommentHelperPool below; nothing else in this section knows or
   cares which campaign is being viewed.
   ========================================================================== */

const COMMENT_HELPER_BATCH_FLOOR = 8;
const COMMENT_HELPER_RECENT_LIMIT = 20;
const COMMENT_HELPER_MAX_TOPUP_ATTEMPTS = 3;

const commentHelperPoolState = {}; // campaignId -> { items: [{id,text}], ids: Set }
let activeCommentHelperCampaign = null;

function getCommentHelperPoolState(campaignId) {
  if (!commentHelperPoolState[campaignId]) {
    commentHelperPoolState[campaignId] = { items: [], ids: new Set() };
  }
  return commentHelperPoolState[campaignId];
}

function getCommentHelperRecentIds(campaignId) {
  try {
    const raw = sessionStorage.getItem(`commentHelperRecent:${campaignId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function pushCommentHelperRecentId(campaignId, id) {
  const recent = getCommentHelperRecentIds(campaignId);
  recent.push(id);
  while (recent.length > COMMENT_HELPER_RECENT_LIMIT) recent.shift();
  try {
    sessionStorage.setItem(`commentHelperRecent:${campaignId}`, JSON.stringify(recent));
  } catch (error) {
    // sessionStorage unavailable — recency tracking just doesn't persist.
  }
}

// Tops up the in-memory pool from Firestore only when needed. Returns both
// the pool state and whether the underlying fetch itself failed (as
// opposed to the library simply being empty) — renderCommentHelper uses
// that distinction to show "couldn't load" vs. "no comments yet".
async function ensureCommentHelperPool(campaignId, minEligible) {
  const state = getCommentHelperPoolState(campaignId);
  const recentIds = getCommentHelperRecentIds(campaignId);
  let attempts = 0;
  let hadFetchError = false;

  while (attempts < COMMENT_HELPER_MAX_TOPUP_ATTEMPTS) {
    const eligibleCount = state.items.filter((p) => !recentIds.includes(p.id)).length;
    if (eligibleCount >= minEligible && state.items.length > 0) break;

    const batch = typeof window.fetchCommentHelperBatch === "function"
      ? await window.fetchCommentHelperBatch(campaignId)
      : null;

    if (batch === null) {
      hadFetchError = true;
      break;
    }
    if (!batch.length) break; // genuinely empty library — not an error, don't retry

    let addedNew = 0;
    batch.forEach((p) => {
      if (!state.ids.has(p.id)) {
        state.ids.add(p.id);
        state.items.push(p);
        addedNew++;
      }
    });

    attempts++;
    if (addedNew === 0) break; // library exhausted — stop retrying
  }

  // Heartbound-only emergency fallback — narrow and explicit, used only
  // when Firestore itself was unreachable (never for a campaign whose
  // library is just legitimately empty, and never for any other campaign).
  if (hadFetchError && state.items.length === 0 && campaignId === "heartbound") {
    const fallbackLines = (siteData.commentHelperFallback && siteData.commentHelperFallback.heartbound) || [];
    fallbackLines.forEach((text, index) => {
      const id = `fallback-${index}`;
      if (!state.ids.has(id)) {
        state.ids.add(id);
        state.items.push({ id, text, enabled: true });
      }
    });
  }

  return { state, hadFetchError };
}

function commentHelperEls() {
  const section = document.querySelector('[data-feature="commentHelper"]');
  if (!section) return null;
  return {
    section,
    title: section.querySelector("[data-comment-helper-title]"),
    description: section.querySelector("[data-comment-helper-description]"),
    generateBtn: section.querySelector("[data-comment-generate]"),
    regenerateBtn: section.querySelector("[data-comment-regenerate]"),
    copyBtn: section.querySelector("[data-comment-copy]"),
    resultBox: section.querySelector("[data-comment-result]"),
    textEl: section.querySelector("[data-comment-text]"),
    emptyEl: section.querySelector("[data-comment-helper-empty]")
  };
}

// Populates labels from campaign.commentHelper and resets to the idle
// state. Called every time the detail page (re)renders (fallback pass,
// then again after Firestore resolves) — safe to call repeatedly since it
// only updates text content and hidden flags on existing elements.
function renderCommentHelper(campaign) {
  const els = commentHelperEls();
  if (!els) return;

  activeCommentHelperCampaign = campaign;

  const config = campaign.commentHelper || {};
  if (els.title) els.title.textContent = config.title || "Comment Helper";
  if (els.description) {
    els.description.textContent = config.description || "Need an idea? Generate a comment you can personalize.";
  }
  if (els.generateBtn) els.generateBtn.textContent = config.buttonLabel || "Generate Comment";
  if (els.copyBtn) els.copyBtn.textContent = config.copyLabel || "Copy";

  if (els.resultBox) els.resultBox.hidden = true;
  if (els.emptyEl) els.emptyEl.hidden = true;
}

async function generateCommentHelperResult() {
  const campaign = activeCommentHelperCampaign;
  const els = commentHelperEls();
  if (!campaign || !els || !els.resultBox || !els.textEl) return;

  if (els.generateBtn) els.generateBtn.disabled = true;
  if (els.regenerateBtn) els.regenerateBtn.disabled = true;
  if (els.emptyEl) els.emptyEl.hidden = true;

  els.resultBox.hidden = false;
  els.textEl.disabled = true;
  els.textEl.value = "Loading comment ideas...";

  try {
    const { state, hadFetchError } = await ensureCommentHelperPool(campaign.id, COMMENT_HELPER_BATCH_FLOOR);

    if (!state.items.length) {
      els.resultBox.hidden = true;
      if (els.emptyEl) {
        els.emptyEl.hidden = false;
        els.emptyEl.textContent = hadFetchError
          ? "Comment ideas couldn't be loaded right now — please try again shortly."
          : "No comment ideas are available for this campaign yet.";
      }
      return;
    }

    const recentIds = getCommentHelperRecentIds(campaign.id);
    const eligible = state.items.filter((p) => !recentIds.includes(p.id));
    const pool = eligible.length ? eligible : state.items;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    pushCommentHelperRecentId(campaign.id, chosen.id);

    const config = campaign.commentHelper || {};
    const allowEditing = config.allowEditing !== false;

    els.textEl.value = chosen.text;
    els.textEl.disabled = false;
    els.textEl.readOnly = !allowEditing;
  } finally {
    if (els.generateBtn) els.generateBtn.disabled = false;
    if (els.regenerateBtn) els.regenerateBtn.disabled = false;
  }
}

// One-time event wiring — called once from js/main.js's DOMContentLoaded
// handler. Button clicks always act on activeCommentHelperCampaign (kept
// up to date by renderCommentHelper), so this never needs to re-wire
// itself when the page re-renders after Firestore resolves.
function initCommentHelperInteractions() {
  const els = commentHelperEls();
  if (!els || !els.generateBtn) return;

  els.generateBtn.addEventListener("click", generateCommentHelperResult);
  if (els.regenerateBtn) els.regenerateBtn.addEventListener("click", generateCommentHelperResult);

  if (els.copyBtn) {
    els.copyBtn.addEventListener("click", async () => {
      const freshEls = commentHelperEls();
      const textEl = freshEls ? freshEls.textEl : null;
      if (!textEl || !textEl.value) return;

      try {
        await navigator.clipboard.writeText(textEl.value);
        const originalLabel = els.copyBtn.textContent;
        els.copyBtn.textContent = "Copied!";
        setTimeout(() => {
          els.copyBtn.textContent = originalLabel;
        }, 1500);
      } catch (error) {
        console.warn("Clipboard copy failed.", error);
      }
    });
  }
}

function resolveDetailPageCampaignId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || "heartbound";
}

function renderCampaignDetailPage() {
  const heroEl = document.querySelector("[data-render='campaign-hero']");
  if (!heroEl) return; // not on campaign.html

  const main = document.getElementById("main-content");
  const notFoundEl = document.querySelector("[data-render='campaign-not-found']");
  const id = resolveDetailPageCampaignId();
  const campaign = getCampaignById(id);

  if (!campaign) {
    if (main) {
      Array.from(main.children).forEach((child) => {
        child.hidden = child !== notFoundEl;
      });
    }
    if (notFoundEl) {
      notFoundEl.hidden = false;
      const idField = notFoundEl.querySelector("[data-field='not-found-id']");
      if (idField) idField.textContent = id;
    }
    return;
  }

  if (main) {
    Array.from(main.children).forEach((child) => {
      if (child !== notFoundEl) child.hidden = false;
    });
  }
  if (notFoundEl) notFoundEl.hidden = true;

  renderCampaignHero(campaign);
  renderYoutubeStreamingGuideSection(campaign);
  renderCommentHelper(campaign);
  renderCampaignSharedSections(campaign);
  applyFeatureVisibility(campaign);
}

/* ==========================================================================
   Current Campaigns page (campaigns-current.html)
   ========================================================================== */

function renderCurrentCampaignsPage() {
  const container = document.querySelector("[data-render='current-campaigns']");
  if (!container) return;

  const current = getCampaignsByStatus("current");
  container.innerHTML = "";

  if (!current.length) {
    container.innerHTML = '<p class="empty-state">No current campaigns right now — check back soon.</p>';
    return;
  }

  current.forEach((campaign) => container.appendChild(buildCampaignGridCard(campaign)));
}

/* ==========================================================================
   All Campaigns page (campaigns.html) — Current / Upcoming / Previous
   sections, plus an All/Current/Upcoming/Previous filter.
   ========================================================================== */

let allCampaignsActiveFilter = "all";

function applyAllCampaignsFilterToDom() {
  CAMPAIGN_STATUSES.forEach((status) => {
    const section = document.querySelector(`[data-campaigns-section='${status}']`);
    if (!section) return;
    const hasItems = section.dataset.hasItems === "true";
    section.hidden = !hasItems || (allCampaignsActiveFilter !== "all" && allCampaignsActiveFilter !== status);
  });
}

// One-time event wiring — called once from js/main.js's DOMContentLoaded
// handler, not from the repeatable render pipeline, so re-renders (e.g.
// after Firestore resolves) never attach duplicate click listeners.
function initCampaignFilters() {
  const tabs = document.querySelectorAll("[data-campaign-filter]");
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      allCampaignsActiveFilter = tab.getAttribute("data-campaign-filter");
      applyAllCampaignsFilterToDom();
    });
  });
}

function renderAllCampaignsPage() {
  const root = document.querySelector("[data-render='all-campaigns']");
  if (!root) return;

  CAMPAIGN_STATUSES.forEach((status) => {
    const grid = document.querySelector(`[data-render='campaigns-${status}']`);
    const section = document.querySelector(`[data-campaigns-section='${status}']`);
    if (!grid) return;

    const list = getCampaignsByStatus(status);
    grid.innerHTML = "";
    list.forEach((campaign) => grid.appendChild(buildCampaignGridCard(campaign)));
    if (section) section.dataset.hasItems = list.length ? "true" : "false";
  });

  applyAllCampaignsFilterToDom();
}

/* ==========================================================================
   Entry point — called from js/main.js's renderAllContent()
   ========================================================================== */

function renderCampaignSections() {
  renderHeroCampaignTag();
  renderHomepageActiveCampaigns();
  renderCampaignDetailPage();
  renderCurrentCampaignsPage();
  renderAllCampaignsPage();
}
