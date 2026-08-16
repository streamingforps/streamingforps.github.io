/*
  PerthSanta Streaming — site data
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
    name: "PerthSanta Streaming",
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
    
      primaryPlatforms: ["youtube", "tiktok"],

    // The official trailer link has not been provided yet.
    primaryLink: {
      label: "Official Heartbound Pilot Trailer",
      url: "https://www.youtube.com/watch?v=I1guVkLJ4mU"
    },

    tiktokLink: {
      label: "Official Heartbound Pilot Trailer on TikTok",
      url: "https://www.tiktok.com/@gmmtvofficial/video/7664261665067781397"
    },

    // Placeholder milestones — replace target/current with real numbers
    // once the actual campaign goals are confirmed.
    goals: [
      { label: "1M Views", target: 1000000, current: 0 },
      { label: "2M Views", target: 2000000, current: 0 },
      { label: "3M Views", target: 3000000, current: 0 },
      { label: "5M Views", target: 5000000, current: 0 }
    ],

    tiktokGoals: [
      { label: "1M Views", target: 1000000, current: 2800000 },
      { label: "2M Views", target: 2000000, current: 2800000 },
      { label: "3M Views", target: 3000000, current: 2800000 },
      { label: "4M Views", target: 4000000, current: 2800000 }
    ],

    // Platform Support Center cards. `url: null` renders as "Coming soon".
    platforms: [
      {
        id: "x",
        name: "X / Twitter",
        actions: ["Like", "Repost", "Reply", "Share"],
        cta: "ENGAGE ON X",
        url: "https://x.com/HeartboundTH"
      },
      {
        id: "instagram",
        name: "Instagram",
        actions: ["Like", "Repost", "Comment", "Share"],
        cta: "ENGAGE ON INSTAGRAM",
        url: "https://www.instagram.com/heartboundth_/"
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
      { label: "Heartbound Pilot Trailer", icon: "▶", url: "https://www.youtube.com/watch?v=I1guVkLJ4mU" },
      { label: "Official X Post", icon: "𝕏", url: "https://x.com/GMMTV/status/2078863739143803261" },
      { label: "Instagram Post", icon: "◎", url: "https://www.instagram.com/reel/Da_ms6PMQtl/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==&igsi=MzRlODBiNWFlZA==" },
      { label: "TikTok Post", icon: "♪", url: "https://www.tiktok.com/@gmmtvofficial/video/7664261665067781397?is_from_webapp=1&sender_device=pc&web_id=7674032561550607879" }
    ],

    /*
      Campaign Updates feed. Add newest entries to the top — the first
      item in the array is treated as the newest and gets a slightly
      stronger accent border.

      Each update object shape:
        {
          type: "milestone" | "goal" | "reminder" | "tool" | "important",
          icon: "✓",                // small glyph/emoji shown on the card
          title: "Update title",
          message: "Short description shown under the title.",
          date: null,                // optional, e.g. "2026-08-14"
          ctaLabel: null,            // optional CTA button text
          ctaHref: null              // optional CTA button URL — leave both
                                     // ctaLabel/ctaHref null to render no CTA
        }

      `type` drives the category badge label/color — see
      ANNOUNCEMENT_TYPES in js/main.js for the type -> badge text mapping.
    */
    announcements: [
      {
        type: "milestone",
        icon: "✓",
        title: "1M YouTube Views Reached",
        message: "Thank you for helping Heartbound reach the first major streaming milestone.",
        date: null,
        ctaLabel: null,
        ctaHref: null
      },
      {
        type: "goal",
        icon: "→",
        title: "Next Target: 2M Views",
        message: "Keep streaming and sharing the official Heartbound pilot trailer.",
        date: null,
        ctaLabel: null,
        ctaHref: null
      },
      {
        type: "reminder",
        icon: "💬",
        title: "Leave a Genuine Comment",
        message: "Don't forget to leave a thoughtful comment under the official pilot trailer.",
        date: null,
        ctaLabel: null,
        ctaHref: null
      },
      {
        type: "tool",
        icon: "✨",
        title: "Comment Helper Is Now Available",
        message: "Need inspiration? Generate a comment suggestion and make it your own.",
        date: null,
        ctaLabel: "Try Comment Helper",
        ctaHref: "campaign.html#comment-helper"
      },
      {
        type: "important",
        icon: "⚠",
        title: "Use the Official Trailer",
        message: "Please make sure you're streaming the official GMMTV upload.",
        date: null,
        ctaLabel: null,
        ctaHref: null
      }
    ]
  },

  // Reserved for a future campaign archive. Not yet displayed anywhere.
  pastCampaigns: [],

  /*
    PerthSanta Music — a permanent hub for songs/OSTs, independent of
    currentCampaign. Rendered on the dedicated music.html catalog page
    (js/main.js, renderMusicSections()) and stays populated across
    campaigns, so it does not move when the active campaign changes.

    Songs are grouped into four top-level categories, each an array of
    song objects. Every category renders as its own section on
    music.html, in this order: osts, perthsanta, perthSolo, jasper.
    A category with an empty array simply hides its section — nothing
    breaks.

    Song object shape (same shape in every category):

      {
        id: "unique-slug",     // required, unique, no spaces
        title: "Song title",   // required
        artist: "PerthSanta",  // required
        type: "Single",         // short label: "OST" | "Single" | "Solo" | "Group" | ...
        series: "Heartbound",   // optional — only used by osts; omit or set null otherwise
        release: null,          // optional — omit or set null; any short release info/date
        note: null,             // optional — omit or set null
        cover: null,             // optional — path like "assets/images/music/unique-slug.jpg", or null if no cover yet
        links: {
          youtube: null,
          spotify: null,
          appleMusic: null,
          youtubeMusic: null
          // add more platform keys here as needed later
        }
      }

    Only links with a real URL (not null) render a button — leave
    unconfirmed platforms/covers as null rather than guessing.

    Within `osts`, songs sharing the same `series` value are grouped
    and shown under a shared subheading, in the order that series
    first appears in the array — add new songs to an existing series
    by inserting them anywhere in the array with a matching `series`.
  */
  music: {
    // Songs from PerthSanta series/projects. Grouped by `series` on the page.
    osts: [
      {
        id: "no-one-else",
        title: "No One Else",
        artist: "PerthSanta",
        type: "OST",
        series: "Perfect 10 Liners",
        release: null,
        note: null,
        cover: "assets/images/music/no-one-else.png",
        links: { youtube: "https://www.youtube.com/watch?v=itsxy1gUIYY", spotify: "https://open.spotify.com/track/15h2FKedbdrgOrtl4UH7eM", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "a-rak-a-rak",
        title: "A-Rak-A-Rak",
        artist: "PerthSanta",
        type: "OST",
        series: "Love You Teacher",
        release: null,
        note: null,
        cover: "assets/images/music/a-rak-a-rak.png",
        links: { youtube: "https://www.youtube.com/watch?v=-OwlECihP68", spotify: "https://open.spotify.com/track/5ooHsAtMYjEQGGlFFBAB4x", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "written-in-our-hearts",
        title: "Written in Our Hearts",
        artist: "PerthSanta",
        type: "OST",
        series: "Love You Teacher",
        release: null,
        note: null,
        cover: "assets/images/music/written-in-our-hearts.png",
        links: { youtube: "https://www.youtube.com/watch?v=PE1RN0rkau4", spotify: "https://open.spotify.com/track/5UHYafrPbUDOQUqRStNAm9", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "my-sky",
        title: "My Sky",
        artist: "PerthSanta",
        type: "OST",
        series: "Love You Teacher",
        release: null,
        note: null,
        cover: "assets/images/music/my-sky.png",
        links: { youtube: "https://www.youtube.com/watch?v=8e15jzG0Pao", spotify: "https://open.spotify.com/track/5s4KTNOW4AdfCYBQKVUJIf", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "like-the-air",
        title: "Like the Air",
        artist: "PerthSanta",
        type: "OST",
        series: "Love You Teacher",
        release: null,
        note: null,
        cover: "assets/images/music/like-the-air.png",
        links: { youtube: "https://www.youtube.com/watch?v=C85IgYzuDqA", spotify: "https://open.spotify.com/track/6ggKmTJh3x4TmA9Q7vblkJ", appleMusic: null, youtubeMusic: null }
      }
    ],

    // Songs released by Perth and Santa together, outside of series OSTs.
    perthsanta: [
      {
        id: "be-with-me",
        title: "Be With Me",
        artist: "PerthSanta",
        type: "Single",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/be-with-me.png",
        links: { youtube: "https://www.youtube.com/watch?v=trvsug_27vc", spotify: "https://open.spotify.com/track/0PmKakD7QFA2IFSWBJiMbN", appleMusic: null, youtubeMusic: null }
      }
    ],

    // Perth Tanapon's solo releases — not credited as PerthSanta.
    perthSolo: [
      {
        id: "secret",
        title: "Secret",
        artist: "Perth Tanapon",
        type: "Solo",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/secret.png",
        links: { youtube: "https://www.youtube.com/watch?v=fyx7IXtr6VE", spotify: "https://open.spotify.com/track/0P0iNByNTY9UBCkLF2RVyG", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "numb",
        title: "Numb",
        artist: "Perth Tanapon",
        type: "Solo",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/numb.png",
        links: { youtube: "https://www.youtube.com/watch?v=2O1uI8Inb5Q", spotify: "https://open.spotify.com/track/3KTpHLuTJBwolcFNXIrEtV", appleMusic: null, youtubeMusic: null }
      }
    ],

    // Releases by JASP.ER, the group Santa is part of.
    jasper: [
      {
        id: "sadistic",
        title: "Sadistic",
        artist: "JASP.ER",
        type: "Group",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/sadistic.png",
        links: { youtube: "https://www.youtube.com/watch?v=YpVjU4OJ4Ms", spotify: "https://open.spotify.com/track/1CGyKqD9XNKpTU892cULwL", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "take-it-off",
        title: "Take It Off",
        artist: "JASP.ER",
        type: "Group",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/take-it-off.png",
        links: { youtube: "https://www.youtube.com/watch?v=KO78TDSp_bo", spotify: "https://open.spotify.com/track/7C1NEDCvP1psZenFDA3Sxx?si=ad195a0b8e2d4da7", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "touch",
        title: "Touch",
        artist: "JASP.ER",
        type: "Group",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/touch.png",
        links: { youtube: "https://www.youtube.com/watch?v=qLb9ZfWBxIw", spotify: "https://open.spotify.com/track/2w3yu5eVe9VdMwyMCfQSrl", appleMusic: null, youtubeMusic: null }
      },
      {
        id: "love-scene",
        title: "Love Scene",
        artist: "JASP.ER",
        type: "Group",
        series: null,
        release: null,
        note: null,
        cover: "assets/images/music/love-scene.png",
        links: { youtube: "https://www.youtube.com/watch?v=pURfo4ey5y0", spotify: "https://open.spotify.com/track/6utAUyCsLCLLZ2F15USs6G", appleMusic: null, youtubeMusic: null }
      }
    ]
  },

  // Streaming Guides hub — cards on index.html linking to guides/*.html
  // `icon` is a plain glyph/emoji shown in each guide card's platform badge.
  guides: [
    { id: "youtube", label: "YouTube Guide", description: "Watching, liking, commenting, and sharing effectively.", href: "guides/youtube.html", icon: "▶" },
    { id: "spotify", label: "Spotify Guide", description: "Supporting music releases and playlists.", href: "guides/spotify.html", icon: "♫" },
    { id: "x", label: "X Engagement Guide", description: "Liking, reposting, and replying on X/Twitter.", href: "guides/x.html", icon: "𝕏" },
    { id: "instagram", label: "Instagram Engagement Guide", description: "Posts, stories, and comments.", href: "guides/instagram.html", icon: "◎" },
    { id: "tiktok", label: "TikTok Guide", description: "Watching, liking, and duetting/sharing.", href: "guides/tiktok.html", icon: "♪" },
    { id: "facebook", label: "Facebook Guide", description: "Reacting, commenting, and sharing.", href: "guides/facebook.html", icon: "f" }
  ],

  /*
    Streaming playlists — used by the "Busy? Use a Playlist" card in the
    YouTube Streaming Guide on campaign.html, for fans who want to stream
    passively instead of picking videos themselves.

    Each entry shape:
      { name: "Playlist name", platform: "YouTube", url: null }

    Leave `url` as `null` until a real playlist link exists — js/main.js
    renders those entries with a "PLAYLISTS COMING SOON" badge instead of
    a dead link. Add as many entries as needed; no HTML changes required.
  */
  streamingPlaylists: [
  {
    name: "Heartbound Streaming Playlist 1",
    platform: "YouTube",
    url: "https://t.co/uR3JSYwqAZ"
  },
  {
    name: "Heartbound Streaming Playlist 2",
    platform: "YouTube",
    url: "https://t.co/g1KzvHgGeq"
  },
  {
    name: "Heartbound Streaming Playlist 3",
    platform: "YouTube",
    url: "https://t.co/Z2bjqNIkX3"
  },
  {
    name: "Heartbound Streaming Playlist 4",
    platform: "YouTube",
    url: "https://t.co/OtzV9m8Ht8"
  },
  {
    name: "Heartbound Streaming Playlist 5",
    platform: "YouTube",
    url: "https://t.co/L0mqk70f0m"
  }
],

  /*
    FAQ — reflects the current Heartbound pilot trailer campaign and the
    site's current functionality. When the active campaign changes, revisit
    the answers that name it directly (currently the 2nd, 3rd, 5th, and 6th
    entries below).
  */
  faq: [
    {
      q: "What is PerthSanta Streaming?",
      a: "PerthSanta Streaming is a fan-run streaming and support hub for PerthSanta. It brings together current campaigns, official links, streaming goals, music, and platform guides so fans can easily find ways to support Perth and Santa's projects."
    },
    {
      q: "What are we currently supporting?",
      a: "Our current main campaign is the <strong>Heartbound Pilot Trailer</strong>. The campaign page contains the official streaming links, current YouTube and TikTok goals, support missions, and other useful information."
    },
    {
      q: "Which video should I stream?",
      a: "Please stream the <strong>official Heartbound pilot trailer uploaded by GMMTV</strong>. You can find the direct YouTube and TikTok links on the Current Campaign page and in the Quick Links section."
    },
    {
      q: "Where can I find official links?",
      a: "Official campaign links are available in the <strong>Quick Links</strong> and <strong>Official Heartbound Accounts</strong> sections. We only want to direct fans to official uploads and official accounts."
    },
    {
      q: "How can I help if I only have a few minutes?",
      a: "Check <strong>Today's Support Mission</strong> on the website. Even simple actions such as watching the official trailer, leaving a genuine comment, liking the content, sharing it, or interacting with official Heartbound posts can help support the campaign."
    },
    {
      q: "Can I get help writing a YouTube comment?",
      a: "Yes. The Current Campaign page includes a <strong>Comment Helper</strong> for fans who want to support the pilot trailer but are not sure what to write. It generates comment suggestions that you can edit and make your own before posting."
    },
    {
      q: "Where can I stream PerthSanta music?",
      a: "Open the <strong>Music</strong> page from the navigation menu. It contains PerthSanta songs, series OSTs, Perth's solo releases, and JASP.ER songs, with available streaming links for platforms such as YouTube and Spotify."
    },
    {
      q: "Are the streaming goals updated automatically?",
      a: "The <strong>YouTube view count is updated automatically</strong> using live data.<br><br>TikTok goals are currently updated manually, so they may not always reflect the exact latest view count."
    },
    {
      q: "How often is the website updated?",
      a: "The site is updated whenever there are important campaign changes, new official links, new streaming goals, new releases, or other relevant PerthSanta streaming information."
    },
    {
      q: "Is PerthSanta Streaming an official PerthSanta or GMMTV website?",
      a: "No. PerthSanta Streaming is an <strong>unofficial fan-run project</strong>. It is not affiliated with, endorsed by, or operated by PerthSanta, GMMTV, Heartbound, or any associated platform."
    }
  ],

  /*
    Comment Helper (campaign.html) — reusable phrase banks for the
    Heartbound pilot trailer comment generator. js/main.js combines
    these into full comments client-side; nothing here is posted
    anywhere automatically, and no external API is used.

    Every style (except "simple") has four phrase pools — openings,
    observations, reactions, endings — combined in that fixed order
    depending on the chosen length:
      short  -> 1 sentence  (opening OR reaction)
      medium -> 2 sentences (opening + observation OR reaction)
      longer -> 4 sentences (opening + observation + reaction + ending)

    "simple" is a flat list of short standalone lines instead, and
    length there just controls how many distinct lines get combined
    (short = 1 line, medium = 2, longer = 3).

    To add more variety later, just append more strings to any pool —
    no HTML/JS changes needed. Keep phrases hashtag-free and avoid any
    claim about specific viewing behavior (e.g. rewatch counts).
  */
  commentHelper: {
    styles: [
      { id: "excited", label: "Excited" },
      { id: "emotional", label: "Emotional" },
      { id: "proud", label: "Proud" },
      { id: "acting", label: "Acting" },
      { id: "chemistry", label: "PerthSanta Chemistry" },
      { id: "story", label: "Story" },
      { id: "simple", label: "Short & Simple" }
    ],

    lengths: [
      { id: "short", label: "Short" },
      { id: "medium", label: "Medium" },
      { id: "longer", label: "Longer" }
    ],

    phrases: {
      excited: {
        openings: [
          "Okay, I just watched the Heartbound pilot trailer and I'm not okay.",
          "I've been waiting for this trailer and it did not disappoint!",
          "The Heartbound trailer just dropped and my excitement is through the roof.",
          "I clicked on this the second it showed up and wow.",
          "This trailer had me hyped from the very first second.",
          "Not me refreshing my feed all day waiting for this trailer."
        ],
        observations: [
          "The pacing already feels so promising for a pilot.",
          "Every shot in this trailer looks so intentional.",
          "The music choice fits the mood perfectly.",
          "You can tell so much care went into every scene.",
          "The energy in this trailer is unmatched.",
          "Even the smallest details in this trailer are exciting."
        ],
        reactions: [
          "I literally can't stop smiling.",
          "My heart is racing just from the trailer alone.",
          "I'm buzzing with excitement for this series.",
          "This is exactly the kind of energy I was hoping for.",
          "I felt my whole mood lift watching this.",
          "I am so ready for this show."
        ],
        endings: [
          "Bring on the full series already!",
          "Counting down the days until Heartbound airs.",
          "So proud of everyone involved in this project.",
          "This is going to be a fun ride.",
          "Let's go, Heartbound!",
          "I'll be here for every single episode."
        ]
      },

      emotional: {
        openings: [
          "I wasn't expecting to feel this much from just a trailer.",
          "This trailer hit me somewhere unexpected.",
          "I got a little emotional watching this, not going to lie.",
          "There's something about this trailer that really moved me.",
          "I didn't think a pilot trailer could make me feel this much.",
          "This trailer sat with me long after it ended."
        ],
        observations: [
          "The quiet moments say just as much as the big ones.",
          "There's a real tenderness in how this story is being told.",
          "Even without much dialogue, the emotion comes through clearly.",
          "The way the story is framed already feels heartfelt.",
          "Small expressions carry so much weight in this trailer.",
          "The tone feels sincere in a way that's hard to fake."
        ],
        reactions: [
          "I felt that in my chest.",
          "That hit softer than I expected.",
          "I needed a moment after watching that.",
          "That was more touching than I was prepared for.",
          "I felt genuinely moved.",
          "That stayed with me a little longer than usual."
        ],
        endings: [
          "Really looking forward to seeing this story unfold.",
          "Hoping this series gets the love it deserves.",
          "This already feels special.",
          "Excited to see where this story goes.",
          "Wishing everyone involved so much success.",
          "This is shaping up to be something meaningful."
        ]
      },

      proud: {
        openings: [
          "So proud of everyone who worked on this pilot trailer.",
          "Watching this trailer, I just feel proud of how far this project has come.",
          "This trailer is such a proud moment for the whole team.",
          "I'm so happy to see this project come together.",
          "This feels like a well-deserved moment for everyone involved.",
          "Seeing this trailer finally out there is such a proud feeling."
        ],
        observations: [
          "You can tell how much effort went into this.",
          "Every part of this trailer shows real dedication.",
          "The quality here really speaks for itself.",
          "This is the result of a lot of hard work paying off.",
          "The whole team should be proud of this.",
          "It's clear a lot of heart went into making this."
        ],
        reactions: [
          "I'm genuinely proud of this project.",
          "This makes me smile with pride.",
          "I feel proud just watching this.",
          "This deserves so much recognition.",
          "I'm rooting for this project's success.",
          "This is something to be proud of."
        ],
        endings: [
          "Congratulations to everyone involved.",
          "Excited to keep supporting this project.",
          "Here's to Heartbound's success.",
          "So happy to be cheering this on.",
          "Wishing the whole team continued success.",
          "Proud to support this from the start."
        ]
      },

      acting: {
        openings: [
          "The acting in this trailer already stands out.",
          "I'm impressed by the range shown in just this short trailer.",
          "The performances here already feel so natural.",
          "Even in a short trailer, the acting really shines.",
          "The expressions in this trailer say so much.",
          "This trailer shows real skill from the cast."
        ],
        observations: [
          "The subtle expressions carry a lot of emotion.",
          "The delivery feels natural, not forced at all.",
          "Small reactions in this trailer feel very genuine.",
          "The body language alone tells a story.",
          "The timing in these scenes feels really well done.",
          "Every glance and pause feels intentional."
        ],
        reactions: [
          "Perth and Santa are both doing so well here.",
          "The acting really pulled me in.",
          "I'm impressed by the performances already.",
          "This is some really solid acting for a pilot.",
          "The cast is clearly putting in the work.",
          "I can already tell the acting will be a highlight."
        ],
        endings: [
          "Excited to see more of these performances.",
          "Can't wait to see the full range of acting in the series.",
          "Great work from the whole cast.",
          "Looking forward to seeing this talent shine further.",
          "This bodes really well for the full series.",
          "Really well acted for a pilot trailer."
        ]
      },

      chemistry: {
        openings: [
          "The chemistry between Perth and Santa is already so clear.",
          "Perth and Santa's chemistry jumps off the screen instantly.",
          "You can feel the connection between Perth and Santa right away.",
          "The dynamic between these two is already so easy to watch.",
          "Perth and Santa's chemistry is exactly what I was hoping for.",
          "There's a natural spark between Perth and Santa in this trailer."
        ],
        observations: [
          "Their timing together feels really natural.",
          "Even small interactions between them feel genuine.",
          "The way they play off each other is really enjoyable.",
          "Their chemistry doesn't feel forced at all.",
          "You can tell they have a real connection on screen.",
          "Their scenes together already feel comfortable and real."
        ],
        reactions: [
          "I'm already invested in their dynamic.",
          "Their chemistry has me hooked.",
          "I love watching them together on screen.",
          "This pairing works so well.",
          "Their scenes are already a highlight for me.",
          "I can't get enough of their chemistry."
        ],
        endings: [
          "Can't wait to see more of their story together.",
          "Excited to watch their dynamic grow throughout the series.",
          "Perth and Santa are such a great match for this.",
          "Looking forward to more scenes with the two of them.",
          "This duo is going to be so much fun to watch.",
          "So here for this pairing."
        ]
      },

      story: {
        openings: [
          "The story being set up here already feels intriguing.",
          "I'm curious where this story is going to go.",
          "This trailer sets up a story I'm genuinely interested in.",
          "The premise shown in this trailer already has my attention.",
          "There's a lot of story potential packed into this short trailer.",
          "I'm already invested in the story after just this trailer."
        ],
        observations: [
          "The setup leaves just enough to keep me curious.",
          "There's clearly more happening beneath the surface here.",
          "The world being built already feels layered and interesting.",
          "The narrative hints are doing their job — I'm curious.",
          "It's a good sign when a trailer leaves you with questions.",
          "The story pacing in this trailer feels well thought out."
        ],
        reactions: [
          "I want to know more about where this is headed.",
          "This has me thinking about the story already.",
          "I'm intrigued by the direction this seems to be taking.",
          "This premise has a lot of promise.",
          "I'm curious how this story develops over the series.",
          "This trailer left me wanting the full story."
        ],
        endings: [
          "Can't wait to see this story unfold.",
          "Really looking forward to following this story.",
          "Excited to see where the writers take this.",
          "This story already has my attention for the long run.",
          "Looking forward to watching this develop episode by episode.",
          "I'm in for the whole story."
        ]
      },

      // "Short & Simple" — flat pool of standalone short lines rather than
      // opening/observation/reaction/ending parts.
      simple: {
        lines: [
          "This looks so good!",
          "Can't wait for this!",
          "So excited for Heartbound!",
          "This trailer is everything.",
          "Loving this already.",
          "Perth and Santa never disappoint.",
          "This is going to be so good.",
          "So proud of this project.",
          "Already hooked!",
          "Can't stop watching this trailer."
        ]
      }
    }
  }
};
