/*
  TEMPORARY — Trending page runtime debug overlay.
  ------------------------------------------------------------------
  Does nothing unless the URL contains ?debug-trending=1. Then it shows a
  small panel with the generator's live state so a visitor who can't see
  the generator can copy the exact details and send them over.

  Shows only public, non-sensitive state (no auth/user data). It's a
  classic (non-module) script on purpose, so it still works when
  js/trending.js itself failed to load.

  To remove: delete this file and its <script> tag in trending.html.
*/
(function () {
  "use strict";

  if (!/[?&]debug-trending=1(?:&|$)/.test(window.location.search)) return;

  function activeCategory() {
    var tab = document.querySelector("[data-trending-tab].is-active");
    return tab ? tab.getAttribute("data-trending-tab") : "(none)";
  }

  function collect() {
    var state = window.__trendingState || null;
    var category = activeCategory();
    var panel = document.querySelector('[data-trending-panel="' + category + '"]');
    var gen = panel ? panel.querySelector("[data-trending-generator]") : null;
    var cs = gen ? window.getComputedStyle(gen) : null;

    var visibleMsg = "(none)";
    if (panel) {
      ["loading", "inactive", "unavailable"].forEach(function (k) {
        var el = panel.querySelector("[data-trending-" + k + "]");
        if (el && !el.hidden) visibleMsg = k;
      });
    }

    var config = state && state.configs ? state.configs[category] : null;
    var phrases = state && state.phrasesLoaded ? state.phrasesLoaded[category] : undefined;

    return [
      "trending.js loaded: " + (state ? "yes" : "no"),
      "generator container found: " + (gen ? "yes" : "no"),
      "generator hidden: " + (gen ? String(gen.hidden) : "n/a"),
      "computed display: " + (cs ? cs.display : "n/a"),
      "computed visibility: " + (cs ? cs.visibility : "n/a"),
      "computed opacity: " + (cs ? cs.opacity : "n/a"),
      "panel message shown: " + visibleMsg,
      "active category: " + category,
      "config: " + (config ? "active=" + config.active + " source=" + config.source : "not loaded"),
      "phrases loaded: " + (phrases === undefined ? "not loaded" : phrases),
      "Firestore status: " + (state ? state.firestore : "n/a"),
      "last error: " + (state && state.lastError ? state.lastError : "(none)"),
      "viewport width: " + window.innerWidth + " (dpr " + (window.devicePixelRatio || 1) + ")",
      "online: " + (navigator.onLine === false ? "no" : "yes"),
      "user agent: " + navigator.userAgent,
      "time: " + new Date().toISOString()
    ].join("\n");
  }

  function build() {
    var box = document.createElement("div");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Trending debug info");
    box.style.cssText =
      "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;max-width:560px;" +
      "margin:0 auto;background:#111;color:#eee;border:1px solid #555;border-radius:8px;" +
      "padding:10px;font:12px/1.4 monospace;box-shadow:0 4px 16px rgba(0,0,0,.5)";

    var pre = document.createElement("pre");
    pre.style.cssText = "margin:0 0 8px;white-space:pre-wrap;word-break:break-word;max-height:45vh;overflow:auto";

    var copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy debug info";
    copy.style.cssText = "padding:6px 12px;font:inherit;cursor:pointer";
    copy.addEventListener("click", function () {
      var text = collect();
      function done() {
        copy.textContent = "Copied!";
        setTimeout(function () { copy.textContent = "Copy debug info"; }, 1500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectFallback(pre); });
      } else {
        selectFallback(pre);
      }
    });

    box.appendChild(pre);
    box.appendChild(copy);
    document.body.appendChild(box);

    function refresh() { pre.textContent = collect(); }
    refresh();
    setInterval(refresh, 1000);
  }

  // Clipboard API unavailable (some in-app browsers): select the text so
  // the visitor can copy it manually.
  function selectFallback(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
