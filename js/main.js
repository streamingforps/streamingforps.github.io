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
  // js/campaigns.js is loaded on every public page, but this guard means
  // renderAllContent() (and therefore every renderer after it, including
  // music/announcements/guides/faq below) never breaks on a page that for
  // any reason doesn't have it loaded.
  if (typeof renderCampaignSections === "function") renderCampaignSections();
  renderMusicSections();
  if (typeof renderAnnouncementSections === "function") renderAnnouncementSections();
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
  if (typeof initCommentHelperInteractions === "function") initCommentHelperInteractions();
  initMusicModal();
  initSiteSettingsMenu();
  initMoreMenu();
  if (typeof initCampaignFilters === "function") initCampaignFilters();
  if (typeof initAnnouncementInteractions === "function") initAnnouncementInteractions();

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

/*
  "More" nav dropdown (Platforms, FAQ / Important Info) — keeps the
  primary desktop nav row short. Same open/close/outside-click/Escape
  pattern as initSiteSettingsMenu() above, just scoped to its own
  toggle/menu pair so the two never interfere with each other (or with
  js/auth.js's independent account-menu listeners).
*/
function initMoreMenu() {
  const toggle = document.querySelector(".nav-more-toggle");
  const menu = document.querySelector(".nav-more-menu");
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
   PerthSanta Music
   ------------------------------------------------------------------
   Independent of any campaign — a permanent hub for songs/OSTs that
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
