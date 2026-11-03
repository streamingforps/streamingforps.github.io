/*
  PerthSanta Streaming — shared URL normalization for mission tracking.
  ------------------------------------------------------------------
  Used by:
    - js/mission-tracking.js (site-wide click delegation: does a clicked
      link's href match an active mission's destinationUrl?)
    - js/admin.js (Mission Manager: does a new/edited mission's
      destinationUrl collide with another active mission's destination?)

  Deliberately conservative: two URLs only count as equivalent when we
  can confidently say they point at the same content. For YouTube, the
  video ID is the only thing that's authoritative — www vs bare domain,
  youtu.be vs youtube.com/watch, and /shorts//embed/live variants of the
  SAME id should match, but two different ids must never collapse
  together. Everything else gets a generic, non-destructive normalization
  (case/whitespace/trailing-slash/known-tracking-params only) rather than
  broader equivalence heuristics that could silently merge two different
  destinations.
*/

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "igshid"
]);

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);

function stripWww(hostname) {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

// Returns the video ID for every YouTube URL shape this site actually
// uses (watch/shorts/embed/live/youtu.be), or null if this particular
// YouTube URL doesn't carry one (channel/playlist/home pages, etc.) —
// those fall through to generic normalization below instead of being
// guessed at.
function extractYoutubeVideoId(url, hostname) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (hostname === "youtu.be") return segments[0] || null;
  if (url.pathname === "/watch") return url.searchParams.get("v") || null;
  if (["shorts", "embed", "live"].includes(segments[0])) return segments[1] || null;
  return null;
}

/*
  normalizeTrackableUrl(rawUrl) -> string | null
  ------------------------------------------------------------------
  Returns a canonical string key for equality comparison (NOT a URL you
  could navigate to), or null if rawUrl isn't a parseable absolute URL.
  Never throws.
*/
function normalizeTrackableUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = stripWww(url.hostname.toLowerCase());

  if (YOUTUBE_HOSTS.has(hostname)) {
    const videoId = extractYoutubeVideoId(url, hostname);
    if (videoId) return `youtube:${videoId}`;
    // Other YouTube URL shapes (channel/playlist pages, etc.) fall
    // through to generic normalization rather than being guessed at.
  }

  const protocol = url.protocol.toLowerCase();
  const pathname = url.pathname.length > 1 && url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;

  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";

  return `${protocol}//${hostname}${pathname}${query}`;
}

export { normalizeTrackableUrl };
