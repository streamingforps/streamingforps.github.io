/*
  Streaming For PS — shared behavior & rendering
  ------------------------------------------------------------------
  Loaded on every page after js/data.js. Each render* function checks
  whether its target container exists before doing anything, so this
  single file can safely run on index.html, campaign.html, and every
  guides/*.html page without errors.
*/

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  highlightActiveNavLink();
  setFooterYear();
  initFaqAccordion();

  renderActiveCampaignSummary();
  renderCampaignHero();
  loadAndRenderGoals();
  renderPlatforms(document.querySelector("[data-render='platforms']"));
  renderMissions(document.querySelector("[data-render='missions']"));
  renderQuickLinks(document.querySelector("[data-render='quick-links']"));
  renderAnnouncements(document.querySelector("[data-render='announcements']"));
  renderGuides(document.querySelector("[data-render='guides']"));
  renderFaq(document.querySelector("[data-render='faq']"));
});

/* ==========================================================================
   Navigation
   ========================================================================== */

function initMobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (!toggle || !nav) return;

  const closeNav = () => {
    toggle.setAttribute("aria-expanded", "false");
    nav.setAttribute("data-open", "false");
  };

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isOpen));
    nav.setAttribute("data-open", String(!isOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target.tagName === "A") closeNav();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNav();
  });
}

function highlightActiveNavLink() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a, .footer-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    // Anchor links (e.g. index.html#guides) are in-page section jumps, not
    // distinct pages, so they never get marked as the "current page".
    if (href.includes("#")) return;

    const linkPath = href.split("/").pop() || "index.html";
    if (linkPath === currentPath) {
      link.setAttribute("aria-current", "page");
    }
  });
}

function setFooterYear() {
  document.querySelectorAll("[data-render='year']").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
}

/* ==========================================================================
   Link / placeholder helper
   ------------------------------------------------------------------
   Renders a real anchor when a URL exists, or a visibly muted
   "Coming soon" element when it doesn't — so we never ship a dead
   or guessed link.
   ========================================================================== */

function createLinkOrPlaceholder(url, label, className) {
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = className;
    a.textContent = label;
    return a;
  }

  const span = document.createElement("span");
  span.className = `${className} btn-placeholder`;
  span.setAttribute("aria-disabled", "true");
  span.textContent = label;

  const tag = document.createElement("span");
  tag.className = "badge badge-coming-soon";
  tag.textContent = "Coming soon";

  const wrapper = document.createElement("span");
  wrapper.style.display = "inline-flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "6px";
  wrapper.style.alignItems = "flex-start";
  wrapper.appendChild(span);
  wrapper.appendChild(tag);
  return wrapper;
}

/* ==========================================================================
   Active Campaign summary (homepage teaser)
   ========================================================================== */

function renderActiveCampaignSummary() {
  const el = document.querySelector("[data-render='active-campaign']");
  if (!el) return;

  const c = siteData.currentCampaign;
  el.innerHTML = "";

  const header = document.createElement("div");
  header.className = "campaign-card-header";

  const statusBadge = document.createElement("span");
  statusBadge.className = "badge badge-active";
  statusBadge.textContent = "Active now";
  header.appendChild(statusBadge);

  const title = document.createElement("h3");
  title.textContent = `${c.title} — ${c.subtitle}`;
  header.appendChild(title);

  el.appendChild(header);

  const desc = document.createElement("p");
  desc.textContent = c.description;
  el.appendChild(desc);

  const platformLine = document.createElement("p");
  platformLine.innerHTML = `<strong>Primary platform:</strong> ${capitalize(c.primaryPlatform)}`;
  el.appendChild(platformLine);

  const footer = document.createElement("div");
  footer.className = "campaign-card-footer";
  footer.appendChild(createLinkOrPlaceholder(c.primaryLink.url, "WATCH / STREAM NOW", "btn btn-primary"));

  const detailsLink = document.createElement("a");
  detailsLink.href = "campaign.html";
  detailsLink.className = "btn btn-secondary";
  detailsLink.textContent = "Full campaign details";
  footer.appendChild(detailsLink);

  el.appendChild(footer);
}

/* ==========================================================================
   Campaign hero (campaign.html)
   ========================================================================== */

function renderCampaignHero() {
  const el = document.querySelector("[data-render='campaign-hero']");
  if (!el) return;

  const c = siteData.currentCampaign;
  el.querySelectorAll("[data-field]").forEach((field) => {
    const key = field.getAttribute("data-field");
    if (key === "title") field.textContent = c.title;
    if (key === "subtitle") field.textContent = c.subtitle;
    if (key === "hero-message") field.textContent = c.heroMessage;
  });

  const ctaSlot = el.querySelector("[data-slot='primary-cta']");
  if (ctaSlot) {
    ctaSlot.innerHTML = "";
    ctaSlot.appendChild(createLinkOrPlaceholder(c.primaryLink.url, "▶ STREAM ON YOUTUBE", "btn btn-primary"));
  }
}

