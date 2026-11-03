/*
  PerthSanta Streaming — Bangkok date/week/month helpers (Step 8, client
  side).
  ------------------------------------------------------------------
  This intentionally DUPLICATES functions/dateUtil.js's key-generation
  logic rather than importing it — a Cloud Function (Node, Admin SDK)
  can't be imported into a browser ES module, the same unavoidable
  duplication this codebase already accepts for ADMIN_UID (see
  js/firebase-config.js vs functions/config.js vs firestore.rules). Both
  copies must stay in sync if the algorithm ever changes.

  The client NEVER uses these keys to decide what a user is AWARDED —
  that's exclusively server-derived (functions/dateUtil.js, called from
  inside trusted Cloud Function transactions). This copy exists only so
  leaderboard.html can know which weekKey/monthKey document to QUERY
  (leaderboardWeekly/leaderboardMonthly are public-read, so the client
  legitimately needs to compute "today, which period am I looking at?")
  and how to LABEL that period for display ("This Week: Nov 2 - Nov 8").
  Querying the wrong key would just show the wrong (but still honestly
  computed) period's board — it can't forge a score.
*/

const bangkokPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function getBangkokDateParts(date) {
  const parts = bangkokPartsFormatter.formatToParts(date || new Date());
  const map = {};
  parts.forEach((p) => {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getBangkokDateKey(date) {
  const { year, month, day } = getBangkokDateParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getBangkokMonthKey(date) {
  const { year, month } = getBangkokDateParts(date);
  return `${year}-${pad2(month)}`;
}

// The Bangkok calendar day immediately before the given instant's — same
// technique (and same reasoning) as functions/dateUtil.js's
// getPreviousBangkokDateKey: Bangkok (UTC+7) has no DST, so every
// calendar day there is exactly 24h long, making "subtract 24h in real
// milliseconds, then re-derive the Bangkok date" safe. Used by
// js/domiia-history.js to label groups "TODAY"/"YESTERDAY".
function getPreviousBangkokDateKey(date) {
  const base = date || new Date();
  return getBangkokDateKey(new Date(base.getTime() - 24 * 60 * 60 * 1000));
}

// Same ISO 8601 algorithm as functions/dateUtil.js's getBangkokWeekKey —
// see that file for the full explanation. Returns both the key string
// and the UTC-midnight scratch Date representing the ISO week's Thursday
// (callers that need the Monday/Sunday boundary derive it from that, see
// getBangkokWeekRange below) so the two never drift apart.
function isoWeekOf(year, month, day) {
  const current = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (current.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - dayNum);
  current.setUTCDate(current.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const isoYear = current.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((current - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return { isoYear, weekNum, monday };
}

function getBangkokWeekKey(date) {
  const { year, month, day } = getBangkokDateParts(date);
  const { isoYear, weekNum } = isoWeekOf(year, month, day);
  return `${isoYear}-W${pad2(weekNum)}`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// { start: {year,month,day}, end: {year,month,day} } — Monday through
// Sunday of the ISO week containing `date`'s Bangkok calendar day. Plain
// {year,month,day} triples, deliberately NOT Date objects formatted
// through any further timeZone-aware Intl call (which would risk
// double-applying the Bangkok offset) — see isoWeekOf's own comment.
function getBangkokWeekRange(date) {
  const { year, month, day } = getBangkokDateParts(date);
  const { monday } = isoWeekOf(year, month, day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: { year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate() },
    end: { year: sunday.getUTCFullYear(), month: sunday.getUTCMonth() + 1, day: sunday.getUTCDate() }
  };
}

function shortLabel({ month, day }) {
  return `${MONTH_SHORT[month - 1]} ${day}`;
}

// "This Week" label body (spec section 21): "Nov 2 - Nov 8" — the caller
// prefixes "This Week" / suffixes nothing further.
function getBangkokWeekLabel(date) {
  const { start, end } = getBangkokWeekRange(date);
  return `${shortLabel(start)} – ${shortLabel(end)}`;
}

// "November 2026" (spec section 21).
function getBangkokMonthLabel(date) {
  const { year, month } = getBangkokDateParts(date);
  return `${MONTH_FULL[month - 1]} ${year}`;
}

// "Nov 3, 2026" — a FULL (year-inclusive) short date, for timestamps that
// aren't Today/Yesterday (Step 9's Domiia History page — spec section 15).
function getBangkokFullDateLabel(date) {
  const { year, month, day } = getBangkokDateParts(date);
  return `${MONTH_SHORT[month - 1]} ${day}, ${year}`;
}

// "14:32" — 24-hour clock, Asia/Bangkok, so a displayed timestamp always
// agrees with the mission-day boundary it's grouped under (spec section
// 16) regardless of the viewer's own browser timezone.
const bangkokTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
function getBangkokTimeLabel(date) {
  return bangkokTimeFormatter.format(date || new Date());
}

export {
  getBangkokDateParts,
  getBangkokDateKey,
  getPreviousBangkokDateKey,
  getBangkokMonthKey,
  getBangkokWeekKey,
  getBangkokWeekRange,
  getBangkokWeekLabel,
  getBangkokMonthLabel,
  getBangkokFullDateLabel,
  getBangkokTimeLabel
};
