/*
  Bangkok date helper — PerthSanta Streaming missions backend.
  ------------------------------------------------------------------
  Daily missions reset on the Asia/Bangkok calendar day (UTC+7, no DST),
  computed from the SERVER's own clock — never from anything the client
  sends. `Intl.DateTimeFormat` with an explicit IANA time zone does the
  actual UTC-offset math; Node's bundled ICU data (present by default in
  every Node 20/22 build Cloud Functions runs on) makes this reliable
  without a timezone-database dependency.
*/

const bangkokFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// en-CA formats as YYYY-MM-DD, which is exactly the dateKey format we want
// — no manual string assembly (and no risk of getting field order wrong).
function getBangkokDateKey(date) {
  return bangkokFormatter.format(date || new Date());
}

// Same formatter, via formatToParts() instead of format() — used by the
// week/month key helpers below, which need the individual numeric
// year/month/day components (not a pre-assembled string) to do calendar
// math on the Bangkok CALENDAR date. One formatter instance backs every
// date-key helper in this file (Step 8 spec section 6: "create/reuse a
// single date utility, do not implement week numbering separately in
// multiple files").
function getBangkokDateParts(date) {
  const parts = bangkokFormatter.formatToParts(date || new Date());
  const map = {};
  parts.forEach((p) => {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "YYYY-MM" — the Bangkok calendar month, server-derived only (Step 8).
function getBangkokMonthKey(date) {
  const { year, month } = getBangkokDateParts(date);
  return `${year}-${pad2(month)}`;
}

// ISO 8601 week key ("YYYY-Www"), Monday-start weeks (Step 8 spec
// sections 6-7), computed from the Bangkok CALENDAR date (the
// {year,month,day} triple above) — never from a UTC or host-local
// instant, so this is correct regardless of what timezone the Cloud
// Functions runtime itself happens to be in.
//
// The {year,month,day} triple is turned into a UTC-midnight Date purely
// as a calendar-math scratch value — it is never re-formatted through a
// timeZone-aware Intl call and never compared against a real instant, so
// there's no double-timezone-conversion risk. Standard ISO week
// algorithm: a date belongs to the ISO week containing its Thursday, and
// ISO week 1 of a year is the week containing that year's first
// Thursday. This correctly lets the ISO week-YEAR differ from the
// calendar year at the Dec31/Jan1 boundary (spec section 44) — e.g.
// 2029-12-31 is ISO week 2030-W01, not 2029-W01/W53.
function getBangkokWeekKey(date) {
  const { year, month, day } = getBangkokDateParts(date);
  const current = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (current.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  current.setUTCDate(current.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const isoYear = current.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((current - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${pad2(weekNum)}`;
}

// The Bangkok calendar day immediately before the given instant's — used
// by the streak calculation (Step 5) to check "was the user's last
// completed day exactly yesterday?". Subtracting a fixed 24h in UTC
// millis and re-formatting is safe specifically because Bangkok (UTC+7)
// has no DST — every calendar day there is exactly 24h long, so this can
// never land on the wrong date the way naive UTC-day-minus-one math can
// in a DST-observing zone.
function getPreviousBangkokDateKey(date) {
  const base = date || new Date();
  return bangkokFormatter.format(new Date(base.getTime() - 24 * 60 * 60 * 1000));
}

module.exports = {
  getBangkokDateKey,
  getPreviousBangkokDateKey,
  getBangkokDateParts,
  getBangkokMonthKey,
  getBangkokWeekKey
};