/* ==========================================================================
   Goals / milestones
   ------------------------------------------------------------------
   Milestone labels/targets are configured manually in js/data.js.
   The live view count comes from data/youtube-stats.json, generated by
   the update-youtube-views GitHub Actions workflow. If that file can't
   be loaded, goals fall back to the placeholder `current` values in
   js/data.js so the page never breaks.
   ========================================================================== */

async function loadAndRenderGoals() {
  const container = document.querySelector("[data-render='goals']");
  const stats = await fetchYoutubeStats();
  renderGoals(container, stats);
  renderGoalsMeta(stats);
}

async function fetchYoutubeStats() {
  try {
    const response = await fetch("data/youtube-stats.json", { cache: "no-store" });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || typeof data.viewCount !== "number") return null;

    return data;
  } catch (error) {
    console.warn("YouTube stats unavailable, falling back to placeholder goal values.", error);
    return null;
  }
}

function renderGoals(container, stats) {
  if (!container) return;
  const goals = siteData.currentCampaign.goals;

  if (!goals.length) {
    container.innerHTML = '<p class="empty-state">Goals for this campaign have not been set yet.</p>';
    return;
  }

  const liveViews = stats ? stats.viewCount : null;

  container.innerHTML = "";
  goals.forEach((goal) => {
    const current = liveViews !== null ? liveViews : goal.current;
    const percent = goal.target > 0
      ? Math.min(100, (current / goal.target) * 100)
      : 0;
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

/* ==========================================================================
   Platform Support Center
   ========================================================================== */

function renderPlatforms(container) {
  if (!container) return;
  container.innerHTML = "";

  siteData.currentCampaign.platforms.forEach((platform) => {
    const card = document.createElement("div");
    card.className = "card platform-card";

    const heading = document.createElement("h3");
    heading.textContent = platform.name;
    card.appendChild(heading);

    const actions = document.createElement("ul");
    actions.className = "platform-actions";
    platform.actions.forEach((action) => {
      const li = document.createElement("li");
      li.textContent = action;
      actions.appendChild(li);
    });
    card.appendChild(actions);

    card.appendChild(createLinkOrPlaceholder(platform.url, platform.cta, "btn btn-primary btn-block"));
    container.appendChild(card);
  });
}

/* ==========================================================================
   Today's Support Mission
   ========================================================================== */

function renderMissions(container) {
  if (!container) return;
  container.innerHTML = "";

  siteData.currentCampaign.missions.forEach((mission, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="mission-number" aria-hidden="true">${index + 1}</span>
      <span>${mission}</span>
    `;
    container.appendChild(li);
  });
}

/* ==========================================================================
   Quick Links
   ========================================================================== */

function renderQuickLinks(container) {
  if (!container) return;
  container.innerHTML = "";

  siteData.currentCampaign.quickLinks.forEach((link) => {
    const card = document.createElement("div");
    card.className = "card";

    const inner = `<span class="quicklink-icon" aria-hidden="true">${link.icon}</span><span class="quicklink-label">${link.label}</span>`;

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

/* ==========================================================================
   Campaign Updates / Announcements
   ========================================================================== */

function renderAnnouncements(container) {
  if (!container) return;
  const announcements = siteData.currentCampaign.announcements;

  if (!announcements.length) {
    container.innerHTML = '<p class="empty-state">No updates yet — check back soon.</p>';
    return;
  }

  container.innerHTML = "";
  announcements.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="announcement-date">${item.date}</span>
      <span>${item.message}</span>
    `;
    container.appendChild(li);
  });
}

/* ==========================================================================
   Streaming Guides hub cards
   ========================================================================== */

function renderGuides(container) {
  if (!container) return;
  container.innerHTML = "";

  siteData.guides.forEach((guide) => {
    const a = document.createElement("a");
    a.href = guide.href;
    a.className = "card";
    a.style.textDecoration = "none";
    a.style.color = "inherit";
    a.innerHTML = `<h3>${guide.label}</h3><p>${guide.description}</p>`;
    container.appendChild(a);
  });
}

/* ==========================================================================
   FAQ accordion
   ========================================================================== */

function renderFaq(container) {
  if (!container) return;
  container.innerHTML = "";

  siteData.faq.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "faq-item";

    const questionId = `faq-question-${index}`;
    const answerId = `faq-answer-${index}`;

    wrapper.innerHTML = `
      <h3 style="margin:0;">
        <button type="button" class="faq-question" id="${questionId}" aria-expanded="false" aria-controls="${answerId}">
          <span>${item.q}</span>
          <span class="faq-question-icon" aria-hidden="true">+</span>
        </button>
      </h3>
      <p class="faq-answer" id="${answerId}" role="region" aria-labelledby="${questionId}" hidden>${item.a}</p>
    `;
    container.appendChild(wrapper);
  });
}

function initFaqAccordion() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".faq-question");
    if (!button) return;

    const expanded = button.getAttribute("aria-expanded") === "true";
    const answer = document.getElementById(button.getAttribute("aria-controls"));
    button.setAttribute("aria-expanded", String(!expanded));
    if (answer) answer.hidden = expanded;
  });
}

/* ==========================================================================
   Utilities
   ========================================================================== */

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
