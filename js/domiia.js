/*
  PerthSanta Streaming — reusable Domiia currency display.
  ------------------------------------------------------------------
  One shared renderer so every surface (header, profile, and later
  mission rewards / achievements / leaderboard rank rows) shows the
  exact same "[icon] amount" markup and styling — never "125 Domiias"
  as plain text, never a different icon or layout per page.

  Dependency-free on purpose (no Firebase imports) — it only knows how
  to render a number someone else already fetched. js/auth.js owns the
  actual users/{uid} data (see its onSnapshot-based profile sync).

  ASSET: assets/images/domiia-token.png — a real 600x600 transparent-
  background character illustration, confirmed present in the repo. It's
  a full-body portrait with a lot of padding around the character (the
  actual artwork only fills ~49% of the canvas width / ~79% of its
  height), which reads as a near-invisible speck at 18-32px if displayed
  plain. .domiia-icon-frame below crops that down to a centered,
  zoomed-in "bust" view (clips to roughly the head/shoulders) via a
  fixed-size overflow:hidden frame + a scaled-up <img> inside it — this
  was visually verified in a browser at 18/22/32px before landing on
  scale(1.85) as the value that reads clearly as a face at icon sizes
  without cropping into the face itself. If domiia-token.png is ever
  swapped for a different asset, re-check that this crop still frames it
  sensibly (or adjust/remove the scale in CSS).

  If the file is ever missing/fails to load for some other reason (wrong
  path, deleted, etc.), every icon quietly falls back to an inline
  placeholder glyph via the <img onerror> handler below, so the UI shows
  a neutral round token instead of a broken-image icon rather than
  breaking visibly.
  ========================================================================== */

const DOMIIA_ICON_PATH = "assets/images/domiia-token.png";

// Same convention as js/auth.js's basePrefix() — derives how deep the
// current page is nested (e.g. "../" for guides/*.html) from the
// page's own .site-logo link, rather than hardcoding site structure.
function basePrefix() {
  const logo = document.querySelector(".site-logo");
  const href = (logo && logo.getAttribute("href")) || "index.html";
  return href.endsWith("index.html") ? href.slice(0, -"index.html".length) : "";
}

// Neutral placeholder token (red circle, "D") — only ever shown if
// domiia-token.png is missing/fails to load.
const FALLBACK_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="11" fill="#e10600" stroke="#ff2d2d" stroke-width="1.5"/>' +
  '<text x="12" y="16.5" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle">D</text>' +
  "</svg>"
);

const numberFormatter = new Intl.NumberFormat("en-US");

function formatDomiiaValue(amount) {
  return typeof amount === "number" ? numberFormatter.format(amount) : "—";
}

/*
  renderDomiiaAmount(amount, options) -> HTMLElement
  ------------------------------------------------------------------
  amount: a number, or null/undefined to render a loading placeholder
          ("—") instead of a zero that would falsely read as "no balance".
  options.size: "small" | "medium" | "large" (default "medium") — see
                the .domiia-amount--* CSS variants.

  The whole thing carries role="img" + a single aria-label ("125
  Domiias") so screen readers announce it once, as one unit — the icon
  itself is alt="" (decorative) and the visible number is already
  covered by that label, per the accessibility note in the spec this
  was built against.
*/
function renderDomiiaAmount(amount, options = {}) {
  const size = options.size || "medium";

  const wrap = document.createElement("span");
  wrap.className = `domiia-amount domiia-amount--${size}`;
  wrap.setAttribute("role", "img");

  // The frame is the fixed-size, clipped viewport (sized by the
  // .domiia-amount--* CSS variant); the <img> inside is intentionally
  // larger than its frame (scaled via CSS) to crop into the character —
  // see the file header comment above for why.
  const frame = document.createElement("span");
  frame.className = "domiia-icon-frame";

  const icon = document.createElement("img");
  icon.className = "domiia-icon";
  icon.src = `${basePrefix()}${DOMIIA_ICON_PATH}`;
  icon.alt = "";
  icon.loading = "lazy";
  icon.addEventListener("error", () => {
    icon.src = FALLBACK_ICON;
    // The fallback glyph is already a tight, full-bleed design — the
    // zoom crop meant for the real artwork would just clip its edges.
    icon.classList.add("is-fallback");
  }, { once: true });

  frame.appendChild(icon);

  const value = document.createElement("span");
  value.className = "domiia-value";

  wrap.append(frame, value);
  updateDomiiaAmount(wrap, amount);
  return wrap;
}

// Updates an already-rendered renderDomiiaAmount() element in place —
// used by anything that re-renders on live data changes (the header
// re-renders on every profile snapshot) so it isn't rebuilding/
// reinserting DOM nodes on every update.
function updateDomiiaAmount(el, amount) {
  if (!el) return;
  const displayValue = formatDomiiaValue(amount);
  const valueEl = el.querySelector(".domiia-value");
  if (valueEl) valueEl.textContent = displayValue;
  wrapAriaLabel(el, amount, displayValue);
}

function wrapAriaLabel(el, amount, displayValue) {
  el.setAttribute(
    "aria-label",
    typeof amount === "number" ? `${displayValue} Domiias` : "Domiia balance loading"
  );
}

export { renderDomiiaAmount, updateDomiiaAmount };

window.PSDomiia = { renderDomiiaAmount, updateDomiiaAmount };
