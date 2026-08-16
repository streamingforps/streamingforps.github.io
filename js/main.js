/*
  PerthSanta Streaming — shared behavior & rendering
  ------------------------------------------------------------------
  Loaded on every page after js/data.js. Each render* function checks
  whether its target container exists before doing anything, so this
  single file can safely run on index.html, campaign.html, and every
  guides/*.html page without errors.
*/

/*
  renderAllContent() renders every piece of siteData-driven content on
  whichever page is currently loaded (every render* function already
  no-ops if its target container isn't present, so this is safe to call
  on any page). It runs once on DOMContentLoaded like before, and is
  exposed on window so js/firestore-content.js can call it again after
  merging admin-managed content from Firestore on top of siteData —
  the page repaints with live data the moment it arrives, and simply
  keeps showing the js/data.js fallback forever if it never does.

  This function must stay render-only (safe to call more than once).
  One-time event wiring (nav toggle, FAQ accordion, comment helper,
  music modal) lives in the DOMContentLoaded handler below instead —
  calling those a second time would attach duplicate event listeners.
*/
function renderAllContent() {
  renderActiveCampaignSummary();
  renderCampaignHero();
  renderYoutubeStreamingGuide();
  loadAndRenderGoals();
  renderTikTokGoals();
  renderPlatforms(document.querySelector("[data-render='platforms']"));
  renderMissions(document.querySelector("[data-render='missions']"));
  renderQuickLinks(document.querySelector("[data-render='quick-links']"));
  renderMusicSections();
  renderAnnouncements(document.querySelector("[data-render='announcements']"));
  renderGuides(document.querySelector("[data-render='guides']"));
  renderFaq(document.querySelector("[data-render='faq']"));

  const relatedGuidesEl = document.querySelector("[data-render='related-guides']");
  if (relatedGuidesEl) {
    renderGuides(relatedGuidesEl, {
      excludeId: relatedGuidesEl.getAttribute("data-current-guide"),
      relativeToGuides: true
    });
  }
}
window.renderAllContent = renderAllContent;

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  highlightActiveNavLink();
  setFooterYear();
  initFaqAccordion();
  initCommentHelper();
  initMusicModal();
  initSiteSettingsMenu();

  renderAllContent();
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

/*
  Header settings menu (gear icon, far right) — a small popover with a
  single "Admin console" link. This is a convenience shortcut only; it
  implies nothing about security, which is enforced entirely by Firebase
  Auth + Firestore rules on admin.html itself.
*/
function initSiteSettingsMenu() {
  const toggle = document.querySelector(".site-settings-toggle");
  const menu = document.querySelector(".site-settings-menu");
  if (!toggle || !menu) return;

  const isOpen = () => !menu.hidden;

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (toggle.contains(event.target) || menu.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      closeMenu();
      toggle.focus();
    }
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
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
  footer.appendChild(
    createLinkOrPlaceholder(
      c.primaryLink.url,
      "STREAM ON YOUTUBE",
      "btn btn-primary"
    )
  );

  footer.appendChild(
    createLinkOrPlaceholder(
      c.tiktokLink.url,
      "STREAM ON TIKTOK",
      "btn btn-primary"
    )
  );

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

  ctaSlot.appendChild(
    createLinkOrPlaceholder(
      c.primaryLink.url,
      "▶ STREAM ON YOUTUBE",
      "btn btn-primary"
    )
  );

  ctaSlot.appendChild(
    createLinkOrPlaceholder(
      c.tiktokLink.url,
      "♪ STREAM ON TIKTOK",
      "btn btn-secondary"
    )
  );
}
}

/* ==========================================================================
   YouTube Streaming Guide (campaign.html)
   ------------------------------------------------------------------
   Fan-community streaming tips. The CTA reuses currentCampaign.primaryLink
   so it never duplicates the trailer URL, and the playlist list renders
   from siteData.streamingPlaylists so playlists can be added later without
   touching campaign.html.
   ========================================================================== */

