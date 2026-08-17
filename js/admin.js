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

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
const fallbackCampaign = hasSiteData ? siteData.currentCampaign : {};

const FALLBACK_DATA = {
  campaign: {
    title: fallbackCampaign.title || "",
    subtitle: fallbackCampaign.subtitle || "",
    description: fallbackCampaign.description || "",
    heroMessage: fallbackCampaign.heroMessage || "",
    status: fallbackCampaign.status || "active",
    primaryLink: fallbackCampaign.primaryLink || { label: "", url: "" },
    tiktokLink: fallbackCampaign.tiktokLink || { label: "", url: "" }
  },
  tiktokCurrentViews: fallbackCampaign.tiktokCurrentViews || 0,
  youtubeGoals: (fallbackCampaign.goals || []).map((g) => ({ label: g.label, target: g.target })),
  tiktokGoals: (fallbackCampaign.tiktokGoals || []).map((g) => ({ label: g.label, target: g.target })),
  announcements: hasSiteData ? siteData.announcements || [] : [],
  missions: fallbackCampaign.missions || [],
  quickLinks: fallbackCampaign.quickLinks || [],
  platforms: fallbackCampaign.platforms || [],
  faq: hasSiteData ? siteData.faq || [] : [],
  music: hasSiteData ? siteData.music || { osts: [], perthsanta: [], perthSolo: [], jasper: [] } : { osts: [], perthsanta: [], perthSolo: [], jasper: [] },
  commentHelper: hasSiteData ? siteData.commentHelper || { styles: [], lengths: [], phrases: {} } : { styles: [], lengths: [], phrases: {} },
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
          } else {
            control = document.createElement("input");
            control.type = field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
            if (field.type === "number") {
              control.min = "0";
              control.step = "1";
            }
          }

          if (field.placeholder) control.placeholder = field.placeholder;
          control.value = item[field.key] === null || item[field.key] === undefined ? "" : item[field.key];

          control.addEventListener("input", () => {
            item[field.key] = control.value;
          });

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
    { key: "category", label: "Category", type: "select", options: ANNOUNCEMENT_CATEGORIES, required: true },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "message", label: "Message", type: "textarea", required: true },
    { key: "url", label: "URL (optional)", type: "url" },
    { key: "ctaLabel", label: "CTA label (optional)", type: "text" }
  ],
  newItem: () => ({ date: "", category: "General", title: "", message: "", url: null, ctaLabel: null }),
  buildSaveData: (items) => ({
    items: items.map((a) => ({
      date: a.date.trim(),
      category: a.category,
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
   Quick Links
   ========================================================================== */

const quickLinksPanel = createArrayPanel({
  listEl: $("#quicklinks-list"),
  addBtn: $("#quicklink-add"),
  saveBtn: $("#quicklinks-save"),
  statusEl: $("#quicklinks-status"),
  docPath: "content/quickLinks",
  fallback: FALLBACK_DATA.quickLinks,
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "label", label: "Label", type: "text", required: true },
    { key: "icon", label: "Icon / glyph", type: "text", required: true, placeholder: "▶" },
    { key: "url", label: "URL", type: "url", required: true }
  ],
  newItem: () => ({ label: "", icon: "▶", url: "" }),
  buildSaveData: (items) => ({
    items: items.map((l) => ({ label: l.label.trim(), icon: l.icon.trim(), url: l.url.trim() }))
  })
});

/* ==========================================================================
   Official Accounts / Platforms
   ========================================================================== */

const platformsPanel = createArrayPanel({
  listEl: $("#platforms-list"),
  addBtn: $("#platform-add"),
  saveBtn: $("#platforms-save"),
  statusEl: $("#platforms-status"),
  docPath: "content/platforms",
  fallback: FALLBACK_DATA.platforms,
  itemType: "object",
  twoColumn: true,
  fields: [
    { key: "id", label: "ID (unique slug, e.g. x)", type: "text", required: true },
    { key: "name", label: "Platform name", type: "text", required: true },
    { key: "actionsText", label: "Action labels (comma-separated)", type: "text", placeholder: "Like, Repost, Reply, Share" },
    { key: "cta", label: "CTA text", type: "text", required: true },
    { key: "url", label: "URL", type: "url", required: true }
  ],
  newItem: () => ({ id: "", name: "", actionsText: "", cta: "", url: "" }),
  buildSaveData: (items) => ({
    items: items.map((p) => ({
      id: p.id.trim(),
      name: p.name.trim(),
      actions: (p.actionsText || "").split(",").map((a) => a.trim()).filter(Boolean),
      cta: p.cta.trim(),
      url: p.url.trim()
    }))
  }),
  extractItems: (data) => (data.items || FALLBACK_DATA.platforms).map((p) => ({
    id: p.id,
    name: p.name,
    actionsText: (p.actions || []).join(", "),
    cta: p.cta,
    url: p.url
  }))
});

/* ==========================================================================
   Today's Support Mission
   ========================================================================== */

const missionsPanel = createArrayPanel({
  listEl: $("#missions-list"),
  addBtn: $("#mission-add"),
  saveBtn: $("#missions-save"),
  statusEl: $("#missions-status"),
  docPath: "content/missions",
  fallback: FALLBACK_DATA.missions,
  itemType: "string",
  newItem: () => "",
  buildSaveData: (items) => ({ items: items.map((m) => m.trim()) })
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
   Comment Helper (style -> phrase pool -> list of phrase strings)
   ========================================================================== */

let commentHelperData = clone(FALLBACK_DATA.commentHelper);
let activeCommentStyle = null;
let activeCommentPool = null;

const commentPhrasesPanel = createArrayPanel({
  listEl: $("#comment-phrases-list"),
  addBtn: $("#comment-phrase-add"),
  saveBtn: null,
  statusEl: $("#comment-helper-status"),
  docPath: "content/commentHelper",
  fallback: [],
  itemType: "string",
  newItem: () => ""
});

function poolsForStyle(styleId) {
  return styleId === "simple" ? ["lines"] : ["openings", "observations", "reactions", "endings"];
}

function renderCommentStyleTabs() {
  const wrap = $("#comment-style-tabs");
  wrap.innerHTML = "";
  (commentHelperData.styles || []).forEach((style) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `admin-subtab${style.id === activeCommentStyle ? " is-active" : ""}`;
    btn.textContent = style.label;
    btn.addEventListener("click", () => {
      persistActivePool();
      activeCommentStyle = style.id;
      activeCommentPool = poolsForStyle(style.id)[0];
      renderCommentStyleTabs();
      renderCommentPoolTabs();
      renderCommentPool();
    });
    wrap.appendChild(btn);
  });
}

function renderCommentPoolTabs() {
  const wrap = $("#comment-pool-tabs");
  wrap.innerHTML = "";
  if (!activeCommentStyle) return;

  poolsForStyle(activeCommentStyle).forEach((poolKey) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `admin-subtab${poolKey === activeCommentPool ? " is-active" : ""}`;
    btn.textContent = poolKey;
    btn.addEventListener("click", () => {
      persistActivePool();
      activeCommentPool = poolKey;
      renderCommentPoolTabs();
      renderCommentPool();
    });
    wrap.appendChild(btn);
  });
}

function persistActivePool() {
  if (!activeCommentStyle || !activeCommentPool) return;
  const pool = commentPhrasesPanel.getItems().slice();
  if (!commentHelperData.phrases[activeCommentStyle]) commentHelperData.phrases[activeCommentStyle] = {};
  commentHelperData.phrases[activeCommentStyle][activeCommentPool] = pool;
}

function renderCommentPool() {
  if (!activeCommentStyle || !activeCommentPool) {
    commentPhrasesPanel.setItems([]);
    return;
  }
  const stylePhrases = commentHelperData.phrases[activeCommentStyle] || {};
  commentPhrasesPanel.setItems(clone(stylePhrases[activeCommentPool] || []));
}

function initCommentHelperPanel() {
  $("#comment-helper-save").addEventListener("click", () => {
    persistActivePool();

    for (const style of commentHelperData.styles || []) {
      const pools = commentHelperData.phrases[style.id] || {};
      for (const poolKey of poolsForStyle(style.id)) {
        const lines = pools[poolKey] || [];
        if (lines.some((line) => !isNonEmptyString(line))) {
          setStatus($("#comment-helper-status"), `Empty phrase found in "${style.label} → ${poolKey}" — fill it in or remove it.`, "error");
          return;
        }
      }
    }

    withSaving($("#comment-helper-save"), $("#comment-helper-status"), "Saving…", async () => {
      await setDoc(doc(db, "content/commentHelper"), commentHelperData);
    });
  });
}

async function loadCommentHelperPanel() {
  commentHelperData = await loadDocOr("content/commentHelper", FALLBACK_DATA.commentHelper);
  if (!commentHelperData.phrases) commentHelperData.phrases = {};
  if (!Array.isArray(commentHelperData.styles) || !commentHelperData.styles.length) {
    setStatus($("#comment-helper-status"), "No comment helper data found yet in Firestore or data.js.", "error");
    return;
  }
  activeCommentStyle = commentHelperData.styles[0].id;
  activeCommentPool = poolsForStyle(activeCommentStyle)[0];
  renderCommentStyleTabs();
  renderCommentPoolTabs();
  renderCommentPool();
}

/* ==========================================================================
   Current Campaign (scalar form)
   ========================================================================== */

async function loadCampaignPanel() {
  const c = await loadDocOr("campaign/current", FALLBACK_DATA.campaign);
  $("#campaign-title").value = c.title || "";
  $("#campaign-subtitle").value = c.subtitle || "";
  $("#campaign-description").value = c.description || "";
  $("#campaign-hero-message").value = c.heroMessage || "";
  $("#campaign-status").value = c.status || "active";
  $("#campaign-youtube-label").value = (c.primaryLink && c.primaryLink.label) || "";
  $("#campaign-youtube-url").value = (c.primaryLink && c.primaryLink.url) || "";
  $("#campaign-tiktok-label").value = (c.tiktokLink && c.tiktokLink.label) || "";
  $("#campaign-tiktok-url").value = (c.tiktokLink && c.tiktokLink.url) || "";
}

function initCampaignPanel() {
  $("#campaign-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const title = $("#campaign-title").value;
    const subtitle = $("#campaign-subtitle").value;
    const youtubeUrl = $("#campaign-youtube-url").value;
    const tiktokUrl = $("#campaign-tiktok-url").value;

    if (!isNonEmptyString(title) || !isNonEmptyString(subtitle)) {
      setStatus($("#campaign-status-msg"), "Title and subtitle are required.", "error");
      return;
    }
    if (isNonEmptyString(youtubeUrl) && !isHttpUrl(youtubeUrl)) {
      setStatus($("#campaign-status-msg"), "YouTube trailer URL must start with http:// or https://.", "error");
      return;
    }
    if (isNonEmptyString(tiktokUrl) && !isHttpUrl(tiktokUrl)) {
      setStatus($("#campaign-status-msg"), "TikTok trailer URL must start with http:// or https://.", "error");
      return;
    }

    const data = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      description: $("#campaign-description").value.trim(),
      heroMessage: $("#campaign-hero-message").value.trim(),
      status: $("#campaign-status").value,
      primaryLink: {
        label: $("#campaign-youtube-label").value.trim(),
        url: youtubeUrl.trim()
      },
      tiktokLink: {
        label: $("#campaign-tiktok-label").value.trim(),
        url: tiktokUrl.trim()
      }
    };

    withSaving($("#campaign-save"), $("#campaign-status-msg"), "Saving…", async () => {
      await setDoc(doc(db, "campaign/current"), data);
    });
  });
}

/* ==========================================================================
   TikTok Views (scalar, the "very easy to update daily" panel)
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
   Dashboard summary cards
   ========================================================================== */

async function loadDashboard() {
  const [campaign, tiktokStats, announcements, music, faq] = await Promise.all([
    loadDocOr("campaign/current", FALLBACK_DATA.campaign),
    loadDocOr("stats/tiktok", { currentViews: FALLBACK_DATA.tiktokCurrentViews, updatedAt: null }),
    loadDocOr("content/announcements", { items: FALLBACK_DATA.announcements }),
    loadDocOr("content/music", FALLBACK_DATA.music),
    loadDocOr("content/faq", { items: FALLBACK_DATA.faq })
  ]);

  const musicCount = MUSIC_CATEGORIES.reduce((sum, cat) => sum + (music[cat] ? music[cat].length : 0), 0);

  const cards = [
    {
      title: "Current Campaign",
      lines: [`Title: ${campaign.title || "—"}`, `Status: ${campaign.status || "—"}`],
      button: "Edit Campaign",
      panel: "campaign"
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
    loadCampaignPanel(),
    loadTiktokViewsPanel(),
    youtubeGoalsPanel.load(),
    tiktokGoalsPanel.load(),
    announcementsPanel.load(),
    faqPanel.load(),
    quickLinksPanel.load(),
    platformsPanel.load(),
    missionsPanel.load(),
    loadMusicPanel(),
    loadCommentHelperPanel(),
    loadSiteSettingsPanel()
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
initCampaignPanel();
initTiktokViewsPanel();
initMusicPanel();
initCommentHelperPanel();
initSiteSettingsPanel();
initAuth();
