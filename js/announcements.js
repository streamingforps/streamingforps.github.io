/*
  PerthSanta Streaming — announcements (homepage teaser + full archive)
  ------------------------------------------------------------------
  Both the homepage's "Announcements" section and the standalone
  announcements.html archive read the exact same source — siteData.announcements
  (kept in sync with Firestore's content/announcements doc by
  js/firestore-content.js, same as every other piece of admin-managed
  content). There is no separate archive dataset: the homepage simply
  shows the newest 6, the archive shows all of them, newest first, sorted
  by each announcement's existing `date` field (there's no separate
  createdAt timestamp in this schema).

  Every render* function below no-ops if its target container isn't on
  the current page, so this file is safe to load on every page — same
  convention as js/main.js and js/campaigns.js.
*/

const ANNOUNCEMENT_CATEGORIES = ["Heartbound", "Music", "JASP.ER", "Streaming", "Campaign", "General"];
const ANNOUNCEMENT_HOMEPAGE_LIMIT = 6;
const ANNOUNCEMENT_ARCHIVE_PAGE_SIZE = 12;

function formatAnnouncementDate(dateStr) {
  if (!dateStr) return "";
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(parsed);
}

function getAnnouncementsSortedNewest() {
  return (siteData.announcements || [])
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Normalizes both shapes: new `categories: [...]` (preferred, always written
// going forward) and legacy single `category: "..."` (still read correctly
// so old Firestore/fallback data never breaks). Falls back to ["General"]
// only if neither is present, matching the old single-category code's
// existing "General" default.
function getAnnouncementCategories(announcement) {
  if (Array.isArray(announcement.categories) && announcement.categories.length) {
    return announcement.categories;
  }
  if (announcement.category) return [announcement.category];
  return ["General"];
}

function buildAnnouncementCard(item) {
  const li = document.createElement("li");
  li.className = "announcement-card";

  const header = document.createElement("div");
  header.className = "announcement-card-header";

  const badges = document.createElement("div");
  badges.className = "announcement-card-badges";
  getAnnouncementCategories(item).forEach((category) => {
    const badge = document.createElement("span");
    badge.className = "announcement-badge";
    badge.textContent = category.toUpperCase();
    badges.appendChild(badge);
  });
  header.appendChild(badges);

  if (item.date) {
    const date = document.createElement("span");
    date.className = "announcement-card-date";
    date.textContent = formatAnnouncementDate(item.date);
    header.appendChild(date);
  }

  li.appendChild(header);

  const title = document.createElement("h3");
  title.className = "announcement-card-title";
  title.textContent = item.title;
  li.appendChild(title);

  const message = document.createElement("p");
  message.className = "announcement-card-message";
  message.textContent = item.message;
  li.appendChild(message);

  if (item.url) {
    const cta = document.createElement("a");
    cta.className = "btn btn-secondary btn-sm announcement-card-cta";
    cta.href = item.url;
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = item.ctaLabel || "Learn more";
    li.appendChild(cta);
  }

  return li;
}

function renderAnnouncementCards(container, items) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<p class="empty-state">No announcements yet — check back soon.</p>';
    return;
  }
  items.forEach((item) => container.appendChild(buildAnnouncementCard(item)));
}

/* ==========================================================================
   Homepage — newest 6, with a "View All Announcements" link only when
   there are more than 6 total.
   ========================================================================== */

function renderHomepageAnnouncements() {
  const container = document.querySelector("[data-render='announcements']");
  if (!container) return;

  const all = getAnnouncementsSortedNewest();
  renderAnnouncementCards(container, all.slice(0, ANNOUNCEMENT_HOMEPAGE_LIMIT));

  const viewAllEl = document.querySelector("[data-render='announcements-view-all']");
  if (!viewAllEl) return;

  if (all.length > ANNOUNCEMENT_HOMEPAGE_LIMIT) {
    viewAllEl.hidden = false;
    viewAllEl.innerHTML = "";
    const link = document.createElement("a");
    link.className = "btn btn-secondary";
    link.href = "announcements.html";
    link.textContent = "View All Announcements";
    viewAllEl.appendChild(link);
  } else {
    viewAllEl.hidden = true;
    viewAllEl.innerHTML = "";
  }
}

/* ==========================================================================
   Archive (announcements.html) — full list, newest first, revealed 12 at a
   time via "Load More". The whole list already loads as a single Firestore
   document read (same as every other array-shaped content doc on this
   site), so "pagination" here is just revealing more of an already-loaded
   array — no extra reads per page of results.
   ========================================================================== */

let announcementArchiveVisibleCount = ANNOUNCEMENT_ARCHIVE_PAGE_SIZE;
let announcementArchiveFilter = "all";

function renderAnnouncementArchive() {
  const container = document.querySelector("[data-render='announcement-archive']");
  if (!container) return;

  const all = getAnnouncementsSortedNewest();
  const filtered = announcementArchiveFilter === "all"
    ? all
    : all.filter((item) => getAnnouncementCategories(item).includes(announcementArchiveFilter));

  const visible = filtered.slice(0, announcementArchiveVisibleCount);
  renderAnnouncementCards(container, visible);

  const loadMoreBtn = document.querySelector("[data-announcement-load-more]");
  if (loadMoreBtn) loadMoreBtn.hidden = filtered.length <= announcementArchiveVisibleCount;
}

// One-time event wiring — called once from js/main.js's DOMContentLoaded
// handler, not from the repeatable render pipeline, so re-renders (e.g.
// after Firestore resolves) never attach duplicate click listeners.
function initAnnouncementInteractions() {
  const loadMoreBtn = document.querySelector("[data-announcement-load-more]");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      announcementArchiveVisibleCount += ANNOUNCEMENT_ARCHIVE_PAGE_SIZE;
      renderAnnouncementArchive();
    });
  }

  const filterTabs = document.querySelectorAll("[data-announcement-filter]");
  if (filterTabs.length) {
    filterTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        filterTabs.forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        announcementArchiveFilter = tab.getAttribute("data-announcement-filter");
        announcementArchiveVisibleCount = ANNOUNCEMENT_ARCHIVE_PAGE_SIZE;
        renderAnnouncementArchive();
      });
    });
  }
}

/* ==========================================================================
   Entry point — called from js/main.js's renderAllContent()
   ========================================================================== */

function renderAnnouncementSections() {
  renderHomepageAnnouncements();
  renderAnnouncementArchive();
}