function renderYoutubeStreamingGuide() {
  const ctaSlot = document.querySelector("[data-slot='youtube-guide-cta']");
  if (ctaSlot) {
    ctaSlot.innerHTML = "";
    ctaSlot.appendChild(
      createLinkOrPlaceholder(
        siteData.currentCampaign.primaryLink.url,
        "▶ WATCH THE HEARTBOUND PILOT",
        "btn btn-primary"
      )
    );
  }

  const playlistList = document.querySelector("[data-render='streaming-playlists']");
  if (!playlistList) return;

  playlistList.innerHTML = "";
  siteData.streamingPlaylists.forEach((playlist) => {
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
  if (!container) return;

  // Render the cards immediately using the fallback values from data.js
  renderGoals(container, null);

  // Then try to load the real YouTube view count
  const stats = await fetchYoutubeStats();

  if (stats) {
    renderGoals(container, stats);
  }

  renderGoalsMeta(stats);
}

function renderTikTokGoals() {
  const container = document.querySelector("[data-render='tiktok-goals']");
  if (!container) return;

  const goals = siteData.currentCampaign.tiktokGoals;
  const current = siteData.currentCampaign.tiktokCurrentViews || 0;

  if (!goals || !goals.length) {
    container.innerHTML = '<p class="empty-state">TikTok goals have not been set yet.</p>';
    return;
  }

  container.innerHTML = "";

  goals.forEach((goal) => {
    const percent = goal.target > 0
      ? Math.min(100, (current / goal.target) * 100)
      : 0;

    const reached = current >= goal.target;

    const card = document.createElement("div");
    card.className = `card goal-card${reached ? " is-reached" : ""}`;

    card.innerHTML = `
      <h3>
        ${goal.label}
        ${reached ? '<span class="badge badge-reached">Reached</span>' : ""}
      </h3>

      <div class="goal-values">
        <span>${formatNumber(current)}</span>
        <span>${formatNumber(goal.target)}</span>
      </div>

      <div
        class="progress-track"
        role="progressbar"
        aria-valuenow="${Math.round(percent)}"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="TikTok ${goal.label} progress"
      >
        <div class="progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;

    container.appendChild(card);
  });
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
   PerthSanta Music
   ------------------------------------------------------------------
   Independent of currentCampaign — a permanent hub for songs/OSTs that
   stays populated across campaigns. Add new songs directly to the
   relevant category array in `siteData.music` (js/data.js); no
   HTML/JS changes needed. Each category's <section> is hidden
   automatically when its array is empty.
   ========================================================================== */

const MUSIC_PLATFORM_LABELS = {
  youtube: "YouTube",
  spotify: "Spotify",
  appleMusic: "Apple Music",
  youtubeMusic: "YouTube Music"
};

function renderMusicSections() {
  const music = siteData.music || {};

  renderOstSection(document.querySelector("[data-render='music-osts']"), music.osts);
  renderMusicGrid(document.querySelector("[data-render='music-perthsanta']"), music.perthsanta);
  renderMusicGrid(document.querySelector("[data-render='music-perth-solo']"), music.perthSolo);
  renderMusicGrid(document.querySelector("[data-render='music-jasper']"), music.jasper);
}

// Shared "hide the section if empty" behavior for every music category.
function toggleMusicSection(container, hasSongs) {
  const section = container.closest("section");
  if (section) section.hidden = !hasSongs;
}

function renderMusicGrid(container, songs) {
  if (!container) return;
  const list = songs || [];
  toggleMusicSection(container, list.length > 0);
  if (!list.length) return;

  container.innerHTML = "";
  list.forEach((song) => {
    container.appendChild(buildMusicCard(song));
  });
}

// OSTs are additionally grouped by `series`, in first-seen order, each
// under its own subheading, so fans can find a series' songs together.
function renderOstSection(container, songs) {
  if (!container) return;
  const list = songs || [];
  toggleMusicSection(container, list.length > 0);
  if (!list.length) return;

  const seriesOrder = [];
  const bySeries = new Map();
  list.forEach((song) => {
    const key = song.series || "Other";
    if (!bySeries.has(key)) {
      bySeries.set(key, []);
      seriesOrder.push(key);
    }
    bySeries.get(key).push(song);
  });

  container.innerHTML = "";
  seriesOrder.forEach((seriesName) => {
    const group = document.createElement("div");
    group.className = "music-series-group";

    const heading = document.createElement("h3");
    heading.className = "music-series-heading";
    heading.textContent = seriesName;
    group.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "music-grid";
    bySeries.get(seriesName).forEach((song) => {
      grid.appendChild(buildMusicCard(song));
    });
    group.appendChild(grid);

    container.appendChild(group);
  });
}

// Fills an existing cover <div> (card or modal) with an <img> when a
// cover path is set, falling back to a placeholder icon on a missing
// or broken image so a bad path never leaves a blank box.
function fillMusicCover(container, song) {
  container.innerHTML = "";
  container.classList.remove("music-card-cover-placeholder");

  if (song.cover) {
    const img = document.createElement("img");
    img.src = song.cover;
    img.alt = song.title ? `${song.title} cover art` : "Song cover art";
    img.loading = "lazy";
    img.addEventListener(
      "error",
      () => {
        container.innerHTML = "";
        container.classList.add("music-card-cover-placeholder");
      },
      { once: true }
    );
    container.appendChild(img);
  } else {
    container.classList.add("music-card-cover-placeholder");
  }
}

function buildMusicCoverElement(song, className) {
  const cover = document.createElement("div");
  cover.className = className;
  fillMusicCover(cover, song);
  return cover;
}

function musicMetaText(song) {
  const metaParts = [];
  if (song.type) metaParts.push(song.type);
  if (song.series) metaParts.push(song.series);
  return metaParts.join(" • ");
}

// The whole card is a <button> so it's keyboard-operable (Enter/Space)
// for free, and clicking/activating it opens the platform-choice modal
// instead of jumping straight to one streaming service.
function buildMusicCard(song) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card music-card";

  card.appendChild(buildMusicCoverElement(song, "music-card-cover"));

  const body = document.createElement("div");
  body.className = "music-card-body";

  const title = document.createElement("h3");
  title.className = "music-card-title";
  title.textContent = song.title || "Untitled";
  body.appendChild(title);

  const artist = document.createElement("p");
  artist.className = "music-card-artist";
  artist.textContent = song.artist || siteData.site.name;
  body.appendChild(artist);

  const metaText = musicMetaText(song);
  if (metaText) {
    const meta = document.createElement("p");
    meta.className = "music-card-meta";
    meta.textContent = metaText;
    body.appendChild(meta);
  }

  if (song.release) {
    const release = document.createElement("p");
    release.className = "music-card-release";
    release.textContent = song.release;
    body.appendChild(release);
  }

  if (song.note) {
    const note = document.createElement("p");
    note.className = "music-card-note";
    note.textContent = song.note;
    body.appendChild(note);
  }

  const hint = document.createElement("span");
  hint.className = "music-card-hint";
  hint.textContent = "Stream now →";
  body.appendChild(hint);

  card.appendChild(body);

  card.addEventListener("click", () => openMusicModal(song, card));

  return card;
}

/* ==========================================================================
   Music streaming modal
   ------------------------------------------------------------------
   A single modal instance (markup lives once in music.html) is reused
   for every card — opening it just repopulates its content from the
   clicked song. Only rendered/queried on pages that have the markup.
   ========================================================================== */

const musicModalState = {
  previouslyFocused: null
};

function getMusicModalEls() {
  const overlay = document.querySelector("[data-music-modal]");
  if (!overlay) return null;

  return {
    overlay,
    dialog: overlay.querySelector(".music-modal"),
    closeBtn: overlay.querySelector("[data-music-modal-close]"),
    cover: overlay.querySelector("[data-music-modal-cover]"),
    title: overlay.querySelector("[data-music-modal-title]"),
    artist: overlay.querySelector("[data-music-modal-artist]"),
    meta: overlay.querySelector("[data-music-modal-meta]"),
    links: overlay.querySelector("[data-music-modal-links]")
  };
}

function initMusicModal() {
  const els = getMusicModalEls();
  if (!els) return;

  els.closeBtn.addEventListener("click", closeMusicModal);

  els.overlay.addEventListener("click", (event) => {
    if (event.target === els.overlay) closeMusicModal();
  });

  document.addEventListener("keydown", handleMusicModalKeydown);
}

function openMusicModal(song, triggerEl) {
  const els = getMusicModalEls();
  if (!els) return;

  musicModalState.previouslyFocused = triggerEl || document.activeElement;

  fillMusicCover(els.cover, song);

  els.title.textContent = song.title || "Untitled";
  els.artist.textContent = song.artist || siteData.site.name;

  const metaText = musicMetaText(song);
  els.meta.textContent = metaText;
  els.meta.hidden = !metaText;

  els.links.innerHTML = "";
  const links = song.links || {};
  const entries = Object.entries(links).filter(([, url]) => !!url);

  if (entries.length) {
    entries.forEach(([key, url]) => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "btn btn-primary btn-block";
      a.textContent = MUSIC_PLATFORM_LABELS[key] || capitalize(key);
      els.links.appendChild(a);
    });
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Streaming links coming soon.";
    els.links.appendChild(empty);
  }

  els.overlay.hidden = false;
  document.body.classList.add("music-modal-open");
  els.closeBtn.focus();
}

function closeMusicModal() {
  const els = getMusicModalEls();
  if (!els || els.overlay.hidden) return;

  els.overlay.hidden = true;
  document.body.classList.remove("music-modal-open");

  if (musicModalState.previouslyFocused) {
    musicModalState.previouslyFocused.focus();
    musicModalState.previouslyFocused = null;
  }
}

function handleMusicModalKeydown(event) {
  const els = getMusicModalEls();
  if (!els || els.overlay.hidden) return;

  if (event.key === "Escape") {
    closeMusicModal();
    return;
  }

  if (event.key === "Tab") {
    const focusables = Array.from(
      els.overlay.querySelectorAll('a[href], button:not([disabled])')
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/* ==========================================================================
   Campaign Updates / Announcements
   ------------------------------------------------------------------
   Each announcement is a typed update card. `type` selects the category
   badge text/color via ANNOUNCEMENT_TYPES below — add a new type there
   if you introduce one in js/data.js.
   ========================================================================== */

const ANNOUNCEMENT_TYPES = {
  milestone: { badge: "MILESTONE", className: "update-card--milestone" },
  goal: { badge: "NEXT GOAL", className: "update-card--goal" },
  reminder: { badge: "REMINDER", className: "update-card--reminder" },
  tool: { badge: "NEW TOOL", className: "update-card--tool" },
  important: { badge: "IMPORTANT", className: "update-card--important" }
};

function renderAnnouncements(container) {
  if (!container) return;
  const announcements = siteData.currentCampaign.announcements;

  if (!announcements.length) {
    container.innerHTML = '<p class="empty-state">No updates yet — check back soon.</p>';
    return;
  }

  container.innerHTML = "";
  announcements.forEach((item, index) => {
    const typeInfo = ANNOUNCEMENT_TYPES[item.type] || { badge: item.type ? item.type.toUpperCase() : "UPDATE", className: "" };

    const li = document.createElement("li");
    li.className = `update-card ${typeInfo.className}`;
    if (index === 0) li.classList.add("update-card--featured");

    const header = document.createElement("div");
    header.className = "update-card-header";

    const badge = document.createElement("span");
    badge.className = "update-card-badge";
    badge.textContent = typeInfo.badge;
    header.appendChild(badge);

    const icon = document.createElement("span");
    icon.className = "update-card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon || "";
    header.appendChild(icon);

    li.appendChild(header);

    const title = document.createElement("h3");
    title.className = "update-card-title";
    title.textContent = item.title;
    li.appendChild(title);

    const message = document.createElement("p");
    message.className = "update-card-message";
    message.textContent = item.message;
    li.appendChild(message);

    if (item.date) {
      const date = document.createElement("span");
      date.className = "update-card-date";
      date.textContent = item.date;
      li.appendChild(date);
    }

    if (item.ctaHref) {
      const cta = document.createElement("a");
      cta.className = "btn btn-secondary btn-sm update-card-cta";
      cta.href = item.ctaHref;
      cta.textContent = item.ctaLabel || "Learn more";
      li.appendChild(cta);
    }

    container.appendChild(li);
  });
}

/* ==========================================================================
   Streaming Guides hub cards
   ========================================================================== */

function renderGuides(container, options = {}) {
  if (!container) return;
  const { excludeId = null, relativeToGuides = false } = options;
  container.innerHTML = "";

  siteData.guides
    .filter((guide) => guide.id !== excludeId)
    .forEach((guide) => {
    const a = document.createElement("a");
    a.href = relativeToGuides ? guide.href.replace(/^guides\//, "") : guide.href;
    a.className = "card guide-card";

    const icon = document.createElement("span");
    icon.className = "guide-card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = guide.icon || "";
    a.appendChild(icon);

    const title = document.createElement("h3");
    title.className = "guide-card-title";
    title.textContent = guide.label;
    a.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "guide-card-desc";
    desc.textContent = guide.description;
    a.appendChild(desc);

    const cta = document.createElement("span");
    cta.className = "guide-card-cta";
    cta.innerHTML = `Open Guide <span class="guide-card-cta-arrow" aria-hidden="true">→</span>`;
    a.appendChild(cta);

    container.appendChild(a);
  });
}

/* ==========================================================================
   Comment Helper (campaign.html)
   ------------------------------------------------------------------
   Generates a comment suggestion entirely client-side from the phrase
   pools in siteData.commentHelper — nothing is posted anywhere
   automatically, and no external API is called. The user always edits
   and copies the suggestion themselves.
   ========================================================================== */

function generateComment(styleId, lengthId) {
  const helper = siteData.commentHelper;
  if (!helper || !helper.phrases) return "";

  if (styleId === "simple") {
    const lineCounts = { short: 1, medium: 2, longer: 3 };
    const count = lineCounts[lengthId] || 1;
    const lines = pickRandomUnique(helper.phrases.simple.lines, count);
    return lines.join(" ");
  }

  const pool = helper.phrases[styleId];
  if (!pool) return "";

  const sentences = [];

  if (lengthId === "medium") {
    sentences.push(pickRandomItem(pool.openings));
    const secondCategory = Math.random() < 0.5 ? "observations" : "reactions";
    sentences.push(pickRandomItem(pool[secondCategory]));
  } else if (lengthId === "longer") {
    sentences.push(pickRandomItem(pool.openings));
    sentences.push(pickRandomItem(pool.observations));
    sentences.push(pickRandomItem(pool.reactions));
    sentences.push(pickRandomItem(pool.endings));
  } else {
    // "short" (and any unrecognized length) — a single natural sentence.
    const category = Math.random() < 0.5 ? "openings" : "reactions";
    sentences.push(pickRandomItem(pool[category]));
  }

  return sentences.join(" ");
}

function initCommentHelper() {
  const styleSelect = document.querySelector("[data-comment-style]");
  const lengthSelect = document.querySelector("[data-comment-length]");
  const generateBtn = document.querySelector("[data-comment-generate]");
  const regenerateBtn = document.querySelector("[data-comment-regenerate]");
  const copyBtn = document.querySelector("[data-comment-copy]");
  const resultBox = document.querySelector("[data-comment-result]");
  const textEl = document.querySelector("[data-comment-text]");

  if (!styleSelect || !lengthSelect || !generateBtn || !resultBox || !textEl) return;

  const helper = siteData.commentHelper;
  if (!helper) return;

  styleSelect.innerHTML = "";
  helper.styles.forEach((style) => {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.label;
    styleSelect.appendChild(option);
  });

  lengthSelect.innerHTML = "";
  helper.lengths.forEach((length) => {
    const option = document.createElement("option");
    option.value = length.id;
    option.textContent = length.label;
    lengthSelect.appendChild(option);
  });

  const showGeneratedComment = () => {
    textEl.textContent = generateComment(styleSelect.value, lengthSelect.value);
    resultBox.hidden = false;
  };

  generateBtn.addEventListener("click", showGeneratedComment);
  if (regenerateBtn) regenerateBtn.addEventListener("click", showGeneratedComment);

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = textEl.textContent;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const originalLabel = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalLabel;
        }, 1500);
      } catch (error) {
        console.warn("Clipboard copy failed.", error);
      }
    });
  }
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

function pickRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Picks up to n distinct random items (no repeats within one result).
function pickRandomUnique(arr, n) {
  const pool = arr.slice();
  const result = [];
  for (let i = 0; i < n && pool.length; i++) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}
