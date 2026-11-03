/*
  PerthSanta Streaming — admin console logic.
  ------------------------------------------------------------------
  Loaded only by admin.html. Handles:
    - Email/password auth (no signup) + admin UID gate
    - Loading each Firestore doc (falling back to js/data.js's shape
      as a starting point when a doc doesn't exist yet)
    - Editable list UIs (add / edit / reorder / delete) for every
      content type, saving the whole doc back with setDoc()
    - Success/error feedback and disabled-while-saving buttons

  IMPORTANT: the client-side ADMIN_UID check below is a UX convenience
  only (so a non-admin account doesn't see the dashboard). It is NOT
  the security boundary — Firestore Security Rules are, and every write
  below will fail with a clear on-screen error if the rules ever reject
  it, no matter what this file does.

  admin.html also loads js/data.js as a plain classic script before this
  module, purely so the fallback shapes below (FALLBACK_DATA) can read
  the real siteData object as their single source of truth — instead of
  duplicating hundreds of lines of content (e.g. the Comment Helper
  phrase banks) by hand in a second place where it could drift out of
  sync. js/data.js is never written to from here.
*/

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  getCountFromServer,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { ADMIN_UID } from "./firebase-config.js";
import { auth, db } from "./firebase-app.js";
import { renderDomiiaAmount } from "./domiia.js";
import { normalizeTrackableUrl } from "./url-normalize.js";

/* ==========================================================================
   Fallback content — derived from the real siteData global (js/data.js,
   loaded as a classic script before this module). Used only to seed a
   form/list the very first time, before any Firestore doc for that
   section exists yet. Firestore, once saved, is always the real source
   of truth for the admin console itself.

   Site Settings has no data.js equivalent (those values are hardcoded
   directly in the public HTML today), so its fallback is hand-written
   to match what's currently in the markup.
   ========================================================================== */

const hasSiteData = typeof siteData !== "undefined";
const fallbackCampaigns = hasSiteData && Array.isArray(siteData.campaigns) ? siteData.campaigns : [];
const fallbackHeartbound = fallbackCampaigns.find((c) => c.id === "heartbound") || {};
const fallbackNewSeries2026 = fallbackCampaigns.find((c) => c.id === "new-series-2026") || {};

const FALLBACK_DATA = {
  // Full campaign objects (data.js shape) — seeds the Campaign Manager list
  // for any campaign that doesn't have a live campaigns/{id} doc yet.
  campaigns: fallbackCampaigns,
  tiktokCurrentViews: (fallbackHeartbound.stats && fallbackHeartbound.stats.tiktokCurrentViews) || 0,
  youtubeGoals: (fallbackHeartbound.goals && fallbackHeartbound.goals.youtube) || [],
  tiktokGoals: (fallbackHeartbound.goals && fallbackHeartbound.goals.tiktok) || [],
  announcements: hasSiteData ? siteData.announcements || [] : [],
  faq: hasSiteData ? siteData.faq || [] : [],
  music: hasSiteData ? siteData.music || { osts: [], perthsanta: [], perthSolo: [], jasper: [] } : { osts: [], perthsanta: [], perthSolo: [], jasper: [] },
  // Heartbound's old style/length comment-template banks — used ONLY by the
  // "Migrate Heartbound Comment Helper" action to pre-bake a flat phrase
  // library; never shown as an editable form on its own anymore.
  commentHelperLegacyTemplates: hasSiteData ? siteData.commentHelperLegacyTemplates || { styles: [], lengths: [], phrases: {} } : { styles: [], lengths: [], phrases: {} },
  commentHelperFallback: hasSiteData ? siteData.commentHelperFallback || { heartbound: [] } : { heartbound: [] },
  trending: hasSiteData && siteData.trending
    ? siteData.trending
    : {
        perthsanta: { eventName: "", keyword: "", hashtags: [], active: false },
        perth: { eventName: "", keyword: "", hashtags: [], active: false },
        santa: { eventName: "", keyword: "", hashtags: [], active: false }
      },
  siteSettings: {
    homepageCampaignImage: "assets/images/homepage.jpg",
    campaignPageImage: "assets/images/heartbound.jpg",
    profileImage: "assets/images/streaming4ps-profile.jpg",
    footerAccountUrl: "https://x.com/Streaming4PS",
    footerDescription:
      "Created to unlock the full streaming potential of PerthSanta and bring fans together to support their projects."
  }
};

/* ==========================================================================
   Small shared helpers
   ========================================================================== */

function $(selector) {
  return document.querySelector(selector);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setStatus(el, message, state) {
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.removeAttribute("data-state");
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.setAttribute("data-state", state || "pending");
}

async function withSaving(button, statusEl, pendingMessage, fn) {
  if (button) button.disabled = true;
  setStatus(statusEl, pendingMessage || "Saving…", "pending");
  try {
    await fn();
    setStatus(statusEl, "Saved.", "success");
  } catch (error) {
    console.error(error);
    setStatus(statusEl, `Couldn't save: ${error.message || "unknown error"}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function confirmDelete(message) {
  return window.confirm(message || "Delete this item? This can't be undone.");
}

async function loadDocOr(path, fallback) {
  try {
    const snap = await getDoc(doc(db, path));
    if (snap.exists()) return snap.data();
  } catch (error) {
    console.warn(`Could not load ${path}, using fallback.`, error);
  }
  return clone(fallback);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}

function formatTimestamp(value) {
  if (!value) return "Never";
  const dateObj = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(dateObj.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(dateObj);
}

/* ==========================================================================
   Panel navigation
   ========================================================================== */

function showPanel(panelId) {
  document.querySelectorAll(".admin-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-panel") === panelId);
  });
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-panel") === panelId);
  });
}

function initNav() {
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showPanel(btn.getAttribute("data-panel")));
  });
}

/* ==========================================================================
   Generic editable array-of-items panel
   ------------------------------------------------------------------
   Powers YouTube/TikTok goals, Campaign Updates, FAQ, Quick Links,
   Official Accounts, and Today's Support Mission. Music and Comment
   Helper have their own bespoke wiring below because they involve
   sub-category tabs and nested data.
   ========================================================================== */

function createArrayPanel(config) {
  const {
    listEl,
    addBtn,
    saveBtn,
    statusEl,
    docPath,
    fallback,
    itemType, // "object" | "string"
    fields, // for itemType "object": [{ key, label, type, placeholder, required }]
    newItem, // () => blank item
    buildSaveData, // (items) => data to setDoc
    extractItems, // (docData) => items array
    twoColumn
  } = config;

  let items = [];

  function renderList() {
    listEl.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "Nothing here yet — use the button below to add one.";
      listEl.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "admin-item";

      const toolbar = document.createElement("div");
      toolbar.className = "admin-item-toolbar";

      const label = document.createElement("span");
      label.className = "admin-item-index";
      label.textContent = `#${index + 1}`;
      toolbar.appendChild(label);

      const actions = document.createElement("div");
      actions.className = "admin-item-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.textContent = "↑";
      upBtn.setAttribute("aria-label", "Move up");
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => {
        [items[index - 1], items[index]] = [items[index], items[index - 1]];
        renderList();
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.textContent = "↓";
      downBtn.setAttribute("aria-label", "Move down");
      downBtn.disabled = index === items.length - 1;
      downBtn.addEventListener("click", () => {
        [items[index], items[index + 1]] = [items[index + 1], items[index]];
        renderList();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "admin-delete-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.setAttribute("aria-label", "Delete");
      deleteBtn.addEventListener("click", () => {
        if (!confirmDelete("Delete this item? This can't be undone.")) return;
        items.splice(index, 1);
        renderList();
      });

      actions.append(upBtn, downBtn, deleteBtn);
      toolbar.appendChild(actions);
      row.appendChild(toolbar);

      if (itemType === "string") {
        const input = document.createElement("input");
        input.type = "text";
        input.value = item;
        input.addEventListener("input", () => {
          items[index] = input.value;
        });
        row.appendChild(input);
      } else {
        const grid = document.createElement("div");
        grid.className = `admin-item-fields${twoColumn ? " admin-item-fields--2col" : ""}`;

        fields.forEach((field) => {
          const wrap = document.createElement("div");
          wrap.className = "admin-item-field";

          const fieldLabel = document.createElement("label");
          fieldLabel.textContent = field.label;
          wrap.appendChild(fieldLabel);

          let control;
          if (field.type === "textarea") {
            control = document.createElement("textarea");
            control.rows = 3;
          } else if (field.type === "select") {
            control = document.createElement("select");
            field.options.forEach((opt) => {
              const optionEl = document.createElement("option");
              optionEl.value = opt;
              optionEl.textContent = opt;
              control.appendChild(optionEl);
            });
          } else if (field.type === "checkboxes") {
            // item[field.key] is an array of selected option strings, not a
            // scalar — handled entirely separately from the generic
            // value/input-listener wiring below.
            control = document.createElement("div");
            control.className = "admin-checkbox-group";
            const selected = Array.isArray(item[field.key]) ? item[field.key] : [];
            field.options.forEach((opt) => {
              const optLabel = document.createElement("label");
              optLabel.className = "admin-checkbox-label";

              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = selected.includes(opt);
              checkbox.addEventListener("change", () => {
                const current = Array.isArray(item[field.key]) ? item[field.key].slice() : [];
                const idx = current.indexOf(opt);
                if (checkbox.checked && idx === -1) current.push(opt);
                if (!checkbox.checked && idx !== -1) current.splice(idx, 1);
                item[field.key] = current;
              });

              optLabel.appendChild(checkbox);
              optLabel.appendChild(document.createTextNode(` ${opt}`));
              control.appendChild(optLabel);
            });
          } else {
            control = document.createElement("input");
            control.type = field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
            if (field.type === "number") {
              control.min = "0";
              control.step = "1";
            }
          }

          if (field.type !== "checkboxes") {
            if (field.placeholder) control.placeholder = field.placeholder;
            control.value = item[field.key] === null || item[field.key] === undefined ? "" : item[field.key];

            control.addEventListener("input", () => {
              item[field.key] = control.value;
            });
          }

          wrap.appendChild(control);
          grid.appendChild(wrap);
        });

        row.appendChild(grid);
      }

      listEl.appendChild(row);
    });
  }

  function validate() {
    if (itemType === "string") {
      for (const item of items) {
        if (!isNonEmptyString(item)) return "Every item needs some text — check the highlighted list.";
      }
      return null;
    }

    for (const item of items) {
      for (const field of fields) {
        const value = item[field.key];

        if (field.type === "checkboxes") {
          if (field.required && (!Array.isArray(value) || value.length === 0)) {
            return field.requiredMessage || `Select at least one option for "${field.label}" on every item.`;
          }
          continue;
        }

        if (field.required && !isNonEmptyString(String(value ?? ""))) {
          return `"${field.label}" is required on every item.`;
        }
        if (field.type === "number" && isNonEmptyString(String(value ?? "")) && !isNonNegativeInteger(value)) {
          return `"${field.label}" must be a non-negative whole number.`;
        }
        if (field.type === "url" && isNonEmptyString(String(value ?? "")) && !isHttpUrl(String(value))) {
          return `"${field.label}" must start with http:// or https://.`;
        }
      }
    }
    return null;
  }

  async function load() {
    const data = await loadDocOr(docPath, { items: clone(fallback) });
    items = clone(extractItems ? extractItems(data) : data.items || fallback);
    renderList();
  }

  function setItems(newItems) {
    items = clone(newItems);
    renderList();
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      items.push(newItem());
      renderList();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const error = validate();
      if (error) {
        setStatus(statusEl, error, "error");
        return;
      }
      withSaving(saveBtn, statusEl, "Saving…", async () => {
        await setDoc(doc(db, docPath), buildSaveData ? buildSaveData(items) : { items });
      });
    });
  }

  return { load, getItems: () => items, setItems };
}

/* ==========================================================================
   YouTube / TikTok streaming goals
   ========================================================================== */

const youtubeGoalsPanel = createArrayPanel({
  listEl: $("#youtube-goals-list"),
  addBtn: $("#youtube-goal-add"),
  saveBtn: $("#youtube-goals-save"),
  statusEl: $("#youtube-goals-status"),
  docPath: "campaign/goals",
  fallback: FALLBACK_DATA.youtubeGoals,
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true, placeholder: "1M Views" },
    { key: "target", label: "Target", type: "number", required: true }
  ],
  newItem: () => ({ label: "", target: 0 }),
  buildSaveData: (items) => ({
    items: items.map((g) => ({ label: g.label.trim(), target: Number(g.target) }))
  })
});

const tiktokGoalsPanel = createArrayPanel({
  listEl: $("#tiktok-goals-list"),
  addBtn: $("#tiktok-goal-add"),
  saveBtn: $("#tiktok-goals-save"),
  statusEl: $("#tiktok-goals-status"),
  docPath: "campaign/tiktokGoals",
  fallback: FALLBACK_DATA.tiktokGoals,
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true, placeholder: "1M Views" },
    { key: "target", label: "Target", type: "number", required: true }
  ],
  newItem: () => ({ label: "", target: 0 }),
  buildSaveData: (items) => ({
    items: items.map((g) => ({ label: g.label.trim(), target: Number(g.target) }))
  })
});

/* ==========================================================================
   Announcements — general, site-wide feed (not campaign-scoped)
   ========================================================================== */

const ANNOUNCEMENT_CATEGORIES = ["Heartbound", "Music", "JASP.ER", "Streaming", "Campaign", "General"];

const announcementsPanel = createArrayPanel({
  listEl: $("#announcements-list"),
  addBtn: $("#announcement-add"),
  saveBtn: $("#announcements-save"),
  statusEl: $("#announcements-status"),
  docPath: "content/announcements",
  fallback: FALLBACK_DATA.announcements,
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "date", label: "Date (YYYY-MM-DD)", type: "text", required: true, placeholder: "2026-08-17" },
    {
      key: "categories",
      label: "Categories",
      type: "checkboxes",
      options: ANNOUNCEMENT_CATEGORIES,
      required: true,
      requiredMessage: "Select at least one category."
    },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "message", label: "Message", type: "textarea", required: true },
    { key: "url", label: "URL (optional)", type: "url" },
    { key: "ctaLabel", label: "CTA label (optional)", type: "text" }
  ],
  newItem: () => ({ date: "", categories: [], title: "", message: "", url: null, ctaLabel: null }),
  // Loading an announcement that still uses the old single `category`
  // field normalizes it into `categories: [...]` so the checkboxes render
  // correctly; saving always writes the new array form only (the old
  // `category` property is never written back).
  extractItems: (data) => (data.items || FALLBACK_DATA.announcements).map((a) => ({
    date: a.date || "",
    categories: Array.isArray(a.categories) ? a.categories.slice() : (a.category ? [a.category] : []),
    title: a.title || "",
    message: a.message || "",
    url: a.url || null,
    ctaLabel: a.ctaLabel || null
  })),
  buildSaveData: (items) => ({
    items: items.map((a) => ({
      date: a.date.trim(),
      categories: Array.from(new Set((a.categories || []).filter(Boolean))),
      title: a.title.trim(),
      message: a.message.trim(),
      url: isNonEmptyString(a.url) ? a.url.trim() : null,
      ctaLabel: isNonEmptyString(a.ctaLabel) ? a.ctaLabel.trim() : null
    }))
  })
});

/* ==========================================================================
   FAQ
   ========================================================================== */

const faqPanel = createArrayPanel({
  listEl: $("#faq-list"),
  addBtn: $("#faq-add"),
  saveBtn: $("#faq-save"),
  statusEl: $("#faq-status"),
  docPath: "content/faq",
  fallback: FALLBACK_DATA.faq,
  itemType: "object",
  fields: [
    { key: "q", label: "Question", type: "text", required: true },
    { key: "a", label: "Answer (supports <strong>bold</strong> HTML)", type: "textarea", required: true }
  ],
  newItem: () => ({ q: "", a: "" }),
  buildSaveData: (items) => ({
    items: items.map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
  })
});

/* ==========================================================================
   Music (four categories inside a single Firestore document)
   ========================================================================== */

const MUSIC_CATEGORIES = ["osts", "perthsanta", "perthSolo", "jasper"];
const MUSIC_SONG_FIELDS = [
  { key: "id", label: "ID (unique slug)", type: "text", required: true },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "artist", label: "Artist", type: "text", required: true },
  { key: "type", label: "Type (OST / Single / Solo / Group)", type: "text", required: true },
  { key: "series", label: "Series / project (OST grouping, optional)", type: "text" },
  { key: "cover", label: "Cover image path (optional)", type: "text", placeholder: "assets/images/music/example.jpg" },
  { key: "linkYoutube", label: "YouTube URL", type: "url" },
  { key: "linkSpotify", label: "Spotify URL", type: "url" },
  { key: "linkAppleMusic", label: "Apple Music URL", type: "url" },
  { key: "linkYoutubeMusic", label: "YouTube Music URL", type: "url" }
];

let musicData = clone(FALLBACK_DATA.music);
let activeMusicCategory = "osts";

function songToForm(song) {
  return {
    id: song.id || "",
    title: song.title || "",
    artist: song.artist || "",
    type: song.type || "",
    series: song.series || "",
    cover: song.cover || "",
    linkYoutube: (song.links && song.links.youtube) || "",
    linkSpotify: (song.links && song.links.spotify) || "",
    linkAppleMusic: (song.links && song.links.appleMusic) || "",
    linkYoutubeMusic: (song.links && song.links.youtubeMusic) || ""
  };
}

function formToSong(form) {
  return {
    id: form.id.trim(),
    title: form.title.trim(),
    artist: form.artist.trim(),
    type: form.type.trim(),
    series: isNonEmptyString(form.series) ? form.series.trim() : null,
    release: null,
    note: null,
    cover: isNonEmptyString(form.cover) ? form.cover.trim() : null,
    links: {
      youtube: isNonEmptyString(form.linkYoutube) ? form.linkYoutube.trim() : null,
      spotify: isNonEmptyString(form.linkSpotify) ? form.linkSpotify.trim() : null,
      appleMusic: isNonEmptyString(form.linkAppleMusic) ? form.linkAppleMusic.trim() : null,
      youtubeMusic: isNonEmptyString(form.linkYoutubeMusic) ? form.linkYoutubeMusic.trim() : null
    }
  };
}

const musicSubPanel = createArrayPanel({
  listEl: $("#music-list"),
  addBtn: $("#music-add"),
  saveBtn: null, // Music has one shared Save button handled separately below
  statusEl: $("#music-status"),
  docPath: "content/music",
  fallback: [],
  itemType: "object",
  twoColumn: true,
  fields: MUSIC_SONG_FIELDS,
  newItem: () => songToForm({})
});

function renderMusicCategory() {
  const forms = (musicData[activeMusicCategory] || []).map(songToForm);
  musicSubPanel.setItems(forms);
}

function initMusicPanel() {
  document.querySelectorAll("#music-category-tabs .admin-subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#music-category-tabs .admin-subtab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      // Persist whatever's currently in the list back into musicData before switching.
      musicData[activeMusicCategory] = musicSubPanel.getItems().map(formToSong);
      activeMusicCategory = tab.getAttribute("data-music-cat");
      renderMusicCategory();
    });
  });

  $("#music-save").addEventListener("click", () => {
    musicData[activeMusicCategory] = musicSubPanel.getItems().map(formToSong);

    for (const cat of MUSIC_CATEGORIES) {
      for (const song of musicData[cat]) {
        if (!isNonEmptyString(song.id) || !isNonEmptyString(song.title) || !isNonEmptyString(song.artist) || !isNonEmptyString(song.type)) {
          setStatus($("#music-status"), "Every song needs at least an ID, title, artist, and type — check all categories.", "error");
          return;
        }
      }
    }

    withSaving($("#music-save"), $("#music-status"), "Saving…", async () => {
      await setDoc(doc(db, "content/music"), musicData);
    });
  });
}

