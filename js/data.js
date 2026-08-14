/*
  Streaming For PS — site data
  ------------------------------------------------------------------
  This file is the single editable source for everything that changes
  campaign to campaign: goals, links, missions, platform cards, FAQ, etc.
  `js/main.js` reads this object and renders it into index.html and
  campaign.html. Edit values here — you should not need to touch the
  HTML/CSS/render logic to update a link, goal, or mission.

  IMPORTANT: any URL that hasn't been confirmed yet is left as `null`.
  main.js renders `null` URLs as a visible "Coming soon" placeholder
  instead of a broken or guessed link. Replace `null` with the real
  URL string (e.g. "https://youtube.com/watch?v=...") when it's ready.
*/

const siteData = {
  site: {
    name: "Streaming For PS",
    tagline: "Supporting PerthSanta, one stream at a time."
  },

  /*
    The campaign currently shown on the homepage and campaign.html.
    When this campaign ends and a new one begins, move this object into
    `pastCampaigns` and replace `currentCampaign` with the new campaign's
    data — the page structure does not need to change.
  */
  currentCampaign: {
    id: "heartbound-pilot-trailer",
    title: "HEARTBOUND",
    subtitle: "Pilot Trailer Streaming Campaign",
    status: "active", // "active" | "upcoming" | "ended"
    description:
      "PerthSanta's upcoming series Heartbound just released its pilot trailer. This is our first big push to help it reach as many eyes as possible — every watch, like, comment, and share genuinely helps.",
    heroMessage:
      "Let's show up for PerthSanta and Heartbound together. Every bit of support counts.",
    primaryPlatform: "youtube",

    // The official trailer link has not been provided yet.
    primaryLink: {
      label: "Official Heartbound Pilot Trailer",
      url: null
    },

    // Placeholder milestones — replace target/current with real numbers
    // once the actual campaign goals are confirmed.
    goals: [
      { label: "1M Views", target: 1000000, current: 0 },
      { label: "2M Views", target: 2000000, current: 0 },
      { label: "3M Views", target: 3000000, current: 0 },
      { label: "5M Views", target: 5000000, current: 0 }
    ],

    // Platform Support Center cards. `url: null` renders as "Coming soon".
    platforms: [
      {
        id: "youtube",
        name: "YouTube",
        actions: ["Watch", "Like", "Comment", "Share"],
        cta: "STREAM NOW",
        url: null
      },
      {
        id: "x",
        name: "X / Twitter",
        actions: ["Like", "Repost", "Reply", "Share"],
        cta: "ENGAGE ON X",
        url: null
      },
      {
        id: "instagram",
        name: "Instagram",
        actions: ["Like", "Comment", "Share", "Story"],
        cta: "ENGAGE ON INSTAGRAM",
        url: null
      },
      {
        id: "tiktok",
        name: "TikTok",
        actions: ["Watch", "Like", "Comment", "Share"],
        cta: "ENGAGE ON TIKTOK",
        url: null
      },
      {
        id: "facebook",
        name: "Facebook",
        actions: ["React", "Comment", "Share"],
        cta: "ENGAGE ON FACEBOOK",
        url: null
      }
    ],

    // Today's Support Mission — simple ordered checklist, edit freely.
    missions: [
      "Watch the Heartbound pilot trailer",
      "Like the official video",
      "Leave a genuine comment",
      "Share the trailer with a friend or on your socials",
      "Engage with the official Heartbound posts",
      "Come back later and keep supporting the campaign"
    ],

    // Quick Links grid. `icon` is a plain glyph/emoji — swap for a real
    // icon asset later if desired.
    quickLinks: [
      { label: "Heartbound Pilot Trailer", icon: "▶", url: null },
      { label: "Official X Post", icon: "𝕏", url: null },
      { label: "Instagram Post", icon: "◎", url: null },
      { label: "TikTok Post", icon: "♪", url: null },
      { label: "YouTube Channel", icon: "▶", url: null },
      { label: "PerthSanta Official Content", icon: "❤", url: null }
    ],

    // Campaign Updates feed. Add newest entries to the top.
    // Example: { date: "2026-08-14", message: "Campaign kicked off!" }
    announcements: []
  },

  // Reserved for a future campaign archive. Not yet displayed anywhere.
  pastCampaigns: [],

  // Streaming Guides hub — cards on index.html linking to guides/*.html
  guides: [
    { id: "youtube", label: "YouTube Guide", description: "Watching, liking, commenting, and sharing effectively.", href: "guides/youtube.html" },
    { id: "spotify", label: "Spotify Guide", description: "Supporting music releases and playlists.", href: "guides/spotify.html" },
    { id: "x", label: "X Engagement Guide", description: "Liking, reposting, and replying on X/Twitter.", href: "guides/x.html" },
    { id: "instagram", label: "Instagram Engagement Guide", description: "Posts, stories, and comments.", href: "guides/instagram.html" },
    { id: "tiktok", label: "TikTok Guide", description: "Watching, liking, and duetting/sharing.", href: "guides/tiktok.html" },
    { id: "facebook", label: "Facebook Guide", description: "Reacting, commenting, and sharing.", href: "guides/facebook.html" }
  ],

  // FAQ — placeholder answers, replace with real copy when ready.
  faq: [
    {
      q: "What is Streaming For PS?",
      a: "Streaming For PS is a fan-run hub for the PerthSanta fandom — one place to find current campaigns, streaming guides, and links, so you don't have to dig through social media to find out how to help."
    },
    {
      q: "What are we currently supporting?",
      a: "The current focus is the Heartbound pilot trailer streaming campaign. See the Current Campaign page for details."
    },
    {
      q: "Which video should I stream?",
      a: "Placeholder — the official trailer link will be added here once confirmed."
    },
    {
      q: "Where can I find official links?",
      a: "Official links will be listed on the Current Campaign page and in Quick Links once they're confirmed. Until then, those spots are marked \"Coming soon.\""
    },
    {
      q: "How can I help if I only have a few minutes?",
      a: "Check Today's Support Mission on the Current Campaign page — it's designed to be completed quickly."
    },
    {
      q: "Where can I find platform-specific guides?",
      a: "See the Streaming Guides section for guides organized by platform (YouTube, Spotify, X, Instagram, TikTok, Facebook)."
    },
    {
      q: "How often are campaigns updated?",
      a: "Placeholder — update cadence will be described here once decided."
    }
  ]
};