async function loadMusicPanel() {
  musicData = await loadDocOr("content/music", FALLBACK_DATA.music);
  MUSIC_CATEGORIES.forEach((cat) => {
    if (!Array.isArray(musicData[cat])) musicData[cat] = [];
  });
  renderMusicCategory();
}

/* ==========================================================================
   Campaign Manager
   ------------------------------------------------------------------
   campaigns/{id} is canonical for every campaign. This panel shows the
   union of live Firestore docs and any data.js fallback campaign that
   doesn't have a live doc yet (shown with limited quick-actions until
   it's actually saved once). Heartbound gets one extra, explicit action
   — "Migrate Heartbound to Firestore" — since its pre-migration identity
   comes from several older docs (campaign/current, campaign/goals,
   campaign/tiktokGoals, stats/tiktok, content/missions, content/quickLinks,
   content/platforms) that need consolidating into one new doc.

   The nested YouTube Goals / TikTok Goals / Official Accounts / Support
   Mission / Quick Links editors below reuse createArrayPanel exactly like
   the rest of the admin console, just scoped to whichever campaign is
   currently open in the editor instead of writing straight to Firestore —
   their values are folded into the single campaign doc on Save.
   ========================================================================== */

const CAMPAIGN_STATUSES = ["current", "upcoming", "previous"];
const LEGACY_HEARTBOUND_STATUS_MAP = { active: "current", upcoming: "upcoming", ended: "previous" };

let campaignsCache = [];
let editingCampaignId = null; // null while the "Add Campaign" form is open

const campaignYoutubeGoalsEditor = createArrayPanel({
  listEl: $("#ce-yt-goals-list"),
  addBtn: $("#ce-yt-goal-add"),
  saveBtn: null,
  statusEl: null,
  docPath: null,
  fallback: [],
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true, placeholder: "1M Views" },
    { key: "target", label: "Target", type: "number", required: true }
  ],
  newItem: () => ({ label: "", target: 0 })
});

const campaignTiktokGoalsEditor = createArrayPanel({
  listEl: $("#ce-tt-goals-list"),
  addBtn: $("#ce-tt-goal-add"),
  saveBtn: null,
  statusEl: null,
  docPath: null,
  fallback: [],
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true, placeholder: "1M Views" },
    { key: "target", label: "Target", type: "number", required: true }
  ],
  newItem: () => ({ label: "", target: 0 })
});

const campaignPlatformsEditor = createArrayPanel({
  listEl: $("#ce-platforms-list"),
  addBtn: $("#ce-platform-add"),
  saveBtn: null,
  statusEl: null,
  docPath: null,
  fallback: [],
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "id", label: "ID (unique slug, e.g. x)", type: "text", required: true },
    { key: "name", label: "Platform name", type: "text", required: true },
    { key: "actionsText", label: "Action labels (comma-separated)", type: "text", placeholder: "Like, Repost, Reply, Share" },
    { key: "cta", label: "CTA text", type: "text", required: true },
    { key: "url", label: "URL", type: "url", required: true }
  ],
  newItem: () => ({ id: "", name: "", actionsText: "", cta: "", url: "" })
});

const campaignMissionsEditor = createArrayPanel({
  listEl: $("#ce-missions-list"),
  addBtn: $("#ce-mission-add"),
  saveBtn: null,
  statusEl: null,
  docPath: null,
  fallback: [],
  itemType: "string",
  newItem: () => ""
});

const campaignQuickLinksEditor = createArrayPanel({
  listEl: $("#ce-quicklinks-list"),
  addBtn: $("#ce-quicklink-add"),
  saveBtn: null,
  statusEl: null,
  docPath: null,
  fallback: [],
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true },
    { key: "icon", label: "Icon / glyph", type: "text", required: true, placeholder: "▶" },
    { key: "url", label: "URL", type: "url", required: true }
  ],
  newItem: () => ({ label: "", icon: "▶", url: "" })
});

async function getLiveCampaignDocs() {
  try {
    const snap = await getDocs(collection(db, "campaigns"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function loadCampaignsPanel() {
  const liveDocs = await getLiveCampaignDocs();
  const liveById = new Map(liveDocs.map((d) => [d.id, d]));

  const merged = FALLBACK_DATA.campaigns.map((fallback) => {
    const live = liveById.get(fallback.id);
    return live ? { ...fallback, ...live, _inFirestore: true } : { ...fallback, _inFirestore: false };
  });
  liveById.forEach((docData, id) => {
    if (!merged.some((c) => c.id === id)) merged.push({ ...docData, id, _inFirestore: true });
  });

  campaignsCache = merged;
  renderCampaignsList();
  updateMigrationBanner();
}

function updateMigrationBanner() {
  const heartbound = campaignsCache.find((c) => c.id === "heartbound");
  $("#campaign-migrate-banner").hidden = !(heartbound && !heartbound._inFirestore);
}

function renderCampaignsList() {
  const listEl = $("#campaigns-list");
  listEl.innerHTML = "";

  if (!campaignsCache.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No campaigns yet — use Add Campaign below.";
    listEl.appendChild(empty);
    return;
  }

  campaignsCache
    .slice()
    .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999))
    .forEach((campaign) => listEl.appendChild(buildCampaignRow(campaign)));
}

function buildCampaignRow(campaign) {
  const inFirestore = campaign._inFirestore !== false;

  const row = document.createElement("div");
  row.className = "admin-item";

  const toolbar = document.createElement("div");
  toolbar.className = "admin-item-toolbar";

  const titleWrap = document.createElement("div");
  const titleEl = document.createElement("strong");
  titleEl.textContent = campaign.title || campaign.id;
  titleWrap.appendChild(titleEl);
  if (campaign.isFeatured) {
    const featuredBadge = document.createElement("span");
    featuredBadge.className = "badge badge-active";
    featuredBadge.style.marginLeft = "8px";
    featuredBadge.textContent = "Featured";
    titleWrap.appendChild(featuredBadge);
  }
  toolbar.appendChild(titleWrap);

  const actions = document.createElement("div");
  actions.className = "admin-item-actions";
  actions.style.flexWrap = "wrap";

  const statusSelect = document.createElement("select");
  statusSelect.style.width = "auto";
  CAMPAIGN_STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    if (status === campaign.status) option.selected = true;
    statusSelect.appendChild(option);
  });
  statusSelect.disabled = !inFirestore;
  statusSelect.addEventListener("change", () => {
    quickUpdateCampaign(campaign.id, { status: statusSelect.value });
  });
  actions.appendChild(statusSelect);

  const featuredBtn = document.createElement("button");
  featuredBtn.type = "button";
  featuredBtn.className = "btn btn-secondary btn-sm";
  featuredBtn.style.width = "auto";
  featuredBtn.textContent = campaign.isFeatured ? "★ Featured" : "Make Featured";
  featuredBtn.disabled = !inFirestore || !!campaign.isFeatured;
  featuredBtn.addEventListener("click", () => makeFeatured(campaign.id));
  actions.appendChild(featuredBtn);

  const orderInput = document.createElement("input");
  orderInput.type = "number";
  orderInput.step = "1";
  orderInput.style.width = "70px";
  orderInput.value = typeof campaign.displayOrder === "number" ? campaign.displayOrder : 999;
  orderInput.disabled = !inFirestore;
  orderInput.addEventListener("change", () => {
    quickUpdateCampaign(campaign.id, { displayOrder: Number(orderInput.value) || 0 });
  });
  actions.appendChild(orderInput);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn-secondary btn-sm";
  editBtn.style.width = "auto";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openCampaignEditor(campaign.id));
  actions.appendChild(editBtn);

  const commentHelperBtn = document.createElement("button");
  commentHelperBtn.type = "button";
  commentHelperBtn.className = "btn btn-secondary btn-sm";
  commentHelperBtn.style.width = "auto";
  commentHelperBtn.textContent = "Comment Helper";
  commentHelperBtn.disabled = !inFirestore;
  if (!inFirestore) commentHelperBtn.title = "Save this campaign first.";
  commentHelperBtn.addEventListener("click", () => openCommentHelperManager(campaign.id));
  actions.appendChild(commentHelperBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "admin-delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.setAttribute("aria-label", "Delete campaign");
  deleteBtn.disabled = !inFirestore;
  deleteBtn.addEventListener("click", () => deleteCampaign(campaign.id));
  actions.appendChild(deleteBtn);

  toolbar.appendChild(actions);
  row.appendChild(toolbar);

  const meta = document.createElement("p");
  meta.className = "admin-meta";
  meta.textContent = `${campaign.campaignType || "—"} · id: ${campaign.id}`;
  row.appendChild(meta);

  if (!inFirestore) {
    const notice = document.createElement("p");
    notice.className = "admin-hint";
    notice.style.margin = 0;
    notice.textContent = campaign.id === "heartbound"
      ? "Not yet migrated — use the migration action above to enable quick status/featured/order controls."
      : "Not yet saved to Firestore — click Edit, then Save, to create it and enable quick controls.";
    row.appendChild(notice);
  }

  return row;
}

function quickUpdateCampaign(id, fields) {
  updateDoc(doc(db, "campaigns", id), { ...fields, updatedAt: serverTimestamp() })
    .then(() => loadCampaignsPanel())
    .catch((error) => {
      console.error(error);
      window.alert(`Couldn't update campaign: ${error.message || "unknown error"}`);
      loadCampaignsPanel();
    });
}

async function unsetFeaturedOnOthers(exceptId) {
  const others = campaignsCache.filter((c) => c.id !== exceptId && c.isFeatured && c._inFirestore !== false);
  if (!others.length) return;
  const batch = writeBatch(db);
  others.forEach((o) => batch.update(doc(db, "campaigns", o.id), { isFeatured: false }));
  await batch.commit();
}

async function makeFeatured(id) {
  try {
    await updateDoc(doc(db, "campaigns", id), { isFeatured: true, updatedAt: serverTimestamp() });
    await unsetFeaturedOnOthers(id);
    await loadCampaignsPanel();
  } catch (error) {
    console.error(error);
    window.alert(`Couldn't update the featured campaign: ${error.message || "unknown error"}`);
  }
}

function deleteCampaign(id) {
  if (!confirmDelete(`Delete the "${id}" campaign? This can't be undone.`)) return;
  deleteDoc(doc(db, "campaigns", id))
    .then(() => loadCampaignsPanel())
    .catch((error) => {
      console.error(error);
      window.alert(`Couldn't delete campaign: ${error.message || "unknown error"}`);
    });
}

function blankCampaign() {
  return {
    id: "", title: "", subtitle: "", campaignType: "", status: "upcoming", isFeatured: false,
    displayOrder: 99, dailyMissionBonus: 0, image: "", description: "", heroMessage: "", startDate: "", endDate: "",
    links: {}, goals: {}, stats: {}, platforms: [], missions: [], quickLinks: [], features: {}, notes: ""
  };
}

function openCampaignEditor(id) {
  if (typeof closeCommentHelperManager === "function") closeCommentHelperManager();

  editingCampaignId = id || null;
  const campaign = id ? campaignsCache.find((c) => c.id === id) || blankCampaign() : blankCampaign();

  $("#campaign-editor-title").textContent = id ? `Edit Campaign — ${campaign.title || id}` : "Add Campaign";
  $("#ce-id").value = campaign.id || "";
  $("#ce-id").disabled = !!id;
  $("#ce-title").value = campaign.title || "";
  $("#ce-subtitle").value = campaign.subtitle || "";
  $("#ce-type").value = campaign.campaignType || "";
  $("#ce-status").value = campaign.status || "upcoming";
  $("#ce-featured").checked = !!campaign.isFeatured;
  $("#ce-order").value = typeof campaign.displayOrder === "number" ? campaign.displayOrder : "";
  $("#ce-daily-mission-bonus").value = typeof campaign.dailyMissionBonus === "number" ? campaign.dailyMissionBonus : 0;
  $("#ce-image").value = campaign.image || "";
  $("#ce-description").value = campaign.description || "";
  $("#ce-hero-message").value = campaign.heroMessage || "";
  $("#ce-start-date").value = campaign.startDate || "";
  $("#ce-end-date").value = campaign.endDate || "";

  const links = campaign.links || {};
  $("#ce-link-youtube-label").value = (links.youtube && links.youtube.label) || "";
  $("#ce-link-youtube-url").value = (links.youtube && links.youtube.url) || "";
  $("#ce-link-tiktok-label").value = (links.tiktok && links.tiktok.label) || "";
  $("#ce-link-tiktok-url").value = (links.tiktok && links.tiktok.url) || "";
  $("#ce-link-instagram-url").value = (links.instagram && links.instagram.url) || "";
  $("#ce-link-x-url").value = (links.x && links.x.url) || "";

  campaignYoutubeGoalsEditor.setItems((campaign.goals && campaign.goals.youtube) || []);
  campaignTiktokGoalsEditor.setItems((campaign.goals && campaign.goals.tiktok) || []);

  $("#ce-youtube-video-id").value = (campaign.stats && campaign.stats.youtubeVideoId) || "";
  $("#ce-youtube-stats-source").value = (campaign.stats && campaign.stats.youtubeStatsSource) || "";
  $("#ce-tiktok-current-views").value = (campaign.stats && campaign.stats.tiktokCurrentViews) || 0;

  campaignPlatformsEditor.setItems((campaign.platforms || []).map((p) => ({
    id: p.id || "",
    name: p.name || "",
    actionsText: (p.actions || []).join(", "),
    cta: p.cta || "",
    url: p.url || ""
  })));
  campaignMissionsEditor.setItems(campaign.missions || []);
  campaignQuickLinksEditor.setItems(campaign.quickLinks || []);

  $("#ce-feature-youtube-guide").checked = !!(campaign.features && campaign.features.youtubeGuide);
  $("#ce-feature-playlists").checked = !!(campaign.features && campaign.features.playlists);
  $("#ce-feature-comment-helper").checked = !!(campaign.features && campaign.features.commentHelper);
  $("#ce-notes").value = campaign.notes || "";

  setStatus($("#campaign-editor-status"), "", null);
  $("#campaign-editor").hidden = false;
  $("#campaign-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCampaignEditor() {
  $("#campaign-editor").hidden = true;
  editingCampaignId = null;
}

function initCampaignEditorForm() {
  $("#campaign-editor-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const isNew = !editingCampaignId;
    const id = (isNew ? $("#ce-id").value : editingCampaignId).trim();
    const title = $("#ce-title").value.trim();

    if (!isNonEmptyString(id) || !/^[a-z0-9-]+$/.test(id)) {
      setStatus($("#campaign-editor-status"), "Campaign ID must use only lowercase letters, numbers, and dashes.", "error");
      return;
    }
    if (!isNonEmptyString(title)) {
      setStatus($("#campaign-editor-status"), "Title is required.", "error");
      return;
    }
    if (isNew && campaignsCache.some((c) => c.id === id && c._inFirestore !== false)) {
      setStatus($("#campaign-editor-status"), `A campaign with id "${id}" already exists in Firestore.`, "error");
      return;
    }

    const youtubeUrl = $("#ce-link-youtube-url").value.trim();
    const tiktokUrl = $("#ce-link-tiktok-url").value.trim();
    const instagramUrl = $("#ce-link-instagram-url").value.trim();
    const xUrl = $("#ce-link-x-url").value.trim();
    for (const url of [youtubeUrl, tiktokUrl, instagramUrl, xUrl]) {
      if (isNonEmptyString(url) && !isHttpUrl(url)) {
        setStatus($("#campaign-editor-status"), "Every link must start with http:// or https://.", "error");
        return;
      }
    }

    const data = {
      id,
      title,
      subtitle: $("#ce-subtitle").value.trim(),
      campaignType: $("#ce-type").value.trim(),
      status: $("#ce-status").value,
      isFeatured: $("#ce-featured").checked,
      displayOrder: isNonEmptyString($("#ce-order").value) ? Number($("#ce-order").value) : 999,
      dailyMissionBonus: isNonNegativeInteger($("#ce-daily-mission-bonus").value) ? Number($("#ce-daily-mission-bonus").value) : 0,
      image: isNonEmptyString($("#ce-image").value) ? $("#ce-image").value.trim() : null,
      description: $("#ce-description").value.trim(),
      heroMessage: $("#ce-hero-message").value.trim(),
      startDate: isNonEmptyString($("#ce-start-date").value) ? $("#ce-start-date").value.trim() : null,
      endDate: isNonEmptyString($("#ce-end-date").value) ? $("#ce-end-date").value.trim() : null,
      links: {
        youtube: youtubeUrl ? { label: $("#ce-link-youtube-label").value.trim(), url: youtubeUrl } : null,
        tiktok: tiktokUrl ? { label: $("#ce-link-tiktok-label").value.trim(), url: tiktokUrl } : null,
        instagram: instagramUrl ? { url: instagramUrl } : null,
        x: xUrl ? { url: xUrl } : null,
        other: []
      },
      goals: {
        youtube: campaignYoutubeGoalsEditor.getItems()
          .filter((g) => isNonEmptyString(g.label))
          .map((g) => ({ label: g.label.trim(), target: Number(g.target) || 0 })),
        tiktok: campaignTiktokGoalsEditor.getItems()
          .filter((g) => isNonEmptyString(g.label))
          .map((g) => ({ label: g.label.trim(), target: Number(g.target) || 0 }))
      },
      stats: {
        youtubeVideoId: isNonEmptyString($("#ce-youtube-video-id").value) ? $("#ce-youtube-video-id").value.trim() : null,
        youtubeStatsSource: isNonEmptyString($("#ce-youtube-stats-source").value) ? $("#ce-youtube-stats-source").value.trim() : null,
        tiktokCurrentViews: isNonNegativeInteger($("#ce-tiktok-current-views").value) ? Number($("#ce-tiktok-current-views").value) : 0
      },
      platforms: campaignPlatformsEditor.getItems()
        .map((p) => ({
          id: (p.id || "").trim(),
          name: (p.name || "").trim(),
          actions: (p.actionsText || "").split(",").map((a) => a.trim()).filter(Boolean),
          cta: (p.cta || "").trim(),
          url: (p.url || "").trim()
        }))
        .filter((p) => p.id && p.name && p.url),
      missions: campaignMissionsEditor.getItems().map((m) => m.trim()).filter(Boolean),
      quickLinks: campaignQuickLinksEditor.getItems()
        .map((l) => ({ label: (l.label || "").trim(), icon: (l.icon || "").trim(), url: (l.url || "").trim() }))
        .filter((l) => l.label && l.url),
      features: {
        youtubeGuide: $("#ce-feature-youtube-guide").checked,
        playlists: $("#ce-feature-playlists").checked,
        commentHelper: $("#ce-feature-comment-helper").checked
      },
      notes: isNonEmptyString($("#ce-notes").value) ? $("#ce-notes").value.trim() : null,
      updatedAt: serverTimestamp()
    };

    withSaving($("#campaign-editor-save"), $("#campaign-editor-status"), "Saving…", async () => {
      if (isNew) {
        data.createdAt = serverTimestamp();
        // Sensible defaults so a brand-new campaign's Comment Helper
        // manager has something to show immediately — editable there,
        // not here (see the dedicated [Comment Helper] manager).
        data.commentHelper = {
          title: "Comment Helper",
          description: "Need an idea? Generate a comment you can personalize.",
          buttonLabel: "Generate Comment",
          copyLabel: "Copy",
          allowEditing: true
        };
        await setDoc(doc(db, "campaigns", id), data);
      } else {
        await setDoc(doc(db, "campaigns", id), data, { merge: true });
      }

      if (data.isFeatured) {
        await unsetFeaturedOnOthers(id);
      }

      closeCampaignEditor();
      await loadCampaignsPanel();
    });
  });

  $("#campaign-editor-cancel").addEventListener("click", closeCampaignEditor);
  $("#campaign-add-btn").addEventListener("click", () => openCampaignEditor(null));
}

function initCampaignMigration() {
  $("#campaign-migrate-btn").addEventListener("click", () => {
    const confirmed = window.confirm(
      "This will create campaigns/heartbound from Heartbound's current live data.\n\n" +
      "Heartbound will remain:\n  - Current\n  - Featured\n\n" +
      "The following will NOT change:\n" +
      "  - YouTube automatic stats\n  - TikTok stats\n  - streaming goals\n  - public website appearance\n\n" +
      "Continue?"
    );
    if (!confirmed) return;

    withSaving($("#campaign-migrate-btn"), $("#campaign-migrate-status"), "Migrating…", async () => {
      const existing = await getDoc(doc(db, "campaigns", "heartbound"));
      if (existing.exists()) {
        throw new Error("campaigns/heartbound already exists — refusing to overwrite it.");
      }

      const fallback = FALLBACK_DATA.campaigns.find((c) => c.id === "heartbound") || blankCampaign();

      const [legacyCurrent, legacyGoals, legacyTiktokGoals, legacyStatsTiktok, legacyMissions, legacyQuickLinks, legacyPlatforms] = await Promise.all([
        loadDocOr("campaign/current", {}),
        loadDocOr("campaign/goals", { items: [] }),
        loadDocOr("campaign/tiktokGoals", { items: [] }),
        loadDocOr("stats/tiktok", { currentViews: fallback.stats ? fallback.stats.tiktokCurrentViews : 0 }),
        loadDocOr("content/missions", { items: fallback.missions || [] }),
        loadDocOr("content/quickLinks", { items: fallback.quickLinks || [] }),
        loadDocOr("content/platforms", { items: fallback.platforms || [] })
      ]);

      const data = {
        ...fallback,
        id: "heartbound",
        title: legacyCurrent.title !== undefined ? legacyCurrent.title : fallback.title,
        subtitle: legacyCurrent.subtitle !== undefined ? legacyCurrent.subtitle : fallback.subtitle,
        description: legacyCurrent.description !== undefined ? legacyCurrent.description : fallback.description,
        heroMessage: legacyCurrent.heroMessage !== undefined ? legacyCurrent.heroMessage : fallback.heroMessage,
        status: legacyCurrent.status ? (LEGACY_HEARTBOUND_STATUS_MAP[legacyCurrent.status] || fallback.status) : fallback.status,
        isFeatured: true,
        links: {
          ...fallback.links,
          youtube: legacyCurrent.primaryLink || (fallback.links && fallback.links.youtube) || null,
          tiktok: legacyCurrent.tiktokLink || (fallback.links && fallback.links.tiktok) || null
        },
        goals: {
          youtube: Array.isArray(legacyGoals.items) && legacyGoals.items.length
            ? legacyGoals.items.map((g) => ({ label: g.label, target: g.target }))
            : (fallback.goals && fallback.goals.youtube) || [],
          tiktok: Array.isArray(legacyTiktokGoals.items) && legacyTiktokGoals.items.length
            ? legacyTiktokGoals.items.map((g) => ({ label: g.label, target: g.target }))
            : (fallback.goals && fallback.goals.tiktok) || []
        },
        stats: {
          ...fallback.stats,
          tiktokCurrentViews: typeof legacyStatsTiktok.currentViews === "number"
            ? legacyStatsTiktok.currentViews
            : (fallback.stats && fallback.stats.tiktokCurrentViews) || 0
        },
        missions: Array.isArray(legacyMissions.items) && legacyMissions.items.length ? legacyMissions.items : fallback.missions || [],
        quickLinks: Array.isArray(legacyQuickLinks.items) && legacyQuickLinks.items.length ? legacyQuickLinks.items : fallback.quickLinks || [],
        platforms: Array.isArray(legacyPlatforms.items) && legacyPlatforms.items.length ? legacyPlatforms.items : fallback.platforms || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, "campaigns", "heartbound"), data);
      await loadCampaignsPanel();
    });
  });
}

function initCampaignsPanel() {
  initCampaignEditorForm();
  initCampaignMigration();
}

/* ==========================================================================
   Mission Manager (Step 4)
   ------------------------------------------------------------------
   missions/{missionId} is a flat collection of standalone documents — one
   per mission — so this mirrors the Campaign Manager's pattern (cache
   array + row-per-document + a toggleable single-item editor subsection
   written with setDoc/updateDoc/deleteDoc) rather than createArrayPanel,
   which is for a single doc holding one array field.

   BACKEND COMPATIBILITY (see functions/missionLogic.js): recordMissionAction
   queries missions where actionId == X AND active == true and fans one
   accepted action out to EVERY eligible mission it finds (Step 9 — tiered
   missions like "stream 3 times" / "stream 10 times" sharing one tracked
   action). Sharing an Action ID across several active missions is valid;
   this panel instead enforces that the SHARED parts of that
   configuration — destinationUrl, actionType, cooldownSeconds,
   maxCountPerDay — stay consistent across every active mission using the
   same Action ID (see getActionIdUrlMismatch/getSharedActionConfigMismatch),
   since the backend treats those as one tracked action's config, not
   per-mission settings. target/rewardDomiias/title/etc. are mission-
   specific and may always differ between tiers.
   ========================================================================== */

const MISSION_ACTION_TYPES = ["external_click"];
const MISSION_FREQUENCIES = ["daily"];
const MISSION_STATUS_BADGE_CLASS = {
  active: "badge-active",
  inactive: "badge-coming-soon",
  scheduled: "badge-upcoming",
  expired: "badge-previous"
};
const MISSION_STATUS_LABEL = {
  active: "Active",
  inactive: "Inactive",
  scheduled: "Scheduled",
  expired: "Expired"
};

let missionsCache = [];
let missionCampaignOptions = []; // [{id, title}], loaded independently of the Campaigns panel
let missionCampaignOptionsFailed = false;
let editingMissionId = null; // null while "Add Mission" is open
let missionActionIdTouched = false; // once true, title changes stop auto-suggesting the Action ID
let missionStatusFilter = "all";
let missionCampaignFilter = "all";

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Step 10: every mission belongs to one daily SET — "general" or a
// specific campaign's. missionScope is the explicit field going forward;
// existing missions saved before Step 10 never had it, so this falls
// back to inferring scope from campaignId rather than requiring a
// destructive migration — the SAME fallback functions/missionLogic.js
// uses server-side (effectiveScope there), kept in sync by hand since a
// Cloud Function can't be imported into this plain admin script.
function effectiveScope(mission) {
  if (mission.missionScope === "campaign" || mission.missionScope === "general") return mission.missionScope;
  return mission.campaignId ? "campaign" : "general";
}

// Pure — never mutates the mission doc, per spec (status is always derived
// at render time from active/startsAt/endsAt + the current clock).
function deriveMissionStatus(mission, now) {
  if (!mission.active) return "inactive";
  const starts = timestampToDate(mission.startsAt);
  const ends = timestampToDate(mission.endsAt);
  const clock = now || new Date();
  if (starts && starts > clock) return "scheduled";
  if (ends && ends < clock) return "expired";
  return "active";
}

function slugify(text) {
  return (text || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateUniqueMissionId(title, frequency, excludeId) {
  const base = slugify(`${title}-${frequency || "daily"}`) || "mission";
  const existingIds = new Set(missionsCache.filter((m) => m.id !== excludeId).map((m) => m.id));
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/* ==========================================================================
   Generate Streaming Missions (Step 10.5) — admin-only bulk proposal tool.
   ------------------------------------------------------------------
   Reads the REAL canonical content (FALLBACK_DATA.music, sourced from
   js/data.js's actual song catalog, and the live Heartbound campaign doc's
   own links) and proposes one mission per song/platform + two Heartbound
   Campaign missions. NEVER invents a song, URL, or campaign — a song whose
   platform link is null is reported as "Missing URL" and is simply skipped,
   not fabricated with a guessed link. Idempotent by ACTION ID (not just
   mission ID): re-running this after missions already exist for an action
   correctly reports "Already exists" and the confirm step only ever
   creates the NEW ones, never touches or duplicates an existing mission —
   safe to re-run as often as needed after the catalog grows.
   ========================================================================== */
const STREAMING_MISSION_PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "spotify", label: "Spotify" }
];

function allCatalogSongs() {
  const music = FALLBACK_DATA.music || {};
  return [].concat(music.osts || [], music.perthsanta || [], music.perthSolo || [], music.jasper || []);
}

// `liveHeartbound` (a real campaigns/heartbound Firestore doc, if loaded)
// takes priority over the js/data.js fallback, same as every other panel's
// "live Firestore doc wins over the bundled fallback" convention — the
// admin may have already edited Heartbound's links in Campaign Manager.
function buildStreamingMissionCandidates(liveHeartbound, liveNewSeries2026) {
  const existingActionIds = new Set(missionsCache.map((m) => m.actionId).filter(Boolean));
  const existingMissionIds = new Set(missionsCache.map((m) => m.id));
  const candidates = [];

  allCatalogSongs().forEach((song) => {
    STREAMING_MISSION_PLATFORMS.forEach(({ key, label }) => {
      const url = song.links && song.links[key];
      const actionId = `${song.id}-${key}`;
      const missionId = `${song.id}-${key}-daily`;
      const hasUrl = isNonEmptyString(url);
      candidates.push({
        id: missionId,
        status: !hasUrl ? "missing-url" : existingActionIds.has(actionId) ? "exists" : "new",
        summary: `${song.title} — ${label}`,
        data: hasUrl ? {
          title: `Stream "${song.title}" on ${label}`,
          description: `Stream "${song.title}" by ${song.artist} on ${label} to support PerthSanta's music.`,
          missionScope: "general",
          campaignId: null,
          actionId,
          destinationUrl: url,
          actionType: "external_click",
          frequency: "daily",
          target: 1,
          rewardDomiias: 2,
          cooldownSeconds: 0,
          maxCountPerDay: 1,
          displayOrder: 500,
          active: true,
          requiredForDailySet: false
        } : null
      });
    });
  });

  const heartbound = liveHeartbound || fallbackHeartbound;
  const heartboundLinks = heartbound.links || {};
  [
    { key: "youtube", label: "YouTube" },
    { key: "tiktok", label: "TikTok" }
  ].forEach(({ key, label }) => {
    const url = heartboundLinks[key] && heartboundLinks[key].url;
    const actionId = `heartbound-${key}`;
    const missionId = `heartbound-${key}-daily`;
    const hasUrl = isNonEmptyString(url);
    candidates.push({
      id: missionId,
      status: !hasUrl ? "missing-url" : existingActionIds.has(actionId) ? "exists" : "new",
      summary: `Heartbound — ${label} (Campaign)`,
      data: hasUrl ? {
        title: `Watch the Heartbound Pilot Trailer on ${label}`,
        description: "Watch the official Heartbound pilot trailer to support this campaign.",
        missionScope: "campaign",
        campaignId: "heartbound",
        actionId,
        destinationUrl: url,
        actionType: "external_click",
        frequency: "daily",
        target: 1,
        rewardDomiias: 3,
        cooldownSeconds: 0,
        maxCountPerDay: 1,
        displayOrder: 10,
        active: true,
        requiredForDailySet: true
      } : null
    });
  });

  // New PerthSanta series (new-series-2026) — TWO tiered Campaign missions
  // sharing one actionId (same pattern as the Heartbound-style shared-
  // action tiering already used elsewhere — e.g. a shared-action music
  // mission pair), rather than Heartbound's own single target:1 mission.
  // Idempotency for this pair is checked by MISSION ID, not actionId —
  // both tiers legitimately share `new-series-2026-youtube`, so checking
  // the actionId set (like every other candidate above) would incorrectly
  // report the second tier as "already exists" the moment only the first
  // tier had been created.
  const newSeries2026 = liveNewSeries2026 || fallbackNewSeries2026;
  const newSeries2026YoutubeUrl = newSeries2026.links && newSeries2026.links.youtube && newSeries2026.links.youtube.url;
  const newSeries2026ActionId = "new-series-2026-youtube";
  const newSeries2026HasUrl = isNonEmptyString(newSeries2026YoutubeUrl);
  [
    { target: 3, rewardDomiias: 5 },
    { target: 10, rewardDomiias: 10 }
  ].forEach(({ target, rewardDomiias }) => {
    const missionId = `new-series-2026-youtube-${target}x-daily`;
    candidates.push({
      id: missionId,
      status: !newSeries2026HasUrl ? "missing-url" : existingMissionIds.has(missionId) ? "exists" : "new",
      summary: `New PerthSanta Series — YouTube ${target}× (Campaign)`,
      data: newSeries2026HasUrl ? {
        title: `Watch the New Series Video ${target}×`,
        description: "Watch/support the official new-series YouTube video to help this campaign.",
        missionScope: "campaign",
        campaignId: "new-series-2026",
        actionId: newSeries2026ActionId,
        destinationUrl: newSeries2026YoutubeUrl,
        actionType: "external_click",
        frequency: "daily",
        target,
        rewardDomiias,
        cooldownSeconds: 0,
        // Must be >= the highest tier's target (10) — every mission
        // sharing this actionId needs the identical max-count, or the
        // higher tier could never be reached (see the Action ID hint in
        // the mission editor form).
        maxCountPerDay: 10,
        displayOrder: 10,
        active: true,
        requiredForDailySet: true
      } : null
    });
  });

  return candidates;
}

// Suggestion only — the admin can always edit the Action ID field before
// saving (see spec step 8). Deliberately simple: campaignId (if any) plus
// the title's first couple of words, kebab-cased.
function suggestActionId(title, campaignId) {
  const titleSlug = slugify((title || "").split(/\s+/).slice(0, 2).join(" "));
  if (campaignId) return slugify(`${campaignId}-${titleSlug}`) || slugify(campaignId);
  return titleSlug;
}

function formatDateRangePart(value) {
  const d = timestampToDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time —
// toISOString() would shift to UTC and silently change what the admin
// sees, so this builds the string from local getters instead.
function dateToLocalDatetimeInputValue(date) {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The reverse: new Date("YYYY-MM-DDTHH:mm") (no timezone suffix) is
// specified to parse as LOCAL time, so this really is "whatever instant
// the admin's browser clock says that local date/time is" — stored as an
// absolute Firestore Timestamp from there on.
function localDatetimeInputValueToTimestamp(value) {
  if (!isNonEmptyString(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function getCampaignTitle(campaignId) {
  if (!campaignId) return "None / General";
  const found = missionCampaignOptions.find((c) => c.id === campaignId);
  return found ? found.title : campaignId;
}

// Step 9: MULTIPLE active missions may now share one actionId (tiered
// missions — "stream 3 times" / "stream 10 times" both subscribing to the
// same tracked action). recordMissionAction fans one accepted action out
// to every eligible mission subscribed to it, so sharing itself is no
// longer a conflict — only INCONSISTENT shared-action configuration is
// (see getActionIdUrlMismatch/getSharedActionConfigMismatch below). A
// conflict check only ever compares against OTHER ACTIVE missions — a
// shared actionId where the sibling is inactive is fine (that's exactly
// how Duplicate produces a safe, inactive copy to edit before activating).
function getActiveSiblingsForActionId(actionId, excludeMissionId) {
  if (!isNonEmptyString(actionId)) return [];
  return missionsCache.filter((m) => m.id !== excludeMissionId && m.actionId === actionId && m.active);
}

// Reject "same actionId, different destination" (spec sections 6, 24) —
// one actionId should always point at one tracked destination/action, so
// every active mission sharing an actionId must agree on
// destinationUrl (compared normalized, same equality the site-wide link
// tracker itself uses).
function getActionIdUrlMismatch(actionId, destinationUrl, excludeMissionId) {
  const siblings = getActiveSiblingsForActionId(actionId, excludeMissionId);
  if (!siblings.length) return null;
  const key = normalizeTrackableUrl(destinationUrl);
  return siblings.find((m) => normalizeTrackableUrl(m.destinationUrl) !== key) || null;
}

// cooldownSeconds/maxCountPerDay/actionType describe the TRACKED ACTION
// itself, not any one mission's tier (spec sections 6, 12-14) — even
// though they're stored redundantly on every mission document sharing
// that actionId (there's no separate "actions" collection). Every active
// mission sharing an actionId must agree on all three, or the backend has
// no single coherent value to gate the shared actionHistory doc with.
// Returns { mission, field } for the first mismatching sibling found, or
// null.
function getSharedActionConfigMismatch(actionId, { actionType, cooldownSeconds, maxCountPerDay }, excludeMissionId) {
  const siblings = getActiveSiblingsForActionId(actionId, excludeMissionId);
  for (const m of siblings) {
    if (m.actionType !== actionType) return { mission: m, field: "Action Type" };
    if (Number(m.cooldownSeconds) !== Number(cooldownSeconds)) return { mission: m, field: "Cooldown Seconds" };
    if (Number(m.maxCountPerDay) !== Number(maxCountPerDay)) return { mission: m, field: "Max Count Per Day" };
  }
  return null;
}

// Reject "same destination, different actionId" (spec sections 5, 23) — a
// different actionId pointed at the same destination is ambiguous for the
// site-wide link tracker (which maps one normalized URL to exactly one
// actionId) and would mean two unrelated tracked actions fire from the
// same link. The REVERSE case — same actionId, same destination, used by
// several tiered missions — is expected and fine; see
// getActiveSiblingsForActionId above for why sharing itself isn't a
// conflict anymore.
function getActiveDestinationConflict(destinationUrl, actionId, excludeMissionId) {
  const key = normalizeTrackableUrl(destinationUrl);
  if (!key) return null;
  return missionsCache.find((m) =>
    m.id !== excludeMissionId
    && m.active
    && m.actionId !== actionId
    && normalizeTrackableUrl(m.destinationUrl) === key
  ) || null;
}

function shortenUrlForDisplay(url) {
  if (!isNonEmptyString(url)) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const rest = u.pathname + u.search;
    const shortRest = rest.length > 18 ? `${rest.slice(0, 15)}…` : (rest === "/" ? "" : rest);
    return `${host}${shortRest}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}…` : url;
  }
}

async function getMissionCampaignOptions() {
  try {
    const liveDocs = await getLiveCampaignDocs();
    const liveById = new Map(liveDocs.map((d) => [d.id, d]));
    const merged = FALLBACK_DATA.campaigns.map((f) => ({ id: f.id, title: (liveById.get(f.id) || f).title || f.id }));
    liveById.forEach((docData, id) => {
      if (!merged.some((c) => c.id === id)) merged.push({ id, title: docData.title || id });
    });
    return { ok: merged.length > 0, campaigns: merged };
  } catch (error) {
    console.error(error);
    return { ok: false, campaigns: [] };
  }
}

function populateMissionCampaignSelects(campaigns) {
  const edSelect = $("#me-campaign");
  edSelect.innerHTML = '<option value="">None / General</option>';
  campaigns.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.title;
    edSelect.appendChild(opt);
  });

  const filterSelect = $("#missions-campaign-filter");
  const previousFilterValue = filterSelect.value;
  filterSelect.innerHTML = '<option value="all">All campaigns</option><option value="">None / General</option>';
  campaigns.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.title;
    filterSelect.appendChild(opt);
  });
  if ([...filterSelect.options].some((o) => o.value === previousFilterValue)) {
    filterSelect.value = previousFilterValue;
  }
}

/* ---- List + filters ---- */

// Reuses the ONE existing campaign filter dropdown as the Step 10 scope
// filter too (spec section 35: "Type: All/General/Campaign, optionally
// Campaign") rather than adding a second control: "All campaigns" = every
// mission, "None / General" (value "") = the General scope, and any
// specific campaign = that campaign's scope. effectiveScope-aware so a
// legacy mission without missionScope still lands in the right bucket.
function filteredMissions() {
  const now = new Date();
  return missionsCache
    .map((m) => ({ mission: m, status: deriveMissionStatus(m, now) }))
    .filter(({ status }) => missionStatusFilter === "all" || status === missionStatusFilter)
    .filter(({ mission }) => {
      if (missionCampaignFilter === "all") return true;
      if (missionCampaignFilter === "") return effectiveScope(mission) === "general";
      return effectiveScope(mission) === "campaign" && mission.campaignId === missionCampaignFilter;
    })
    .map(({ mission }) => mission);
}

function renderMissionsList() {
  const listEl = $("#missions-list");
  listEl.innerHTML = "";

  if (!missionsCache.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.innerHTML = "No missions yet.<br>Create your first mission to start rewarding streaming activity.";
    listEl.appendChild(empty);
    return;
  }

  const visible = filteredMissions()
    .slice()
    .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || (a.title || "").localeCompare(b.title || ""));

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No missions match the current filters.";
    listEl.appendChild(empty);
    return;
  }

  visible.forEach((mission) => listEl.appendChild(buildMissionRow(mission)));
}

function buildMissionRow(mission) {
  const status = deriveMissionStatus(mission);

  const row = document.createElement("div");
  row.className = "admin-item";

  const toolbar = document.createElement("div");
  toolbar.className = "admin-item-toolbar";

  const titleWrap = document.createElement("div");
  const titleEl = document.createElement("strong");
  titleEl.textContent = mission.title || mission.id;
  titleWrap.appendChild(titleEl);
  const badge = document.createElement("span");
  badge.className = `badge ${MISSION_STATUS_BADGE_CLASS[status]}`;
  badge.style.marginLeft = "8px";
  badge.textContent = MISSION_STATUS_LABEL[status];
  titleWrap.appendChild(badge);

  // Step 10 spec section 36 — scope is important to see at a glance once
  // there are many missions across several daily sets.
  const scopeBadge = document.createElement("span");
  scopeBadge.className = "badge badge-coming-soon";
  scopeBadge.style.marginLeft = "6px";
  scopeBadge.textContent = effectiveScope(mission) === "campaign"
    ? `CAMPAIGN · ${getCampaignTitle(mission.campaignId)}`
    : "GENERAL";
  titleWrap.appendChild(scopeBadge);

  // Step 10.5 — required-vs-optional is important to see at a glance once
  // most new missions are optional bonus missions, not part of the
  // curated required set. Mirrors the backend's own
  // `requiredForDailySet !== false` default (functions/missionLogic.js).
  const requiredForDailySet = mission.requiredForDailySet !== false;
  const requiredBadge = document.createElement("span");
  requiredBadge.className = `badge ${requiredForDailySet ? "badge-required" : "badge-optional"}`;
  requiredBadge.style.marginLeft = "6px";
  requiredBadge.textContent = requiredForDailySet ? "DAILY SET" : "OPTIONAL";
  titleWrap.appendChild(requiredBadge);

  toolbar.appendChild(titleWrap);

  const actions = document.createElement("div");
  actions.className = "admin-item-actions";
  actions.style.flexWrap = "wrap";

  const orderInput = document.createElement("input");
  orderInput.type = "number";
  orderInput.step = "1";
  orderInput.style.width = "70px";
  orderInput.value = typeof mission.displayOrder === "number" ? mission.displayOrder : 999;
  orderInput.title = "Display order";
  orderInput.addEventListener("change", () => {
    updateDoc(doc(db, "missions", mission.id), { displayOrder: Number(orderInput.value) || 0, updatedAt: serverTimestamp() })
      .then(() => loadMissionsPanel())
      .catch((error) => {
        console.error(error);
        window.alert(`Couldn't update display order: ${error.message || "unknown error"}`);
      });
  });
  actions.appendChild(orderInput);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn-secondary btn-sm";
  editBtn.style.width = "auto";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openMissionEditor(mission.id));
  actions.appendChild(editBtn);

  const duplicateBtn = document.createElement("button");
  duplicateBtn.type = "button";
  duplicateBtn.className = "btn btn-secondary btn-sm";
  duplicateBtn.style.width = "auto";
  duplicateBtn.textContent = "Duplicate";
  duplicateBtn.addEventListener("click", () => duplicateMission(mission.id));
  actions.appendChild(duplicateBtn);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn btn-secondary btn-sm";
  toggleBtn.style.width = "auto";
  toggleBtn.textContent = mission.active ? "Deactivate" : "Activate";
  toggleBtn.addEventListener("click", () => toggleMissionActive(mission));
  actions.appendChild(toggleBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "admin-delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.setAttribute("aria-label", "Delete mission");
  deleteBtn.addEventListener("click", () => deleteMission(mission.id));
  actions.appendChild(deleteBtn);

  toolbar.appendChild(actions);
  row.appendChild(toolbar);

  const line1 = document.createElement("p");
  line1.className = "admin-meta";
  line1.textContent = `Frequency: ${mission.frequency === "daily" ? "Daily" : mission.frequency || "—"} · Action ID: ${mission.actionId || "—"} · Target: ${Number(mission.target) || 0} completions`;
  row.appendChild(line1);

  const line2 = document.createElement("p");
  line2.className = "admin-meta";
  line2.style.display = "flex";
  line2.style.alignItems = "center";
  line2.style.gap = "6px";
  line2.style.flexWrap = "wrap";
  const rewardLabel = document.createElement("span");
  rewardLabel.textContent = "Reward:";
  line2.append(rewardLabel, renderDomiiaAmount(Number(mission.rewardDomiias) || 0, { size: "small" }));
  const campaignText = document.createElement("span");
  campaignText.textContent = `· Campaign: ${getCampaignTitle(mission.campaignId)}`;
  line2.appendChild(campaignText);
  row.appendChild(line2);

  const line3 = document.createElement("p");
  line3.className = "admin-meta";
  line3.textContent = `Start: ${formatDateRangePart(mission.startsAt)} · End: ${formatDateRangePart(mission.endsAt)} · Max/day: ${Number(mission.maxCountPerDay) || 0} · Cooldown: ${Number(mission.cooldownSeconds) || 0}s`;
  row.appendChild(line3);

  const line4 = document.createElement("p");
  line4.className = "admin-meta";
  line4.style.wordBreak = "break-all"; // long destination URLs must never cause horizontal overflow on mobile
  if (isNonEmptyString(mission.destinationUrl)) {
    const destLabel = document.createElement("span");
    destLabel.textContent = "Destination: ";
    const destLink = document.createElement("a");
    destLink.href = mission.destinationUrl;
    destLink.target = "_blank";
    destLink.rel = "noopener noreferrer";
    destLink.title = mission.destinationUrl;
    destLink.textContent = shortenUrlForDisplay(mission.destinationUrl);
    line4.append(destLabel, destLink);
  } else {
    line4.textContent = "Destination: — (required for External Click missions)";
  }
  row.appendChild(line4);

  return row;
}

/* ---- Quick actions: activate/deactivate, duplicate, delete ---- */

function toggleMissionActive(mission) {
  const nextActive = !mission.active;

  if (nextActive) {
    const urlMismatch = getActionIdUrlMismatch(mission.actionId, mission.destinationUrl, mission.id);
    if (urlMismatch) {
      window.alert(
        `Can't activate "${mission.title}" — another active mission ("${urlMismatch.title}") already uses ` +
        `Action ID "${mission.actionId}" with a DIFFERENT destination. Missions sharing an Action ID must ` +
        `all point to the same destination. Fix the destination URL, or use a different Action ID.`
      );
      return;
    }
    const destinationConflict = getActiveDestinationConflict(mission.destinationUrl, mission.actionId, mission.id);
    if (destinationConflict) {
      window.alert(
        `Can't activate "${mission.title}" — this destination is already tracked as Action ID ` +
        `"${destinationConflict.actionId}" by "${destinationConflict.title}". Use the same Action ID ` +
        `(${destinationConflict.actionId}) so all missions share the same tracked action, or point this ` +
        `mission to a different destination.`
      );
      return;
    }
    const configMismatch = getSharedActionConfigMismatch(
      mission.actionId,
      { actionType: mission.actionType, cooldownSeconds: mission.cooldownSeconds, maxCountPerDay: mission.maxCountPerDay },
      mission.id
    );
    if (configMismatch) {
      window.alert(
        `Can't activate "${mission.title}" — Action ID "${mission.actionId}" is already used by ` +
        `"${configMismatch.mission.title}" with a different ${configMismatch.field}. Missions sharing an ` +
        `Action ID must use the same ${configMismatch.field}.`
      );
      return;
    }
  }

  updateDoc(doc(db, "missions", mission.id), { active: nextActive, updatedAt: serverTimestamp() })
    .then(() => loadMissionsPanel())
    .catch((error) => {
      console.error(error);
      window.alert(`Couldn't update mission: ${error.message || "unknown error"}`);
    });
}

async function duplicateMission(id) {
  const original = missionsCache.find((m) => m.id === id);
  if (!original) return;

  const newTitle = `Copy of ${original.title || id}`;
  const newId = generateUniqueMissionId(newTitle, original.frequency, null);

  const data = {
    ...original,
    title: newTitle,
    active: false, // never auto-launch a duplicate as active (spec step 13)
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  delete data.id;

  try {
    await setDoc(doc(db, "missions", newId), data);
    await loadMissionsPanel();
  } catch (error) {
    console.error(error);
    window.alert(`Couldn't duplicate mission: ${error.message || "unknown error"}`);
  }
}

function deleteMission(id) {
  const mission = missionsCache.find((m) => m.id === id);
  if (!mission) return;
  const confirmed = window.confirm(
    `Delete "${mission.title || id}"?\n\n` +
    "Existing user progress/history will remain, but the mission definition will be removed.\n\n" +
    "Consider Deactivate instead if you just want to stop it from running."
  );
  if (!confirmed) return;

  deleteDoc(doc(db, "missions", id))
    .then(() => loadMissionsPanel())
    .catch((error) => {
      console.error(error);
      window.alert(`Couldn't delete mission: ${error.message || "unknown error"}`);
    });
}

/* ---- Editor ---- */

function blankMissionForm() {
  return {
    title: "", description: "", missionScope: "general", actionId: "", destinationUrl: "", actionType: "external_click",
    frequency: "daily", campaignId: "", target: 1, rewardDomiias: 0,
    cooldownSeconds: 0, maxCountPerDay: 1, startsAt: null, endsAt: null,
    displayOrder: 999, active: false, requiredForDailySet: true
  };
}

function updateMissionPreview() {
  const title = $("#me-title").value.trim() || "Mission title";
  const description = $("#me-description").value.trim();
  const target = Number($("#me-target").value) || 0;
  const reward = Number($("#me-reward").value) || 0;
  const destinationUrl = $("#me-destination-url").value.trim();

  $("#me-preview-title").textContent = title;
  const descEl = $("#me-preview-desc");
  descEl.textContent = description;
  descEl.hidden = !description;
  $("#me-preview-progress").textContent = `0 / ${target}`;
  $("#me-preview-progress-fill").style.width = "0%";

  const rewardEl = $("#me-preview-reward");
  rewardEl.innerHTML = "";
  rewardEl.appendChild(renderDomiiaAmount(reward, { size: "medium" }));

  const actionEl = $("#me-preview-action");
  if (isHttpUrl(destinationUrl)) {
    actionEl.href = destinationUrl;
    actionEl.target = "_blank";
    actionEl.rel = "noopener noreferrer";
    actionEl.removeAttribute("aria-disabled");
    actionEl.textContent = title;
  } else {
    actionEl.removeAttribute("href");
    actionEl.setAttribute("aria-disabled", "true");
    actionEl.textContent = "Link unavailable";
  }
}

function currentActionConfigFromForm() {
  return {
    actionType: $("#me-action-type").value,
    cooldownSeconds: Number($("#me-cooldown").value),
    maxCountPerDay: Number($("#me-max-count").value)
  };
}

// Step 9: sharing an Action ID across several active missions (tiered
// missions) is expected now — this warning only fires for the specific
// bad states spec sections 6/13/24 call out: a mismatched destination or
// mismatched action-level config among missions that would share this
// Action ID while active. Covers both mismatch checks in one warning
// slot since they're mutually exclusive in practice (the URL check fires
// first) and both block saving as Active the same way.
function updateActionIdWarning() {
  const actionId = $("#me-action-id").value.trim();
  const destinationUrl = $("#me-destination-url").value.trim();
  const warningEl = $("#me-action-id-warning");

  const urlMismatch = getActionIdUrlMismatch(actionId, destinationUrl, editingMissionId);
  if (urlMismatch) {
    warningEl.hidden = false;
    warningEl.textContent = `Another active mission ("${urlMismatch.title}") already uses this Action ID with a DIFFERENT destination URL. Saving this mission as Active will be blocked until the destinations match.`;
    return;
  }

  const configMismatch = getSharedActionConfigMismatch(actionId, currentActionConfigFromForm(), editingMissionId);
  if (configMismatch) {
    warningEl.hidden = false;
    warningEl.textContent = `Another active mission ("${configMismatch.mission.title}") already uses this Action ID with a different ${configMismatch.field}. Saving this mission as Active will be blocked until they match.`;
    return;
  }

  warningEl.hidden = true;
  warningEl.textContent = "";
}

function updateDestinationWarning() {
  const destinationUrl = $("#me-destination-url").value.trim();
  const actionId = $("#me-action-id").value.trim();
  const conflict = getActiveDestinationConflict(destinationUrl, actionId, editingMissionId);
  const warningEl = $("#me-destination-url-warning");
  if (conflict) {
    warningEl.hidden = false;
    warningEl.textContent = `This destination is already tracked as Action ID "${conflict.actionId}" by another active mission ("${conflict.title}"). Use that same Action ID instead, or point this mission to a different destination. Saving this mission as Active will be blocked until that's resolved.`;
  } else {
    warningEl.hidden = true;
    warningEl.textContent = "";
  }
}

function updateMaxCountWarning() {
  const target = Number($("#me-target").value);
  const maxCount = Number($("#me-max-count").value);
  const warningEl = $("#me-max-count-warning");
  if (Number.isFinite(target) && Number.isFinite(maxCount) && maxCount > 0 && maxCount < target) {
    warningEl.hidden = false;
    warningEl.textContent = "Max count per day must be at least the mission target.";
  } else {
    warningEl.hidden = true;
    warningEl.textContent = "";
  }
}

// Campaign Daily missions REQUIRE a campaignId (spec section 3) — General
// missions hide the campaign picker entirely rather than just disabling
// it, so there's no ambiguous "disabled select still showing a value"
// state. Called on scope change and whenever the form is (re)filled.
function updateScopeFields() {
  const isCampaign = $("#me-scope").value === "campaign";
  $("#me-campaign-field").hidden = !isCampaign;
}

function fillMissionForm(mission) {
  const m = mission || blankMissionForm();

  $("#me-id").value = mission ? mission.id : generateUniqueMissionId("", "daily", null);
  $("#me-id").disabled = !!mission;
  $("#me-title").value = m.title || "";
  $("#me-description").value = m.description || "";
  $("#me-scope").value = effectiveScope(m);
  $("#me-action-id").value = m.actionId || "";
  $("#me-destination-url").value = m.destinationUrl || "";
  $("#me-action-type").value = MISSION_ACTION_TYPES.includes(m.actionType) ? m.actionType : "external_click";
  $("#me-frequency").value = MISSION_FREQUENCIES.includes(m.frequency) ? m.frequency : "daily";

  if (missionCampaignOptionsFailed) {
    $("#me-campaign").hidden = true;
    $("#me-campaign-manual").hidden = false;
    $("#me-campaign-manual").value = m.campaignId || "";
    $("#me-campaign-fallback-note").hidden = false;
  } else {
    $("#me-campaign").hidden = false;
    $("#me-campaign-manual").hidden = true;
    $("#me-campaign-fallback-note").hidden = true;
    $("#me-campaign").value = m.campaignId || "";
  }

  $("#me-target").value = typeof m.target === "number" ? m.target : 1;
  $("#me-reward").value = typeof m.rewardDomiias === "number" ? m.rewardDomiias : 0;
  $("#me-cooldown").value = typeof m.cooldownSeconds === "number" ? m.cooldownSeconds : 0;
  $("#me-max-count").value = typeof m.maxCountPerDay === "number" ? m.maxCountPerDay : 1;
  $("#me-starts-at").value = dateToLocalDatetimeInputValue(timestampToDate(m.startsAt));
  $("#me-ends-at").value = dateToLocalDatetimeInputValue(timestampToDate(m.endsAt));
  $("#me-display-order").value = typeof m.displayOrder === "number" ? m.displayOrder : 999;
  $("#me-active").checked = !!m.active;
  // Defaults to checked for both a brand-new mission AND an existing
  // mission saved before this field existed — mirrors the backend's own
  // `requiredForDailySet !== false` convention (functions/missionLogic.js)
  // so a pre-Step-10.5 mission's behavior never silently changes.
  $("#me-required-for-daily-set").checked = m.requiredForDailySet !== false;

  updateScopeFields();
  updateMissionPreview();
  updateActionIdWarning();
  updateDestinationWarning();
  updateMaxCountWarning();
}

function openMissionEditor(id) {
  editingMissionId = id || null;
  missionActionIdTouched = !!id; // editing an existing mission never auto-rewrites its Action ID

  const mission = id ? missionsCache.find((m) => m.id === id) : null;
  $("#mission-editor-title").textContent = id ? `Edit Mission — ${(mission && mission.title) || id}` : "Add Mission";

  fillMissionForm(mission);

  setStatus($("#mission-editor-status"), "", null);
  $("#mission-editor").hidden = false;
  $("#mission-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeMissionEditor() {
  $("#mission-editor").hidden = true;
  editingMissionId = null;
}

// A General mission's campaignId is ALWAYS null (spec section 3) —
// regardless of whatever value the (hidden) campaign select happens to
// still hold from before the admin switched scope — so switching back to
// General and saving can never accidentally keep a stale campaignId.
function currentCampaignIdFromForm() {
  if ($("#me-scope").value !== "campaign") return null;
  const raw = missionCampaignOptionsFailed ? $("#me-campaign-manual").value : $("#me-campaign").value;
  return isNonEmptyString(raw) ? raw.trim() : null;
}

function validateMissionForm(idForSave) {
  const title = $("#me-title").value.trim();
  const actionId = $("#me-action-id").value.trim();
  const actionType = $("#me-action-type").value;
  const destinationUrl = $("#me-destination-url").value.trim();
  const target = $("#me-target").value;
  const reward = $("#me-reward").value;
  const cooldown = $("#me-cooldown").value;
  const maxCount = $("#me-max-count").value;
  const displayOrder = $("#me-display-order").value;
  const startsAt = localDatetimeInputValueToTimestamp($("#me-starts-at").value);
  const endsAt = localDatetimeInputValueToTimestamp($("#me-ends-at").value);
  const active = $("#me-active").checked;

  if (!isNonEmptyString(title)) return "Title is required.";

  // Step 10 spec section 3: a Campaign Daily mission must identify its
  // campaign; a General mission's campaignId is always null (enforced in
  // currentCampaignIdFromForm() regardless of what this check finds).
  if ($("#me-scope").value === "campaign" && !isNonEmptyString(currentCampaignIdFromForm())) {
    return "Campaign Daily missions require a campaign to be selected.";
  }

  if (!isNonEmptyString(actionId)) return "Action ID is required.";

  if (actionType === "external_click") {
    if (!isNonEmptyString(destinationUrl)) {
      return "Destination URL is required for External Click missions.";
    }
    if (!isHttpUrl(destinationUrl)) {
      return "Destination URL must be a valid http:// or https:// link.";
    }
  }

  if (!Number.isInteger(Number(target)) || Number(target) < 1 || !isNonEmptyString(String(target))) {
    return "Target must be a whole number of at least 1.";
  }
  if (!isNonEmptyString(String(reward)) || !Number.isInteger(Number(reward)) || Number(reward) < 0) {
    return "Reward Domiias must be a whole number of 0 or more.";
  }
  if (!isNonEmptyString(String(cooldown)) || !Number.isInteger(Number(cooldown)) || Number(cooldown) < 0) {
    return "Cooldown Seconds must be a whole number of 0 or more.";
  }
  if (!isNonEmptyString(String(maxCount)) || !Number.isInteger(Number(maxCount)) || Number(maxCount) < 1) {
    return "Max Count Per Day must be a whole number of at least 1.";
  }
  if (Number(maxCount) < Number(target)) {
    return "Max count per day must be at least the mission target.";
  }
  if (!isNonEmptyString(String(displayOrder)) || !Number.isInteger(Number(displayOrder))) {
    return "Display Order must be a whole number.";
  }
  if ($("#me-starts-at").value && !startsAt) return "Start date/time is invalid.";
  if ($("#me-ends-at").value && !endsAt) return "End date/time is invalid.";
  if (startsAt && endsAt && endsAt.toMillis() <= startsAt.toMillis()) {
    return "End date/time must be after the start date/time.";
  }

  if (active) {
    // Step 9: sharing an Action ID across several active missions is
    // valid now (tiered missions) — only these specific mismatches are
    // rejected (spec sections 6, 13, 23-25).
    const urlMismatch = getActionIdUrlMismatch(actionId, destinationUrl, idForSave);
    if (urlMismatch) {
      return `Can't save as Active — "${urlMismatch.title}" already uses Action ID "${actionId}" with a different destination URL. Missions sharing an Action ID must all point to the same destination.`;
    }
    const destinationConflict = getActiveDestinationConflict(destinationUrl, actionId, idForSave);
    if (destinationConflict) {
      return `Can't save as Active — this destination is already tracked as Action ID "${destinationConflict.actionId}" by "${destinationConflict.title}". Use that same Action ID so all missions share the same tracked action.`;
    }
    const configMismatch = getSharedActionConfigMismatch(
      actionId,
      { actionType, cooldownSeconds: Number(cooldown), maxCountPerDay: Number(maxCount) },
      idForSave
    );
    if (configMismatch) {
      return `Can't save as Active — "${configMismatch.mission.title}" already uses Action ID "${actionId}" with a different ${configMismatch.field}. Missions sharing an Action ID must use the same ${configMismatch.field}.`;
    }
  }

  return null;
}

function initMissionEditorForm() {
  $("#me-title").addEventListener("input", () => {
    if (!editingMissionId) {
      $("#me-id").value = generateUniqueMissionId($("#me-title").value, $("#me-frequency").value, null);
      if (!missionActionIdTouched) {
        $("#me-action-id").value = suggestActionId($("#me-title").value, currentCampaignIdFromForm());
      }
    }
    updateMissionPreview();
  });
  $("#me-frequency").addEventListener("change", () => {
    if (!editingMissionId) $("#me-id").value = generateUniqueMissionId($("#me-title").value, $("#me-frequency").value, null);
  });
  $("#me-scope").addEventListener("change", updateScopeFields);
  $("#me-campaign").addEventListener("change", () => {
    if (!editingMissionId && !missionActionIdTouched) {
      $("#me-action-id").value = suggestActionId($("#me-title").value, currentCampaignIdFromForm());
    }
  });
  $("#me-action-id").addEventListener("input", () => {
    missionActionIdTouched = true;
    updateActionIdWarning();
    updateDestinationWarning();
  });
  $("#me-destination-url").addEventListener("input", () => {
    updateMissionPreview();
    updateDestinationWarning();
    updateActionIdWarning();
  });
  $("#me-active").addEventListener("change", () => {
    updateActionIdWarning();
    updateDestinationWarning();
  });
  $("#me-description").addEventListener("input", updateMissionPreview);
  $("#me-target").addEventListener("input", () => {
    updateMissionPreview();
    updateMaxCountWarning();
  });
  $("#me-reward").addEventListener("input", updateMissionPreview);
  // cooldownSeconds/maxCountPerDay/actionType are shared-action config
  // (spec sections 6, 13) — any edit to them can newly create or resolve
  // a mismatch against an active sibling mission sharing this Action ID.
  $("#me-max-count").addEventListener("input", () => {
    updateMaxCountWarning();
    updateActionIdWarning();
  });
  $("#me-cooldown").addEventListener("input", updateActionIdWarning);
  $("#me-action-type").addEventListener("change", updateActionIdWarning);

  $("#mission-editor-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const isNew = !editingMissionId;
    const id = isNew ? $("#me-id").value.trim() : editingMissionId;

    if (isNew && (!isNonEmptyString(id) || !/^[a-z0-9-]+$/.test(id))) {
      setStatus($("#mission-editor-status"), "Mission ID must use only lowercase letters, numbers, and dashes.", "error");
      return;
    }
    if (isNew && missionsCache.some((m) => m.id === id)) {
      setStatus($("#mission-editor-status"), `A mission with ID "${id}" already exists.`, "error");
      return;
    }

    const error = validateMissionForm(isNew ? null : id);
    if (error) {
      setStatus($("#mission-editor-status"), error, "error");
      return;
    }

    const data = {
      title: $("#me-title").value.trim(),
      description: $("#me-description").value.trim(),
      missionScope: $("#me-scope").value === "campaign" ? "campaign" : "general",
      actionId: $("#me-action-id").value.trim(),
      destinationUrl: $("#me-destination-url").value.trim(),
      actionType: $("#me-action-type").value,
      frequency: $("#me-frequency").value,
      campaignId: currentCampaignIdFromForm(),
      target: Number($("#me-target").value),
      rewardDomiias: Number($("#me-reward").value),
      cooldownSeconds: Number($("#me-cooldown").value),
      maxCountPerDay: Number($("#me-max-count").value),
      startsAt: localDatetimeInputValueToTimestamp($("#me-starts-at").value),
      endsAt: localDatetimeInputValueToTimestamp($("#me-ends-at").value),
      displayOrder: Number($("#me-display-order").value),
      active: $("#me-active").checked,
      requiredForDailySet: $("#me-required-for-daily-set").checked,
      updatedAt: serverTimestamp()
    };

    withSaving($("#mission-editor-save"), $("#mission-editor-status"), "Saving…", async () => {
      if (isNew) {
        data.createdAt = serverTimestamp();
        await setDoc(doc(db, "missions", id), data);
      } else {
        // Preserve the document ID and createdAt — merge only updates the
        // editable fields above (spec step 12).
        await setDoc(doc(db, "missions", id), data, { merge: true });
      }
      closeMissionEditor();
      await loadMissionsPanel();
    });
  });

  $("#mission-editor-cancel").addEventListener("click", closeMissionEditor);
  $("#mission-add-btn").addEventListener("click", () => openMissionEditor(null));
}

const MISSION_GENERATE_STATUS_BADGE_CLASS = { new: "badge-active", exists: "badge-previous", "missing-url": "badge-coming-soon" };
const MISSION_GENERATE_STATUS_LABEL = { new: "+ New", exists: "✓ Already exists", "missing-url": "⚠ Missing URL" };
let missionGenerateCandidates = [];

function renderMissionGeneratePreview(candidates) {
  missionGenerateCandidates = candidates;
  const listEl = $("#mission-generate-preview-list");
  listEl.innerHTML = "";

  candidates.forEach((candidate) => {
    const row = document.createElement("div");
    row.className = "admin-item";

    const line = document.createElement("p");
    line.className = "admin-meta";
    line.style.display = "flex";
    line.style.alignItems = "center";
    line.style.gap = "8px";
    line.style.flexWrap = "wrap";

    const label = document.createElement("strong");
    label.textContent = candidate.summary;
    const badge = document.createElement("span");
    badge.className = `badge ${MISSION_GENERATE_STATUS_BADGE_CLASS[candidate.status]}`;
    badge.textContent = MISSION_GENERATE_STATUS_LABEL[candidate.status];
    const idText = document.createElement("span");
    idText.textContent = `(${candidate.id})`;

    line.append(label, badge, idText);
    row.appendChild(line);
    listEl.appendChild(row);
  });

  const newCount = candidates.filter((c) => c.status === "new").length;
  const existsCount = candidates.filter((c) => c.status === "exists").length;
  const missingCount = candidates.filter((c) => c.status === "missing-url").length;
  $("#mission-generate-summary").textContent =
    `${newCount} new mission${newCount === 1 ? "" : "s"} will be created · ${existsCount} already exist and will be left untouched` +
    (missingCount ? ` · ${missingCount} skipped (missing URL)` : "");
  $("#mission-generate-confirm").disabled = newCount === 0;
}

async function openMissionGeneratePanel() {
  $("#mission-generate-panel").hidden = false;
  $("#mission-generate-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus($("#mission-generate-status"), "", null);
  $("#mission-generate-preview-list").innerHTML = "";
  $("#mission-generate-summary").textContent = "Loading current campaign links…";
  $("#mission-generate-confirm").disabled = true;

  // Live campaigns/{id} doc wins over the js/data.js fallback for each
  // campaign (the admin may have already edited its links in Campaign
  // Manager) — falls back gracefully if a doc doesn't exist or its read fails.
  let liveHeartbound = null;
  let liveNewSeries2026 = null;
  try {
    const snap = await getDoc(doc(db, "campaigns", "heartbound"));
    if (snap.exists()) liveHeartbound = snap.data();
  } catch (error) {
    console.error(error);
  }
  try {
    const snap = await getDoc(doc(db, "campaigns", "new-series-2026"));
    if (snap.exists()) liveNewSeries2026 = snap.data();
  } catch (error) {
    console.error(error);
  }

  renderMissionGeneratePreview(buildStreamingMissionCandidates(liveHeartbound, liveNewSeries2026));
}

function closeMissionGeneratePanel() {
  $("#mission-generate-panel").hidden = true;
  missionGenerateCandidates = [];
}

function initMissionGeneratePanel() {
  $("#mission-generate-btn").addEventListener("click", openMissionGeneratePanel);
  $("#mission-generate-cancel").addEventListener("click", closeMissionGeneratePanel);

  $("#mission-generate-confirm").addEventListener("click", () => {
    const toCreate = missionGenerateCandidates.filter((c) => c.status === "new");
    if (!toCreate.length) return;

    withSaving($("#mission-generate-confirm"), $("#mission-generate-status"), "Creating missions…", async () => {
      // One atomic batch — either every new mission is created, or (on
      // failure) none are, never a half-applied generation.
      const batch = writeBatch(db);
      toCreate.forEach((candidate) => {
        batch.set(doc(db, "missions", candidate.id), {
          ...candidate.data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      closeMissionGeneratePanel();
      await loadMissionsPanel();
    });
  });
}

/* ---- Filters + bootstrap ---- */

function initMissionsFilters() {
  document.querySelectorAll("#missions-status-filter-tabs .admin-subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#missions-status-filter-tabs .admin-subtab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      missionStatusFilter = tab.getAttribute("data-missions-status-filter");
      renderMissionsList();
    });
  });

  $("#missions-campaign-filter").addEventListener("change", () => {
    missionCampaignFilter = $("#missions-campaign-filter").value;
    renderMissionsList();
  });
}

function initMissionsPanel() {
  initMissionEditorForm();
  initMissionsFilters();
  initMissionGeneratePanel();
}

async function loadMissionsPanel() {
  const listEl = $("#missions-list");

  const [campaignResult, missionsResult] = await Promise.all([
    getMissionCampaignOptions(),
    (async () => {
      try {
        const snap = await getDocs(collection(db, "missions"));
        return { ok: true, docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      } catch (error) {
        console.error(error);
        return { ok: false, docs: [] };
      }
    })()
  ]);

  missionCampaignOptionsFailed = !campaignResult.ok;
  missionCampaignOptions = campaignResult.campaigns;
  populateMissionCampaignSelects(missionCampaignOptions);

  if (!missionsResult.ok) {
    listEl.innerHTML = "";
    const errorEl = document.createElement("p");
    errorEl.className = "admin-empty";
    errorEl.textContent = "Couldn't load missions — check your connection and reload the page.";
    listEl.appendChild(errorEl);
    return;
  }

  missionsCache = missionsResult.docs;
  renderMissionsList();
}

/* ==========================================================================
   Cosmetics (Step 10.5) — "Import Default Cosmetics" admin-only seed tool
   ------------------------------------------------------------------
   Writes the 23 cosmetic definitions functions/achievements.js's
   cosmeticRewards actually reference (see that file for the full
   achievement -> cosmetic mapping). Definitions only — no artwork is
   generated here; avatar/background entries point at an expected asset
   path the admin adds the real image file to afterward. Idempotent by
   cosmetic ID: a cosmetic that already exists (whether seeded by this
   tool before, or hand-created/customized in the Firestore Console) is
   always left completely untouched — this tool only ever CREATES a
   missing definition, never updates or overwrites one.
   ========================================================================== */
let cosmeticsCache = [];
let cosmeticsImportCandidates = [];

// type: "avatar" | "background" | "theme". Avatar/background carry an
// assetPath convention matching the one already established in Step 6
// (see test-sync-achievements.js's seedCosmetic calls) —
// assets/rewards/{type}s/{slug}.{ext}. Theme entries carry a themeKey
// instead, validated against KNOWN_THEME_KEYS server-side
// (functions/cosmeticLogic.js) before it can ever be equipped — an entry
// here pointing at an unrecognized key would simply fail to equip, never
// silently apply arbitrary CSS.
const DEFAULT_COSMETICS = [
  // ---- Avatars (10) ----
  { id: "first-steps-avatar", type: "avatar", title: "First Steps", description: "Awarded for completing your first mission.", assetPath: "assets/rewards/avatars/first-steps.png" },
  { id: "mission-25-avatar", type: "avatar", title: "Supporter", description: "Awarded for completing 25 missions.", assetPath: "assets/rewards/avatars/mission-25.png" },
  { id: "mission-100-avatar", type: "avatar", title: "Super Supporter", description: "Awarded for completing 100 missions.", assetPath: "assets/rewards/avatars/mission-100.png" },
  { id: "streak-7-avatar", type: "avatar", title: "A Week Together", description: "Awarded for a 7-day General Daily streak.", assetPath: "assets/rewards/avatars/streak-7.png" },
  { id: "streak-30-avatar", type: "avatar", title: "Unstoppable", description: "Awarded for a 30-day General Daily streak.", assetPath: "assets/rewards/avatars/streak-30.png" },
  { id: "campaign-supporter-avatar", type: "avatar", title: "Campaign Supporter", description: "Awarded for completing your first Campaign mission.", assetPath: "assets/rewards/avatars/campaign-supporter.png" },
  { id: "domiia-1000-avatar", type: "avatar", title: "Domiia Treasure", description: "Awarded for earning 1,000 lifetime Domiias.", assetPath: "assets/rewards/avatars/domiia-1000.png" },
  { id: "streaming-legend-avatar", type: "avatar", title: "Streaming Legend", description: "Awarded for 1,000 tracked streaming support actions.", assetPath: "assets/rewards/avatars/streaming-legend.png" },
  { id: "youtube-100-avatar", type: "avatar", title: "Replay Crew", description: "Awarded for 100 tracked YouTube support actions.", assetPath: "assets/rewards/avatars/youtube-100.png" },
  { id: "spotify-100-avatar", type: "avatar", title: "Playlist Energy", description: "Awarded for 100 tracked Spotify support actions.", assetPath: "assets/rewards/avatars/spotify-100.png" },

  // ---- Backgrounds (7) — Step 10.6: responsive desktop(landscape)/
  // mobile(portrait) variants instead of one assetPath. previewPath
  // defaults to the desktop image (see §12 of the Step 10.6 spec);
  // buildCosmeticsImportCandidates() below derives it automatically so it
  // never has to be kept in sync by hand. ----
  { id: "mission-250-background", type: "background", title: "Mission Master", description: "Awarded for completing 250 missions.", desktopAssetPath: "assets/rewards/backgrounds/mission-250-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/mission-250-mobile.jpg" },
  { id: "perfect-day-background", type: "background", title: "Perfect Day", description: "Awarded for your first Perfect Day.", desktopAssetPath: "assets/rewards/backgrounds/perfect-day-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/perfect-day-mobile.jpg" },
  { id: "streak-14-background", type: "background", title: "Two Weeks Together", description: "Awarded for a 14-day General Daily streak.", desktopAssetPath: "assets/rewards/backgrounds/streak-14-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/streak-14-mobile.jpg" },
  { id: "streak-60-background", type: "background", title: "Always Here", description: "Awarded for a 60-day General Daily streak.", desktopAssetPath: "assets/rewards/backgrounds/streak-60-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/streak-60-mobile.jpg" },
  { id: "campaign-10-background", type: "background", title: "Campaign Veteran", description: "Awarded for completing 10 Campaign daily sets.", desktopAssetPath: "assets/rewards/backgrounds/campaign-10-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/campaign-10-mobile.jpg" },
  { id: "domiia-2500-background", type: "background", title: "Domiia Legend", description: "Awarded for earning 2,500 lifetime Domiias.", desktopAssetPath: "assets/rewards/backgrounds/domiia-2500-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/domiia-2500-mobile.jpg" },
  { id: "streaming-500-background", type: "background", title: "Streaming Machine", description: "Awarded for 500 tracked streaming support actions.", desktopAssetPath: "assets/rewards/backgrounds/streaming-500-desktop.jpg", mobileAssetPath: "assets/rewards/backgrounds/streaming-500-mobile.jpg" },

  // ---- Themes (6) — three-day-theme deliberately reuses the existing
  // purple-night CSS key rather than needing a 7th dedicated theme; the
  // other 5 each use one of the Step 10.5 CSS additions (css/style.css). ----
  { id: "three-day-theme", type: "theme", title: "On a Roll", description: "Awarded for a 3-day General Daily streak.", themeKey: "purple-night" },
  { id: "midnight-blue-theme", type: "theme", title: "Midnight Blue", description: "Awarded for 30 completed General Daily sets.", themeKey: "midnight-blue" },
  { id: "heartbound-red-theme", type: "theme", title: "Heartbound Red", description: "Awarded for completing 25 Campaign daily sets.", themeKey: "heartbound-red" },
  { id: "golden-supporter-theme", type: "theme", title: "Golden Supporter", description: "Awarded for earning 5,000 lifetime Domiias.", themeKey: "golden-supporter" },
  { id: "soft-pink-theme", type: "theme", title: "Soft Pink", description: "Awarded for supporting 10 different tracked streaming actions.", themeKey: "soft-pink" },
  { id: "domiia-night-theme", type: "theme", title: "Domiia Night", description: "Awarded for a 100-day General Daily streak.", themeKey: "domiia-night" }
];

function renderCosmeticsList() {
  const listEl = $("#cosmetics-list");
  listEl.innerHTML = "";

  if (!cosmeticsCache.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No cosmetic definitions yet — use Import Default Cosmetics above.";
    listEl.appendChild(empty);
    return;
  }

  cosmeticsCache
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type) || (a.title || "").localeCompare(b.title || ""))
    .forEach((cosmetic) => {
      const row = document.createElement("div");
      row.className = "admin-item";
      const line = document.createElement("p");
      line.className = "admin-meta";
      let detail;
      if (cosmetic.type === "theme") {
        detail = `themeKey: ${cosmetic.themeKey || "—"}`;
      } else if (cosmetic.type === "background") {
        // Step 10.6: show BOTH variants so a missing one is obvious at a
        // glance — legacy docs (assetPath only, no desktopAssetPath yet)
        // still show something useful instead of two blank dashes.
        const desktop = cosmetic.desktopAssetPath || cosmetic.assetPath || "—";
        const mobile = cosmetic.mobileAssetPath || cosmetic.desktopAssetPath || cosmetic.assetPath || "—";
        detail = `Desktop: ${desktop} · Mobile: ${mobile}`;
      } else {
        detail = `assetPath: ${cosmetic.assetPath || "—"}`;
      }
      line.textContent = `${cosmetic.title || cosmetic.id} (${cosmetic.id}) · ${cosmetic.type} · ${detail} · ${cosmetic.active === false ? "Inactive" : "Active"}`;
      row.appendChild(line);
      listEl.appendChild(row);
    });
}

async function loadCosmeticsPanel() {
  try {
    const snap = await getDocs(collection(db, "cosmetics"));
    cosmeticsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error(error);
    cosmeticsCache = [];
  }
  renderCosmeticsList();
}

function renderCosmeticsImportPreview(candidates) {
  cosmeticsImportCandidates = candidates;
  const listEl = $("#cosmetics-import-preview-list");
  listEl.innerHTML = "";

  candidates.forEach((candidate) => {
    const row = document.createElement("div");
    row.className = "admin-item";
    const line = document.createElement("p");
    line.className = "admin-meta";
    line.style.display = "flex";
    line.style.alignItems = "center";
    line.style.gap = "8px";
    line.style.flexWrap = "wrap";

    const label = document.createElement("strong");
    label.textContent = `${candidate.data.title} (${candidate.id})`;
    const badge = document.createElement("span");
    badge.className = `badge ${candidate.status === "new" ? "badge-active" : "badge-previous"}`;
    badge.textContent = candidate.status === "new" ? "+ New" : "✓ Already exists";

    line.append(label, badge);
    row.appendChild(line);
    listEl.appendChild(row);
  });

  const newCount = candidates.filter((c) => c.status === "new").length;
  const existsCount = candidates.length - newCount;
  $("#cosmetics-import-summary").textContent =
    `${newCount} new cosmetic${newCount === 1 ? "" : "s"} will be created · ${existsCount} already exist and will be left untouched`;
  $("#cosmetics-import-confirm").disabled = newCount === 0;
}

function cosmeticTypeSpecificFields(def) {
  if (def.type === "theme") return { themeKey: def.themeKey };
  if (def.type === "background") {
    // previewPath defaults to the desktop image (spec §12: "prefer desktop
    // preview on desktop... if a dedicated previewPath exists, it may
    // still override" — none of the defaults need an override).
    return {
      desktopAssetPath: def.desktopAssetPath,
      mobileAssetPath: def.mobileAssetPath,
      previewPath: def.previewPath || def.desktopAssetPath
    };
  }
  return { assetPath: def.assetPath };
}

function buildCosmeticsImportCandidates() {
  const existingIds = new Set(cosmeticsCache.map((c) => c.id));
  return DEFAULT_COSMETICS.map((def) => ({
    id: def.id,
    status: existingIds.has(def.id) ? "exists" : "new",
    data: {
      type: def.type,
      title: def.title,
      description: def.description,
      active: true,
      ...cosmeticTypeSpecificFields(def)
    }
  }));
}

function openCosmeticsImportPanel() {
  $("#cosmetics-import-panel").hidden = false;
  $("#cosmetics-import-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus($("#cosmetics-import-status"), "", null);
  renderCosmeticsImportPreview(buildCosmeticsImportCandidates());
}

function closeCosmeticsImportPanel() {
  $("#cosmetics-import-panel").hidden = true;
  cosmeticsImportCandidates = [];
}

function initCosmeticsPanel() {
  $("#cosmetics-import-btn").addEventListener("click", openCosmeticsImportPanel);
  $("#cosmetics-import-cancel").addEventListener("click", closeCosmeticsImportPanel);

  $("#cosmetics-import-confirm").addEventListener("click", () => {
    const toCreate = cosmeticsImportCandidates.filter((c) => c.status === "new");
    if (!toCreate.length) return;

    withSaving($("#cosmetics-import-confirm"), $("#cosmetics-import-status"), "Creating cosmetics…", async () => {
      // One atomic batch, same convention as the Generate Streaming
      // Missions tool — either every new definition is created, or none.
      const batch = writeBatch(db);
      toCreate.forEach((candidate) => {
        batch.set(doc(db, "cosmetics", candidate.id), {
          ...candidate.data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      closeCosmeticsImportPanel();
      await loadCosmeticsPanel();
    });
  });

  initBackgroundUpgradePanel();
  loadCosmeticsPanel();
}

/* ==========================================================================
   "Upgrade Legacy Backgrounds" (Step 10.6) — safe, additive-only migration
   ------------------------------------------------------------------
   For any of the 7 known default background cosmetics that exist in
   Firestore WITHOUT a desktopAssetPath yet (i.e. still on the old
   single-assetPath schema), proposes ADDING desktopAssetPath/
   mobileAssetPath/previewPath (merge-update, never a full overwrite) —
   title/description/active/the original assetPath field are all left
   completely untouched. A background that already HAS a desktopAssetPath
   (whether set by this tool before, or hand-customized by the admin) is
   correctly reported as already up to date and is never touched again.
   ========================================================================== */
let backgroundUpgradeCandidates = [];

function buildBackgroundUpgradeCandidates() {
  const defaultsById = new Map(DEFAULT_COSMETICS.filter((d) => d.type === "background").map((d) => [d.id, d]));
  return cosmeticsCache
    .filter((c) => c.type === "background" && defaultsById.has(c.id) && !isNonEmptyString(c.desktopAssetPath))
    .map((c) => {
      const def = defaultsById.get(c.id);
      return {
        id: c.id,
        data: {
          desktopAssetPath: def.desktopAssetPath,
          mobileAssetPath: def.mobileAssetPath,
          previewPath: c.previewPath || def.previewPath || def.desktopAssetPath
        }
      };
    });
}

function renderBackgroundUpgradePreview(candidates) {
  backgroundUpgradeCandidates = candidates;
  const listEl = $("#cosmetics-upgrade-preview-list");
  listEl.innerHTML = "";

  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Every known background already has responsive desktop/mobile paths — nothing to upgrade.";
    listEl.appendChild(empty);
  }

  candidates.forEach((candidate) => {
    const row = document.createElement("div");
    row.className = "admin-item";
    const line = document.createElement("p");
    line.className = "admin-meta";
    line.textContent = `${candidate.id} → adds desktopAssetPath: ${candidate.data.desktopAssetPath}, mobileAssetPath: ${candidate.data.mobileAssetPath}`;
    row.appendChild(line);
    listEl.appendChild(row);
  });

  $("#cosmetics-upgrade-summary").textContent = candidates.length
    ? `${candidates.length} background${candidates.length === 1 ? "" : "s"} will be upgraded with responsive paths — no other field is touched.`
    : "";
  $("#cosmetics-upgrade-confirm").disabled = candidates.length === 0;
}

function openBackgroundUpgradePanel() {
  $("#cosmetics-upgrade-panel").hidden = false;
  $("#cosmetics-upgrade-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus($("#cosmetics-upgrade-status"), "", null);
  renderBackgroundUpgradePreview(buildBackgroundUpgradeCandidates());
}

function closeBackgroundUpgradePanel() {
  $("#cosmetics-upgrade-panel").hidden = true;
  backgroundUpgradeCandidates = [];
}

function initBackgroundUpgradePanel() {
  $("#cosmetics-upgrade-btn").addEventListener("click", openBackgroundUpgradePanel);
  $("#cosmetics-upgrade-cancel").addEventListener("click", closeBackgroundUpgradePanel);

  $("#cosmetics-upgrade-confirm").addEventListener("click", () => {
    if (!backgroundUpgradeCandidates.length) return;

    withSaving($("#cosmetics-upgrade-confirm"), $("#cosmetics-upgrade-status"), "Upgrading backgrounds…", async () => {
      const batch = writeBatch(db);
      backgroundUpgradeCandidates.forEach((candidate) => {
        // merge: true (not set/overwrite) — adds exactly these 3 fields,
        // leaves assetPath/title/description/active/everything else as-is.
        batch.set(doc(db, "cosmetics", candidate.id), { ...candidate.data, updatedAt: serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      closeBackgroundUpgradePanel();
      await loadCosmeticsPanel();
    });
  });
}

/* ==========================================================================
   Comment Helper manager (per-campaign)
   ------------------------------------------------------------------
   Opened via the [Comment Helper] button on a Campaign Manager row.
   campaigns/{id}.features.commentHelper is the visibility flag (shared
   with the main campaign editor's checkbox); campaigns/{id}.commentHelper
   holds the lightweight label config. The phrase library itself lives in
   the campaigns/{id}/commentHelperPhrases subcollection and is never
   embedded in the campaign doc, and never fetched in full by the public
   site (see js/firestore-content.js's fetchCommentHelperBatch). This admin
   view DOES load the whole subcollection at once when opened — the same
   management-only tradeoff Trending's phrase manager already makes.
   ========================================================================== */

const COMMENT_HELPER_PHRASE_PAGE_SIZE = 100;

let commentHelperCampaignId = null;
const commentHelperPhraseCache = {}; // campaignId -> { items: [{id,text,enabled,randomKey,normalizedText}], loaded }
let commentHelperSearchTerm = "";
let commentHelperStatusFilter = "all";
let commentHelperVisibleCount = COMMENT_HELPER_PHRASE_PAGE_SIZE;
let commentHelperCsvPreview = null;

function commentHelperPhrasesPath(campaignId) {
  return `campaigns/${campaignId}/commentHelperPhrases`;
}

async function ensureCommentHelperCacheLoaded(campaignId, forceReload) {
  if (!forceReload && commentHelperPhraseCache[campaignId] && commentHelperPhraseCache[campaignId].loaded) {
    return commentHelperPhraseCache[campaignId];
  }
  const snap = await getDocs(collection(db, commentHelperPhrasesPath(campaignId)));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  commentHelperPhraseCache[campaignId] = { items, loaded: true };
  return commentHelperPhraseCache[campaignId];
}

function updateCommentHelperCounts() {
  const cache = commentHelperPhraseCache[commentHelperCampaignId];
  const items = cache ? cache.items : [];
  const total = items.length;
  const enabled = items.filter((p) => p.enabled !== false).length;
  $("#comment-helper-phrase-total").textContent = total;
  $("#comment-helper-phrase-enabled").textContent = enabled;
  $("#comment-helper-phrase-disabled").textContent = total - enabled;
}

// Only Heartbound ever sees this, and only while its library is empty —
// this is the one place the Comment Helper admin code is allowed to know
// a campaign's id, because it's specifically the migration/legacy layer.
function updateCommentHelperMigrationBanner(campaignId) {
  const banner = $("#comment-helper-migrate-banner");
  const cache = commentHelperPhraseCache[campaignId];
  const isEmpty = !!(cache && cache.loaded && cache.items.length === 0);
  banner.hidden = !(campaignId === "heartbound" && isEmpty);
}

function collapseCommentHelperSubPanels() {
  $("#comment-helper-csv-panel").hidden = true;
  $("#comment-helper-add-panel").hidden = true;
}

function toggleCommentHelperSubPanel(panelEl) {
  const willShow = panelEl.hidden;
  collapseCommentHelperSubPanels();
  panelEl.hidden = !willShow;
}

function renderCommentHelperPhraseList() {
  const listEl = $("#comment-helper-phrase-list");
  const showMoreBtn = $("#comment-helper-phrase-show-more");
  const cache = commentHelperPhraseCache[commentHelperCampaignId];
  listEl.innerHTML = "";
  if (!cache) return;

  const term = commentHelperSearchTerm.trim().toLowerCase();
  let filtered = cache.items;
  if (term) filtered = filtered.filter((p) => (p.text || "").toLowerCase().includes(term));
  if (commentHelperStatusFilter === "enabled") filtered = filtered.filter((p) => p.enabled !== false);
  if (commentHelperStatusFilter === "disabled") filtered = filtered.filter((p) => p.enabled === false);

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No phrases found.";
    listEl.appendChild(empty);
    showMoreBtn.hidden = true;
    return;
  }

  const visible = filtered.slice(0, commentHelperVisibleCount);

  visible.forEach((phrase) => {
    const row = document.createElement("div");
    row.className = "admin-phrase-row";

    const textArea = document.createElement("textarea");
    textArea.rows = 2;
    textArea.value = phrase.text || "";
    row.appendChild(textArea);

    const actions = document.createElement("div");
    actions.className = "admin-phrase-row-actions";

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "admin-checkbox-label";
    const enabledCheckbox = document.createElement("input");
    enabledCheckbox.type = "checkbox";
    enabledCheckbox.checked = phrase.enabled !== false;
    enabledCheckbox.addEventListener("change", () => {
      updateDoc(doc(db, commentHelperPhrasesPath(commentHelperCampaignId), phrase.id), {
        enabled: enabledCheckbox.checked
      })
        .then(() => {
          phrase.enabled = enabledCheckbox.checked;
          updateCommentHelperCounts();
        })
        .catch((error) => {
          console.error(error);
          enabledCheckbox.checked = !enabledCheckbox.checked;
          window.alert(`Couldn't update: ${error.message || "unknown error"}`);
        });
    });
    enabledLabel.append(enabledCheckbox, " Enabled");
    actions.appendChild(enabledLabel);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-secondary btn-sm";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const newText = textArea.value.trim();
      if (!newText) {
        window.alert("Phrase text can't be empty.");
        return;
      }
      saveBtn.disabled = true;
      try {
        await updateDoc(doc(db, commentHelperPhrasesPath(commentHelperCampaignId), phrase.id), {
          text: newText,
          normalizedText: normalizePhraseKey(newText),
          updatedAt: serverTimestamp()
        });
        phrase.text = newText;
        phrase.normalizedText = normalizePhraseKey(newText);
      } catch (error) {
        console.error(error);
        window.alert(`Couldn't save: ${error.message || "unknown error"}`);
      } finally {
        saveBtn.disabled = false;
      }
    });
    actions.appendChild(saveBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "admin-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "Delete phrase");
    deleteBtn.addEventListener("click", async () => {
      if (!confirmDelete("Delete this phrase? This can't be undone.")) return;
      try {
        await deleteDoc(doc(db, commentHelperPhrasesPath(commentHelperCampaignId), phrase.id));
        const cache2 = commentHelperPhraseCache[commentHelperCampaignId];
        cache2.items = cache2.items.filter((p) => p.id !== phrase.id);
        updateCommentHelperCounts();
        renderCommentHelperPhraseList();
      } catch (error) {
        console.error(error);
        window.alert(`Couldn't delete: ${error.message || "unknown error"}`);
      }
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });

  showMoreBtn.hidden = filtered.length <= commentHelperVisibleCount;
}

function openCommentHelperManager(campaignId) {
  const campaign = campaignsCache.find((c) => c.id === campaignId);
  if (!campaign) return;

  commentHelperCampaignId = campaignId;
  commentHelperSearchTerm = "";
  commentHelperStatusFilter = "all";
  commentHelperVisibleCount = COMMENT_HELPER_PHRASE_PAGE_SIZE;
  commentHelperCsvPreview = null;
  $("#comment-helper-phrase-search").value = "";
  $("#comment-helper-csv-file").value = "";
  $("#comment-helper-csv-preview-panel").hidden = true;
  document.querySelectorAll("#comment-helper-filter-tabs .admin-subtab").forEach((t) => {
    t.classList.toggle("is-active", t.getAttribute("data-comment-helper-filter") === "all");
  });
  collapseCommentHelperSubPanels();
  [
    "comment-helper-config-status",
    "comment-helper-migrate-status",
    "comment-helper-csv-status",
    "comment-helper-add-status"
  ].forEach((id) => setStatus($(`#${id}`), "", null));

  $("#comment-helper-manager-title").textContent = `Comment Helper — ${campaign.title || campaignId}`;

  const config = campaign.commentHelper || {};
  $("#chm-enabled").checked = !!(campaign.features && campaign.features.commentHelper);
  $("#chm-title").value = config.title || "Comment Helper";
  $("#chm-description").value = config.description || "Need an idea? Generate a comment you can personalize.";
  $("#chm-button-label").value = config.buttonLabel || "Generate Comment";
  $("#chm-copy-label").value = config.copyLabel || "Copy";
  $("#chm-allow-editing").checked = config.allowEditing !== false;

  $("#comment-helper-manager").hidden = false;
  $("#campaign-editor").hidden = true;
  $("#comment-helper-manager").scrollIntoView({ behavior: "smooth", block: "start" });

  $("#comment-helper-phrase-total").textContent = "…";
  $("#comment-helper-phrase-enabled").textContent = "…";
  $("#comment-helper-phrase-disabled").textContent = "…";

  ensureCommentHelperCacheLoaded(campaignId).then(() => {
    updateCommentHelperCounts();
    updateCommentHelperMigrationBanner(campaignId);
    renderCommentHelperPhraseList();
  });
}

function closeCommentHelperManager() {
  $("#comment-helper-manager").hidden = true;
  commentHelperCampaignId = null;
}

function initCommentHelperConfigForm() {
  $("#comment-helper-manager-close").addEventListener("click", closeCommentHelperManager);

  $("#comment-helper-config-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!commentHelperCampaignId) return;

    const campaignId = commentHelperCampaignId;
    const enabled = $("#chm-enabled").checked;
    const config = {
      title: $("#chm-title").value.trim() || "Comment Helper",
      description: $("#chm-description").value.trim(),
      buttonLabel: $("#chm-button-label").value.trim() || "Generate Comment",
      copyLabel: $("#chm-copy-label").value.trim() || "Copy",
      allowEditing: $("#chm-allow-editing").checked
    };

    withSaving($("#comment-helper-config-save"), $("#comment-helper-config-status"), "Saving…", async () => {
      await updateDoc(doc(db, "campaigns", campaignId), {
        "features.commentHelper": enabled,
        commentHelper: config,
        updatedAt: serverTimestamp()
      });
      await loadCampaignsPanel();
    });
  });
}

function initCommentHelperAddPhrase() {
  $("#comment-helper-add-toggle").addEventListener("click", () => toggleCommentHelperSubPanel($("#comment-helper-add-panel")));
  $("#comment-helper-csv-toggle").addEventListener("click", () => toggleCommentHelperSubPanel($("#comment-helper-csv-panel")));

  $("#comment-helper-phrase-add-save").addEventListener("click", () => {
    const input = $("#comment-helper-phrase-add-input");
    const text = input.value.trim();
    if (!text) {
      setStatus($("#comment-helper-add-status"), "Enter phrase text first.", "error");
      return;
    }

    withSaving($("#comment-helper-phrase-add-save"), $("#comment-helper-add-status"), "Saving…", async () => {
      const campaignId = commentHelperCampaignId;
      const randomKey = Math.random();
      const ref = await addDoc(collection(db, commentHelperPhrasesPath(campaignId)), {
        text,
        normalizedText: normalizePhraseKey(text),
        enabled: true,
        randomKey,
        createdAt: serverTimestamp()
      });
      input.value = "";

      const cache = commentHelperPhraseCache[campaignId];
      if (cache && cache.loaded) {
        cache.items.push({ id: ref.id, text, enabled: true, randomKey, normalizedText: normalizePhraseKey(text) });
      }
      updateCommentHelperCounts();
      updateCommentHelperMigrationBanner(campaignId);
      renderCommentHelperPhraseList();
    });
  });
}

function initCommentHelperSearchAndFilter() {
  $("#comment-helper-phrase-search").addEventListener("input", (event) => {
    commentHelperSearchTerm = event.target.value;
    commentHelperVisibleCount = COMMENT_HELPER_PHRASE_PAGE_SIZE;
    renderCommentHelperPhraseList();
  });

  $("#comment-helper-phrase-show-more").addEventListener("click", () => {
    commentHelperVisibleCount += COMMENT_HELPER_PHRASE_PAGE_SIZE;
    renderCommentHelperPhraseList();
  });

  document.querySelectorAll("#comment-helper-filter-tabs .admin-subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#comment-helper-filter-tabs .admin-subtab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      commentHelperStatusFilter = tab.getAttribute("data-comment-helper-filter");
      commentHelperVisibleCount = COMMENT_HELPER_PHRASE_PAGE_SIZE;
      renderCommentHelperPhraseList();
    });
  });
}

/* ---- CSV import: preview (rows found / valid / duplicates / blank) before
   any write, Add or Replace, chunked writes with progress, clear
   partial-failure reporting. ---- */

function currentCommentHelperCsvMode() {
  const checked = document.querySelector('input[name="comment-helper-csv-mode"]:checked');
  return checked ? checked.value : "add";
}

async function buildCommentHelperCsvPreview(rawText, fileName) {
  const { rows, invalidCount } = parsePhraseCsv(rawText);

  const seen = new Map();
  rows.forEach((text) => {
    const key = normalizePhraseKey(text);
    if (!seen.has(key)) seen.set(key, text);
  });
  const withinFileUnique = Array.from(seen.values());
  const withinFileDuplicates = rows.length - withinFileUnique.length;

  const cache = await ensureCommentHelperCacheLoaded(commentHelperCampaignId);
  const existingKeys = new Set(cache.items.map((p) => p.normalizedText || normalizePhraseKey(p.text)));

  commentHelperCsvPreview = {
    fileName,
    rowsFound: rows.length,
    blankSkipped: invalidCount,
    withinFileDuplicates,
    withinFileUnique,
    existingKeys,
    existingCount: cache.items.length
  };

  renderCommentHelperCsvPreviewPanel();
}

function renderCommentHelperCsvPreviewPanel() {
  const preview = commentHelperCsvPreview;
  if (!preview) return;

  const mode = currentCommentHelperCsvMode();
  const candidates = mode === "add"
    ? preview.withinFileUnique.filter((text) => !preview.existingKeys.has(normalizePhraseKey(text)))
    : preview.withinFileUnique;
  const crossDuplicates = mode === "add" ? preview.withinFileUnique.length - candidates.length : 0;

  preview.candidates = candidates;
  preview.mode = mode;

  const lines = [
    `File: ${preview.fileName}`,
    `Rows found: ${preview.rowsFound}`,
    `Valid phrases to import: ${candidates.length}`,
    `Duplicates skipped: ${preview.withinFileDuplicates + crossDuplicates}`,
    `Blank rows skipped: ${preview.blankSkipped}`
  ];
  if (mode === "replace") {
    lines.push(`⚠ This will permanently delete the existing ${preview.existingCount} phrase(s) before importing.`);
  }

  $("#comment-helper-csv-preview-summary").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  $("#comment-helper-csv-import").textContent = mode === "replace" ? "Replace Library" : "Import";
  $("#comment-helper-csv-preview-panel").hidden = false;
  $("#comment-helper-csv-progress").hidden = true;
}

async function runCommentHelperCsvImport() {
  const preview = commentHelperCsvPreview;
  if (!preview || !commentHelperCampaignId) return;

  const campaignId = commentHelperCampaignId;
  const mode = preview.mode;
  const candidates = preview.candidates || [];

  if (mode === "replace") {
    const confirmed = window.confirm(
      `Replace this campaign's Comment Helper library?\n\n` +
      `This will remove the existing ${preview.existingCount} phrase(s) and replace them with ` +
      `${candidates.length} phrase(s) from "${preview.fileName}". This can't be undone.`
    );
    if (!confirmed) return;
  }

  const importBtn = $("#comment-helper-csv-import");
  const cancelBtn = $("#comment-helper-csv-cancel");
  const progressEl = $("#comment-helper-csv-progress");
  importBtn.disabled = true;
  cancelBtn.disabled = true;
  progressEl.hidden = false;
  progressEl.textContent = "Starting…";
  setStatus($("#comment-helper-csv-status"), "", null);

  try {
    const cache = await ensureCommentHelperCacheLoaded(campaignId);

    if (mode === "replace" && cache.items.length) {
      const refs = cache.items.map((p) => doc(db, commentHelperPhrasesPath(campaignId), p.id));
      await chunkedBatchDelete(refs, (done, total) => {
        progressEl.textContent = `Deleting existing phrases: ${done} / ${total}…`;
      });
    }

    const refsAndData = candidates.map((text) => ({
      ref: doc(collection(db, commentHelperPhrasesPath(campaignId))),
      data: {
        text,
        normalizedText: normalizePhraseKey(text),
        enabled: true,
        randomKey: Math.random(),
        createdAt: serverTimestamp()
      }
    }));

    await chunkedBatchWrite(refsAndData, (done, total) => {
      progressEl.textContent = `Importing ${done} / ${total}…`;
    });

    progressEl.textContent = `Done — imported ${refsAndData.length} phrase(s).`;

    commentHelperPhraseCache[campaignId] = null;
    await ensureCommentHelperCacheLoaded(campaignId, true);
    updateCommentHelperCounts();
    updateCommentHelperMigrationBanner(campaignId);
    renderCommentHelperPhraseList();

    commentHelperCsvPreview = null;
    $("#comment-helper-csv-file").value = "";
    setStatus($("#comment-helper-csv-status"), `Imported ${refsAndData.length} phrase(s).`, "success");
  } catch (error) {
    console.error(error);
    setStatus(
      $("#comment-helper-csv-status"),
      `Import failed partway through: ${error.message || "unknown error"}. Some phrases may already have been written — check the phrase library below before retrying.`,
      "error"
    );
    commentHelperPhraseCache[campaignId] = null;
    await ensureCommentHelperCacheLoaded(campaignId, true);
    updateCommentHelperCounts();
    renderCommentHelperPhraseList();
  } finally {
    importBtn.disabled = false;
    cancelBtn.disabled = false;
    $("#comment-helper-csv-preview-panel").hidden = true;
  }
}

function initCommentHelperCsvImport() {
  $("#comment-helper-csv-preview").addEventListener("click", () => {
    const fileInput = $("#comment-helper-csv-file");
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus($("#comment-helper-csv-status"), "Choose a CSV file first.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setStatus($("#comment-helper-csv-status"), "Couldn't read that file.", "error");
    reader.onload = async () => {
      setStatus($("#comment-helper-csv-status"), "Analyzing…", "pending");
      try {
        await buildCommentHelperCsvPreview(String(reader.result), file.name);
        setStatus($("#comment-helper-csv-status"), "", null);
      } catch (error) {
        console.error(error);
        setStatus($("#comment-helper-csv-status"), `Couldn't analyze file: ${error.message || "unknown error"}`, "error");
      }
    };
    reader.readAsText(file);
  });

  document.querySelectorAll('input[name="comment-helper-csv-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (commentHelperCsvPreview) renderCommentHelperCsvPreviewPanel();
    });
  });

  $("#comment-helper-csv-cancel").addEventListener("click", () => {
    commentHelperCsvPreview = null;
    $("#comment-helper-csv-preview-panel").hidden = true;
  });

  $("#comment-helper-csv-import").addEventListener("click", runCommentHelperCsvImport);
}

/* ---- Heartbound migration — reuses the legacy style/length generator
   logic (see FALLBACK_DATA.commentHelperLegacyTemplates) to pre-bake a
   large, deduplicated, flat set of complete comments. Explicit admin
   action only; never runs automatically; refuses to overwrite an
   existing non-empty library. ---- */

function legacyPickRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function legacyPickRandomUnique(arr, n) {
  const pool = arr.slice();
  const result = [];
  for (let i = 0; i < n && pool.length; i++) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function legacyGenerateOne(helper, styleId, lengthId) {
  if (styleId === "simple") {
    const lineCounts = { short: 1, medium: 2, longer: 3 };
    const count = lineCounts[lengthId] || 1;
    const lines = legacyPickRandomUnique(helper.phrases.simple.lines, count);
    return lines.join(" ");
  }

  const pool = helper.phrases[styleId];
  if (!pool) return "";

  const sentences = [];
  if (lengthId === "medium") {
    sentences.push(legacyPickRandomItem(pool.openings));
    const secondCategory = Math.random() < 0.5 ? "observations" : "reactions";
    sentences.push(legacyPickRandomItem(pool[secondCategory]));
  } else if (lengthId === "longer") {
    sentences.push(legacyPickRandomItem(pool.openings));
    sentences.push(legacyPickRandomItem(pool.observations));
    sentences.push(legacyPickRandomItem(pool.reactions));
    sentences.push(legacyPickRandomItem(pool.endings));
  } else {
    const category = Math.random() < 0.5 ? "openings" : "reactions";
    sentences.push(legacyPickRandomItem(pool[category]));
  }
  return sentences.join(" ");
}

const COMMENT_HELPER_MIGRATION_STYLE_IDS = ["excited", "emotional", "proud", "acting", "chemistry", "story", "simple"];

// Samples (rather than exhaustively enumerates — the "longer" tier's
// combinatorial space is far larger than needed) using the exact legacy
// per-tier construction rules, deduplicating finished comments (not
// fragments) until each style/tier's target is hit or its available
// unique space runs dry. Lands the total around 1,500-2,000 comments,
// evenly split across styles.
function buildHeartboundMigrationComments() {
  const helper = FALLBACK_DATA.commentHelperLegacyTemplates;
  const seen = new Set();
  const comments = [];
  let duplicatesSkipped = 0;

  const targetsFor = (styleId) => (styleId === "simple"
    ? { short: 999, medium: 90, longer: 70 }
    : { short: 999, medium: 120, longer: 120 });
  const maxAttemptsFor = { short: 400, medium: 600, longer: 600 };

  COMMENT_HELPER_MIGRATION_STYLE_IDS.forEach((styleId) => {
    const targets = targetsFor(styleId);

    ["short", "medium", "longer"].forEach((tier) => {
      const target = targets[tier];
      const maxAttempts = maxAttemptsFor[tier];
      let added = 0;
      let attempts = 0;
      let staleStreak = 0;

      while (added < target && attempts < maxAttempts && staleStreak < 60) {
        attempts++;
        const text = legacyGenerateOne(helper, styleId, tier);
        const key = (text || "").trim().toLowerCase();
        if (!text || seen.has(key)) {
          staleStreak++;
          duplicatesSkipped++;
          continue;
        }
        staleStreak = 0;
        seen.add(key);
        comments.push(text);
        added++;
      }
    });
  });

  return { comments, duplicatesSkipped };
}

function initCommentHelperMigration() {
  $("#comment-helper-migrate-btn").addEventListener("click", () => {
    const campaignId = commentHelperCampaignId;
    if (campaignId !== "heartbound") return;

    const { comments, duplicatesSkipped } = buildHeartboundMigrationComments();

    const confirmed = window.confirm(
      "Migrate Heartbound Comment Helper\n\n" +
      "Legacy template system detected.\n\n" +
      `Complete comments prepared: ${comments.length}\n` +
      `Duplicates removed: ${duplicatesSkipped}\n\n` +
      "Destination:\ncampaigns/heartbound/commentHelperPhrases\n\n" +
      "This will not delete the old local template data.\n\n" +
      "Continue?"
    );
    if (!confirmed) return;

    withSaving($("#comment-helper-migrate-btn"), $("#comment-helper-migrate-status"), "Migrating…", async () => {
      const cache = await ensureCommentHelperCacheLoaded(campaignId, true);
      if (cache.items.length) {
        throw new Error("This campaign's Comment Helper library already has phrases — refusing to overwrite it.");
      }

      const refsAndData = comments.map((text) => ({
        ref: doc(collection(db, commentHelperPhrasesPath(campaignId))),
        data: {
          text,
          normalizedText: normalizePhraseKey(text),
          enabled: true,
          randomKey: Math.random(),
          createdAt: serverTimestamp()
        }
      }));

      await chunkedBatchWrite(refsAndData);

      commentHelperPhraseCache[campaignId] = null;
      await ensureCommentHelperCacheLoaded(campaignId, true);
      updateCommentHelperCounts();
      updateCommentHelperMigrationBanner(campaignId);
      renderCommentHelperPhraseList();
    });
  });
}

function initCommentHelperManager() {
  initCommentHelperConfigForm();
  initCommentHelperAddPhrase();
  initCommentHelperSearchAndFilter();
  initCommentHelperCsvImport();
  initCommentHelperMigration();
}

/* ==========================================================================
   TikTok Views (scalar, the "very easy to update daily" panel — still
   Heartbound-specific, see the Campaigns panel for the compatibility note)
   ========================================================================== */

async function loadTiktokViewsPanel() {
  const data = await loadDocOr("stats/tiktok", {
    currentViews: FALLBACK_DATA.tiktokCurrentViews,
    updatedAt: null
  });
  $("#tiktok-views-input").value = data.currentViews ?? FALLBACK_DATA.tiktokCurrentViews;
  $("#tiktok-views-updated").textContent = formatTimestamp(data.updatedAt);
}

function initTiktokViewsPanel() {
  $("#tiktok-views-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = $("#tiktok-views-input").value;

    if (!isNonNegativeInteger(raw)) {
      setStatus($("#tiktok-views-status"), "Enter a non-negative whole number.", "error");
      return;
    }

    withSaving($("#tiktok-views-save"), $("#tiktok-views-status"), "Saving…", async () => {
      await setDoc(doc(db, "stats/tiktok"), {
        currentViews: Number(raw),
        updatedAt: serverTimestamp()
      });
      $("#tiktok-views-updated").textContent = formatTimestamp(new Date());
    });
  });
}

/* ==========================================================================
   Site Settings (scalar)
   ========================================================================== */

async function loadSiteSettingsPanel() {
  const s = await loadDocOr("site/settings", FALLBACK_DATA.siteSettings);
  $("#setting-homepage-image").value = s.homepageCampaignImage || "";
  $("#setting-campaign-image").value = s.campaignPageImage || "";
  $("#setting-profile-image").value = s.profileImage || "";
  $("#setting-footer-url").value = s.footerAccountUrl || "";
  $("#setting-footer-desc").value = s.footerDescription || "";
}

function initSiteSettingsPanel() {
  $("#site-settings-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const footerUrl = $("#setting-footer-url").value;
    if (isNonEmptyString(footerUrl) && !isHttpUrl(footerUrl)) {
      setStatus($("#site-settings-status"), "Footer account URL must start with http:// or https://.", "error");
      return;
    }

    const data = {
      homepageCampaignImage: $("#setting-homepage-image").value.trim(),
      campaignPageImage: $("#setting-campaign-image").value.trim(),
      profileImage: $("#setting-profile-image").value.trim(),
      footerAccountUrl: footerUrl.trim(),
      footerDescription: $("#setting-footer-desc").value.trim()
    };

    withSaving($("#site-settings-save"), $("#site-settings-status"), "Saving…", async () => {
      await setDoc(doc(db, "site/settings"), data);
    });
  });
}

/* ==========================================================================
   Trending (public post generator) — per-category event config + Firestore
   subcollection phrase libraries.
   ------------------------------------------------------------------
   Unlike the public page (js/trending.js), which deliberately never fetches
   a whole phrase collection (it could grow into the hundreds/thousands and
   the public page can see real event-day traffic), the admin console IS
   allowed to load a full category's phrase list on demand — only the site
   owner uses this console, and a full fetch is what makes an accurate
   count, search, and CSV replace/add practical here.
   ========================================================================== */

const TRENDING_CATEGORIES = ["perthsanta", "perth", "santa"];
const TRENDING_PHRASE_PAGE_SIZE = 100;
// Shared with the Comment Helper phrase manager below — stays under
// Firestore's 500-op batch cap, used by the generic chunkedBatchWrite/
// chunkedBatchDelete helpers further down.
const PHRASE_BATCH_CHUNK_SIZE = 450;

let activeTrendingCategory = "perthsanta";
const trendingPhraseCache = {}; // category -> { items: [{id,text,enabled,randomKey}], loaded }
let trendingPhraseSearchTerm = "";
let trendingPhraseVisibleCount = TRENDING_PHRASE_PAGE_SIZE;

function trendingPhrasesPath(category) {
  return `trendingPhrases/${category}/phrases`;
}

function normalizePhraseKey(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadTrendingConfigForCategory(category) {
  const config = await loadDocOr(`trending/${category}`, FALLBACK_DATA.trending[category]);
  $("#trending-event-name").value = config.eventName || "";
  $("#trending-keyword").value = config.keyword || "";
  $("#trending-hashtags").value = (config.hashtags || []).join(", ");
  $("#trending-active").checked = !!config.active;
}

async function refreshTrendingPhraseCount(category) {
  const countEl = $("#trending-phrase-count");
  try {
    const snap = await getCountFromServer(collection(db, trendingPhrasesPath(category)));
    countEl.textContent = snap.data().count;
  } catch (error) {
    console.error(error);
    countEl.textContent = "—";
  }
}

function initTrendingConfigForm() {
  $("#trending-config-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const eventName = $("#trending-event-name").value.trim();
    const keyword = $("#trending-keyword").value.trim();
    const hashtags = $("#trending-hashtags")
      .value.split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const active = $("#trending-active").checked;

    withSaving($("#trending-config-save"), $("#trending-config-status"), "Saving…", async () => {
      await setDoc(doc(db, `trending/${activeTrendingCategory}`), {
        eventName,
        keyword,
        hashtags,
        active,
        updatedAt: serverTimestamp()
      });
    });
  });
}

function collapseAllTrendingSubPanels() {
  $("#trending-csv-panel").hidden = true;
  $("#trending-add-panel").hidden = true;
  $("#trending-manage-panel").hidden = true;
}

function toggleTrendingSubPanel(panelEl) {
  const willShow = panelEl.hidden;
  collapseAllTrendingSubPanels();
  panelEl.hidden = !willShow;
}

async function ensureTrendingPhraseCacheLoaded(category) {
  if (trendingPhraseCache[category] && trendingPhraseCache[category].loaded) {
    return trendingPhraseCache[category];
  }
  const snap = await getDocs(collection(db, trendingPhrasesPath(category)));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  trendingPhraseCache[category] = { items, loaded: true };
  return trendingPhraseCache[category];
}

function renderTrendingPhraseList() {
  const listEl = $("#trending-phrase-list");
  const showMoreBtn = $("#trending-phrase-show-more");
  const cache = trendingPhraseCache[activeTrendingCategory];
  listEl.innerHTML = "";

  if (!cache) return;

  const term = trendingPhraseSearchTerm.trim().toLowerCase();
  const filtered = term ? cache.items.filter((p) => (p.text || "").toLowerCase().includes(term)) : cache.items;

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No phrases found.";
    listEl.appendChild(empty);
    showMoreBtn.hidden = true;
    return;
  }

  const visible = filtered.slice(0, trendingPhraseVisibleCount);

  visible.forEach((phrase) => {
    const row = document.createElement("div");
    row.className = "admin-phrase-row";

    const textArea = document.createElement("textarea");
    textArea.rows = 2;
    textArea.value = phrase.text || "";
    row.appendChild(textArea);

    const actions = document.createElement("div");
    actions.className = "admin-phrase-row-actions";

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "admin-checkbox-label";
    const enabledCheckbox = document.createElement("input");
    enabledCheckbox.type = "checkbox";
    enabledCheckbox.checked = phrase.enabled !== false;
    enabledCheckbox.addEventListener("change", () => {
      updateDoc(doc(db, trendingPhrasesPath(activeTrendingCategory), phrase.id), {
        enabled: enabledCheckbox.checked
      })
        .then(() => {
          phrase.enabled = enabledCheckbox.checked;
        })
        .catch((error) => {
          console.error(error);
          enabledCheckbox.checked = !enabledCheckbox.checked;
          window.alert(`Couldn't update: ${error.message || "unknown error"}`);
        });
    });
    enabledLabel.append(enabledCheckbox, " Enabled");
    actions.appendChild(enabledLabel);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-secondary btn-sm";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const newText = textArea.value.trim();
      if (!newText) {
        window.alert("Phrase text can't be empty.");
        return;
      }
      saveBtn.disabled = true;
      try {
        await updateDoc(doc(db, trendingPhrasesPath(activeTrendingCategory), phrase.id), { text: newText });
        phrase.text = newText;
      } catch (error) {
        console.error(error);
        window.alert(`Couldn't save: ${error.message || "unknown error"}`);
      } finally {
        saveBtn.disabled = false;
      }
    });
    actions.appendChild(saveBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "admin-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "Delete phrase");
    deleteBtn.addEventListener("click", async () => {
      if (!confirmDelete("Delete this phrase? This can't be undone.")) return;
      try {
        await deleteDoc(doc(db, trendingPhrasesPath(activeTrendingCategory), phrase.id));
        const cache2 = trendingPhraseCache[activeTrendingCategory];
        cache2.items = cache2.items.filter((p) => p.id !== phrase.id);
        renderTrendingPhraseList();
        refreshTrendingPhraseCount(activeTrendingCategory);
      } catch (error) {
        console.error(error);
        window.alert(`Couldn't delete: ${error.message || "unknown error"}`);
      }
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });

  showMoreBtn.hidden = filtered.length <= trendingPhraseVisibleCount;
}

function initTrendingPhraseManagement() {
  $("#trending-csv-toggle").addEventListener("click", () => toggleTrendingSubPanel($("#trending-csv-panel")));
  $("#trending-add-toggle").addEventListener("click", () => toggleTrendingSubPanel($("#trending-add-panel")));

  $("#trending-manage-toggle").addEventListener("click", async () => {
    toggleTrendingSubPanel($("#trending-manage-panel"));
    if (!$("#trending-manage-panel").hidden) {
      setStatus($("#trending-manage-status"), "Loading phrases…", "pending");
      await ensureTrendingPhraseCacheLoaded(activeTrendingCategory);
      setStatus($("#trending-manage-status"), "", null);
      trendingPhraseVisibleCount = TRENDING_PHRASE_PAGE_SIZE;
      renderTrendingPhraseList();
    }
  });

  $("#trending-phrase-search").addEventListener("input", (event) => {
    trendingPhraseSearchTerm = event.target.value;
    trendingPhraseVisibleCount = TRENDING_PHRASE_PAGE_SIZE;
    renderTrendingPhraseList();
  });

  $("#trending-phrase-show-more").addEventListener("click", () => {
    trendingPhraseVisibleCount += TRENDING_PHRASE_PAGE_SIZE;
    renderTrendingPhraseList();
  });

  $("#trending-phrase-add-save").addEventListener("click", () => {
    const input = $("#trending-phrase-add-input");
    const text = input.value.trim();
    if (!text) {
      setStatus($("#trending-add-status"), "Enter phrase text first.", "error");
      return;
    }

    withSaving($("#trending-phrase-add-save"), $("#trending-add-status"), "Saving…", async () => {
      const category = activeTrendingCategory;
      const randomKey = Math.random();
      const ref = await addDoc(collection(db, trendingPhrasesPath(category)), {
        text,
        enabled: true,
        randomKey,
        createdAt: serverTimestamp()
      });
      input.value = "";
      await refreshTrendingPhraseCount(category);

      const cache = trendingPhraseCache[category];
      if (cache && cache.loaded) {
        cache.items.push({ id: ref.id, text, enabled: true, randomKey });
        if (!$("#trending-manage-panel").hidden) renderTrendingPhraseList();
      }
    });
  });
}

// Generic one-column phrase CSV parser — shared by Trending and the
// Comment Helper phrase manager. Recognizes and skips an optional leading
// "text" header line (quoted or bare, case-insensitive), strips a UTF-8
// BOM, unescapes quoted/doubled-quote fields, trims whitespace, and skips
// blank rows.
function parsePhraseCsv(rawText) {
  const text = rawText.replace(/^﻿/, "");
  const lines = text.split(/\r\n|\r|\n/);
  const rows = [];
  let invalidCount = 0;
  let sawContentRow = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let value = line;
    if (line.length >= 2 && line.startsWith('"') && line.endsWith('"')) {
      value = line.slice(1, -1).replace(/""/g, '"');
    }
    value = value.trim();

    if (!sawContentRow && value.toLowerCase() === "text") {
      sawContentRow = true; // header row — skip, not invalid
      continue;
    }
    sawContentRow = true;

    if (!value) {
      invalidCount++;
      continue;
    }
    rows.push(value);
  }

  return { rows, invalidCount };
}

// onProgress(done, total), if given, is called after each chunk commits —
// existing callers that don't pass it (Trending) are unaffected.
async function chunkedBatchWrite(refsAndData, onProgress) {
  for (let i = 0; i < refsAndData.length; i += PHRASE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = refsAndData.slice(i, i + PHRASE_BATCH_CHUNK_SIZE);
    chunk.forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
    if (onProgress) onProgress(Math.min(i + chunk.length, refsAndData.length), refsAndData.length);
  }
}

async function chunkedBatchDelete(refs, onProgress) {
  for (let i = 0; i < refs.length; i += PHRASE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = refs.slice(i, i + PHRASE_BATCH_CHUNK_SIZE);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    if (onProgress) onProgress(Math.min(i + chunk.length, refs.length), refs.length);
  }
}

function initTrendingCsvImport() {
  $("#trending-csv-import").addEventListener("click", () => {
    const fileInput = $("#trending-csv-file");
    const file = fileInput.files && fileInput.files[0];
    const modeInput = document.querySelector('input[name="trending-csv-mode"]:checked');
    const mode = modeInput ? modeInput.value : "add";

    if (!file) {
      setStatus($("#trending-csv-status"), "Choose a CSV file first.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setStatus($("#trending-csv-status"), "Couldn't read that file.", "error");
    };
    reader.onload = async () => {
      const importBtn = $("#trending-csv-import");
      const category = activeTrendingCategory;
      importBtn.disabled = true;
      setStatus($("#trending-csv-status"), "Importing…", "pending");

      try {
        const { rows, invalidCount } = parsePhraseCsv(String(reader.result));

        // Dedupe within the CSV batch itself (case/whitespace-insensitive).
        const seen = new Map();
        rows.forEach((rowText) => {
          const key = normalizePhraseKey(rowText);
          if (!seen.has(key)) seen.set(key, rowText);
        });
        let candidates = Array.from(seen.values());
        let duplicateCount = rows.length - candidates.length;

        if (mode === "replace") {
          const cache = await ensureTrendingPhraseCacheLoaded(category);
          const existingCount = cache.items.length;
          const confirmed = window.confirm(
            `Replace the entire ${TRENDING_CATEGORY_LABELS[category]} phrase library? This will ` +
              `permanently delete ${existingCount} existing phrase(s) and cannot be undone.`
          );
          if (!confirmed) {
            setStatus($("#trending-csv-status"), "Import cancelled.", null);
            return;
          }
          await chunkedBatchDelete(cache.items.map((p) => doc(db, trendingPhrasesPath(category), p.id)));
        } else {
          const cache = await ensureTrendingPhraseCacheLoaded(category);
          const existingKeys = new Set(cache.items.map((p) => normalizePhraseKey(p.text)));
          const before = candidates.length;
          candidates = candidates.filter((rowText) => !existingKeys.has(normalizePhraseKey(rowText)));
          duplicateCount += before - candidates.length;
        }

        const refsAndData = candidates.map((rowText) => ({
          ref: doc(collection(db, trendingPhrasesPath(category))),
          data: { text: rowText, enabled: true, randomKey: Math.random(), createdAt: serverTimestamp() }
        }));

        await chunkedBatchWrite(refsAndData);

        // Re-fetch fresh from Firestore so the cache matches server truth
        // after a bulk write, rather than hand-patching hundreds of items.
        trendingPhraseCache[category] = null;
        await ensureTrendingPhraseCacheLoaded(category);
        if (!$("#trending-manage-panel").hidden) renderTrendingPhraseList();
        await refreshTrendingPhraseCount(category);

        fileInput.value = "";
        setStatus(
          $("#trending-csv-status"),
          `Imported: ${refsAndData.length} / Duplicates skipped: ${duplicateCount} / Invalid rows skipped: ${invalidCount}`,
          "success"
        );
      } catch (error) {
        console.error(error);
        setStatus($("#trending-csv-status"), `Couldn't import: ${error.message || "unknown error"}`, "error");
      } finally {
        importBtn.disabled = false;
      }
    };
    reader.readAsText(file);
  });
}

function initTrendingCategoryTabs() {
  document.querySelectorAll("#trending-category-tabs .admin-subtab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll("#trending-category-tabs .admin-subtab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");

      activeTrendingCategory = tab.getAttribute("data-trending-cat");
      trendingPhraseSearchTerm = "";
      trendingPhraseVisibleCount = TRENDING_PHRASE_PAGE_SIZE;
      $("#trending-phrase-search").value = "";
      $("#trending-phrase-add-input").value = "";
      $("#trending-csv-file").value = "";
      collapseAllTrendingSubPanels();
      [
        "trending-config-status",
        "trending-csv-status",
        "trending-add-status",
        "trending-manage-status"
      ].forEach((id) => setStatus($(`#${id}`), "", null));

      await loadTrendingConfigForCategory(activeTrendingCategory);
      await refreshTrendingPhraseCount(activeTrendingCategory);
    });
  });
}

function initTrendingPanel() {
  initTrendingCategoryTabs();
  initTrendingConfigForm();
  initTrendingPhraseManagement();
  initTrendingCsvImport();
}

async function loadTrendingPanel() {
  await loadTrendingConfigForCategory(activeTrendingCategory);
  await refreshTrendingPhraseCount(activeTrendingCategory);
}

/* ==========================================================================
   Dashboard summary cards
   ========================================================================== */

const TRENDING_CATEGORY_LABELS = { perthsanta: "PerthSanta", perth: "Perth", santa: "Santa" };

async function loadDashboard() {
  const [liveCampaignDocs, tiktokStats, announcements, music, faq, trendingPerthsanta, trendingPerth, trendingSanta] = await Promise.all([
    getLiveCampaignDocs(),
    loadDocOr("stats/tiktok", { currentViews: FALLBACK_DATA.tiktokCurrentViews, updatedAt: null }),
    loadDocOr("content/announcements", { items: FALLBACK_DATA.announcements }),
    loadDocOr("content/music", FALLBACK_DATA.music),
    loadDocOr("content/faq", { items: FALLBACK_DATA.faq }),
    loadDocOr("trending/perthsanta", FALLBACK_DATA.trending.perthsanta),
    loadDocOr("trending/perth", FALLBACK_DATA.trending.perth),
    loadDocOr("trending/santa", FALLBACK_DATA.trending.santa)
  ]);

  const liveById = new Map(liveCampaignDocs.map((d) => [d.id, d]));
  const campaigns = FALLBACK_DATA.campaigns.map((f) => ({ ...f, ...(liveById.get(f.id) || {}) }));
  liveById.forEach((docData, id) => {
    if (!campaigns.some((c) => c.id === id)) campaigns.push({ ...docData, id });
  });

  const currentCount = campaigns.filter((c) => c.status === "current").length;
  const upcomingCount = campaigns.filter((c) => c.status === "upcoming").length;
  const previousCount = campaigns.filter((c) => c.status === "previous").length;
  const featuredCampaigns = campaigns.filter((c) => c.isFeatured);
  const featuredLine = featuredCampaigns.length === 1
    ? `Featured: ${featuredCampaigns[0].title || featuredCampaigns[0].id}`
    : featuredCampaigns.length === 0
      ? "Featured: none set"
      : `⚠ Featured: ${featuredCampaigns.length} campaigns marked — should be 1, check Campaign Manager`;

  const musicCount = MUSIC_CATEGORIES.reduce((sum, cat) => sum + (music[cat] ? music[cat].length : 0), 0);

  const trendingByCategory = { perthsanta: trendingPerthsanta, perth: trendingPerth, santa: trendingSanta };
  const trendingLines = TRENDING_CATEGORIES.map((cat) => {
    const t = trendingByCategory[cat];
    return `${TRENDING_CATEGORY_LABELS[cat]}: ${t && t.active ? (t.eventName || "Active") : "No event"}`;
  });

  const cards = [
    {
      title: "Campaigns",
      lines: [`${currentCount} current · ${upcomingCount} upcoming · ${previousCount} previous`, featuredLine],
      button: "Manage Campaigns",
      panel: "campaigns"
    },
    {
      title: "TikTok Views",
      lines: [
        `Current: ${Number(tiktokStats.currentViews || 0).toLocaleString()}`,
        `Last updated: ${formatTimestamp(tiktokStats.updatedAt)}`
      ],
      button: "Update Views",
      panel: "tiktok-views"
    },
    {
      title: "Announcements",
      lines: [`${(announcements.items || []).length} announcement(s)`],
      button: "Manage Announcements",
      panel: "announcements"
    },
    {
      title: "Music",
      lines: [`${musicCount} song(s)`],
      button: "Manage Music",
      panel: "music"
    },
    {
      title: "FAQ",
      lines: [`${(faq.items || []).length} question(s)`],
      button: "Manage FAQ",
      panel: "faq"
    },
    {
      title: "Trending",
      lines: trendingLines,
      button: "Manage Trending",
      panel: "trending"
    }
  ];

  const grid = $("#dashboard-cards");
  grid.innerHTML = "";
  cards.forEach((card) => {
    const el = document.createElement("div");
    el.className = "admin-summary-card";
    el.innerHTML = `
      <h3>${card.title}</h3>
      ${card.lines.map((line) => `<p>${line}</p>`).join("")}
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-sm";
    btn.textContent = card.button;
    btn.addEventListener("click", () => showPanel(card.panel));
    el.appendChild(btn);
    grid.appendChild(el);
  });
}

/* ==========================================================================
   Auth
   ========================================================================== */

async function loadAllPanels() {
  await Promise.all([
    loadDashboard(),
    loadCampaignsPanel(),
    loadMissionsPanel(),
    loadTiktokViewsPanel(),
    youtubeGoalsPanel.load(),
    tiktokGoalsPanel.load(),
    announcementsPanel.load(),
    faqPanel.load(),
    loadMusicPanel(),
    loadSiteSettingsPanel(),
    loadTrendingPanel()
  ]);
}

function showLoggedIn(user) {
  $("#admin-loading").hidden = true;
  $("#admin-login").hidden = true;
  $("#admin-dashboard").hidden = false;
  $("#admin-user-email").textContent = user.email || "";
  loadAllPanels();
}

function showLoggedOut() {
  $("#admin-loading").hidden = true;
  $("#admin-dashboard").hidden = true;
  $("#admin-login").hidden = false;
}

function initAuth() {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Could not set auth persistence.", error);
  });

  onAuthStateChanged(auth, (user) => {
    if (user && user.uid === ADMIN_UID) {
      showLoggedIn(user);
    } else if (user) {
      // Signed in, but not the admin account — never show the dashboard.
      setStatus($("#login-status"), "Unauthorized account.", "error");
      signOut(auth);
      showLoggedOut();
    } else {
      showLoggedOut();
    }
  });

  $("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const submitBtn = $("#login-submit");

    if (!email || !password) {
      setStatus($("#login-status"), "Enter both email and password.", "error");
      return;
    }

    submitBtn.disabled = true;
    setStatus($("#login-status"), "Signing in…", "pending");

    signInWithEmailAndPassword(auth, email, password)
      .then(() => {
        setStatus($("#login-status"), "", null);
      })
      .catch((error) => {
        // Logged for local debugging only — this never includes the
        // password, just Firebase's own error code/message (e.g.
        // "auth/invalid-credential", "auth/unauthorized-domain",
        // "auth/network-request-failed"). Check this in DevTools if the
        // user-facing message below isn't enough to diagnose a failure.
        console.error(error.code, error.message);
        setStatus($("#login-status"), "Invalid email or password.", "error");
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });

  $("#logout-btn").addEventListener("click", () => {
    signOut(auth);
  });
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */

initNav();
initCampaignsPanel();
initMissionsPanel();
initCosmeticsPanel();
initCommentHelperManager();
initTiktokViewsPanel();
initMusicPanel();
initSiteSettingsPanel();
initTrendingPanel();
initAuth();
