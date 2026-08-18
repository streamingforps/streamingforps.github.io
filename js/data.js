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
      { label: "1M Views", target: 1000000 },
      { label: "2M Views", target: 2000000 },
      { label: "3M Views", target: 3000000 },
      { label: "4M Views", target: 4000000 }
    ],

    // Single shared "current" value for every TikTok goal card above —
    // replaces the old per-goal `current` field so the number only needs
    // updating in one place. The admin console's "TikTok Views" panel
    // manages this same value in Firestore (stats/tiktok.currentViews);
    // this is only the fallback used when Firestore is unavailable.
    tiktokCurrentViews: 2800000,

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
    ]
  },

  // Reserved for a future campaign archive. Not yet displayed anywhere.
  pastCampaigns: [],

  /*
    Announcements — a general, site-wide updates feed shown in the
    Announcements section on index.html. Unlike currentCampaign, this is
    NOT scoped to a single campaign — use it for Heartbound news, music
    releases, JASP.ER news, streaming campaigns, milestones, and general
    site updates alike.

    Rendered newest-first by `date`, so items can be added in any order
    here — no need to keep the array itself sorted.

    Each announcement object shape:
      {
        date: "2026-08-17",     // required, "YYYY-MM-DD"
        category: "JASP.ER",    // required — one of "Heartbound" | "Music" |
                                 // "JASP.ER" | "Streaming" | "Campaign" |
                                 // "General" (see ANNOUNCEMENT_CATEGORIES
                                 // in js/main.js)
        title: "Announcement title",
        message: "Short description shown under the title.",
        url: null,               // optional — leave null to render no CTA
        ctaLabel: null           // optional CTA button text (only shown
                                 // when `url` is set; defaults to
                                 // "Learn more" when left null)
      }
  */
  announcements: [
    {
      date: "2026-08-17",
      category: "JASP.ER",
      title: "JASP.ER Comeback — \"WISH\"",
      message: "A new JASP.ER comeback has been announced with the upcoming song \"WISH\".",
      url: null,
      ctaLabel: null
    },
    {
      date: "2026-08-14",
      category: "Heartbound",
      title: "Heartbound Pilot Trailer Is Out!",
      message: "The official Heartbound pilot trailer is now available. Watch, stream, comment, and share to support PerthSanta.",
      url: "https://www.youtube.com/watch?v=I1guVkLJ4mU",
      ctaLabel: "Watch Trailer"
    },
    {
      date: "2026-08-10",
      category: "Campaign",
      title: "Comment Helper Is Now Available",
      message: "Need inspiration? Generate a comment suggestion and make it your own.",
      url: "campaign.html#comment-helper",
      ctaLabel: "Try Comment Helper"
    },
    {
      date: "2026-08-07",
      category: "Streaming",
      title: "Next Target: 2M Views",
      message: "Keep streaming and sharing the official Heartbound pilot trailer.",
      url: null,
      ctaLabel: null
    },
    {
      date: "2026-08-05",
      category: "Streaming",
      title: "1M YouTube Views Reached",
      message: "Thank you for helping Heartbound reach the first major streaming milestone.",
      url: null,
      ctaLabel: null
    },
    {
      date: "2026-08-03",
      category: "Campaign",
      title: "Leave a Genuine Comment",
      message: "Don't forget to leave a thoughtful comment under the official pilot trailer.",
      url: null,
      ctaLabel: null
    },
    {
      date: "2026-08-01",
      category: "Campaign",
      title: "Use the Official Trailer",
      message: "Please make sure you're streaming the official GMMTV upload, not a reupload or clip.",
      url: null,
      ctaLabel: null
    }
  ],

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
          "Not me refreshing my feed all day waiting for this trailer.",
          "I knew I was excited for Heartbound, but this trailer raised it to another level.",
          "The second this started, I knew I was in trouble in the best way.",
          "Heartbound really came in and demanded all my attention.",
          "I was already excited, but now I genuinely need this series immediately.",
          "This trailer gave me exactly the kind of energy I wanted.",
          "I opened this casually and somehow ended up fully invested.",
          "Everything about this trailer made me even more excited for the series.",
          "I was not prepared for how much fun this trailer would be to watch."
        ],
        observations: [
          "The pacing already feels so promising for a pilot.",
          "Every shot in this trailer looks so intentional.",
          "The music choice fits the mood perfectly.",
          "You can tell so much care went into every scene.",
          "The energy in this trailer is unmatched.",
          "Even the smallest details in this trailer are exciting.",
          "The visuals make every scene feel even more exciting.",
          "The editing keeps the whole trailer moving so well.",
          "There's never a dull moment in this trailer.",
          "The atmosphere changes so smoothly from scene to scene.",
          "The trailer gives just enough without revealing too much.",
          "The soundtrack adds so much energy to every moment.",
          "The production already looks incredibly polished.",
          "Every new scene gives me another reason to be excited."
        ],
        reactions: [
          "I literally can't stop smiling.",
          "My heart is racing just from the trailer alone.",
          "I'm buzzing with excitement for this series.",
          "This is exactly the kind of energy I was hoping for.",
          "I felt my whole mood lift watching this.",
          "I am so ready for this show.",
          "I need the full series now.",
          "This completely exceeded my expectations.",
          "I already know I'm going to be obsessed with this.",
          "I haven't stopped thinking about it since I watched.",
          "This got me even more impatient for the series.",
          "I'm genuinely so hyped after watching this.",
          "This trailer gave me such a rush.",
          "I'm already ready to rewatch every scene."
        ],
        endings: [
          "Bring on the full series already!",
          "Counting down the days until Heartbound airs.",
          "So proud of everyone involved in this project.",
          "This is going to be a fun ride.",
          "Let's go, Heartbound!",
          "I'll be here for every single episode.",
          "Heartbound, I'm ready for you.",
          "This series cannot come soon enough.",
          "I'll definitely be following this one from beginning to end.",
          "Please give us the full series soon!",
          "I'm so ready to support Heartbound all the way.",
          "This is definitely staying on my watch list.",
          "The countdown to Heartbound officially starts now.",
          "Can't wait to experience the whole series."
        ]
      },

      emotional: {
        openings: [
          "I wasn't expecting to feel this much from just a trailer.",
          "This trailer hit me somewhere unexpected.",
          "I got a little emotional watching this, not going to lie.",
          "There's something about this trailer that really moved me.",
          "I didn't think a pilot trailer could make me feel this much.",
          "This trailer sat with me long after it ended.",
          "Something about this trailer feels incredibly warm and personal.",
          "I wasn't ready for how tender some of these moments would feel.",
          "This trailer has such a soft emotional pull to it.",
          "I came here expecting excitement and somehow ended up emotional.",
          "There's a feeling in this trailer that's hard to put into words.",
          "This felt surprisingly intimate for such a short trailer.",
          "I could already feel the emotional weight of the story.",
          "The emotions here caught me completely off guard."
        ],
        observations: [
          "The quiet moments say just as much as the big ones.",
          "There's a real tenderness in how this story is being told.",
          "Even without much dialogue, the emotion comes through clearly.",
          "The way the story is framed already feels heartfelt.",
          "Small expressions carry so much weight in this trailer.",
          "The tone feels sincere in a way that's hard to fake.",
          "The softer scenes really stayed with me.",
          "The emotions feel understated instead of exaggerated.",
          "The silences between the characters say so much.",
          "There's something very human about these little moments.",
          "The emotional tone feels beautifully balanced.",
          "The expressions make the scenes feel very personal.",
          "The trailer lets the emotions breathe instead of rushing them.",
          "Some of the smallest moments are the ones that hit the hardest."
        ],
        reactions: [
          "I felt that in my chest.",
          "That hit softer than I expected.",
          "I needed a moment after watching that.",
          "That was more touching than I was prepared for.",
          "I felt genuinely moved.",
          "That stayed with me a little longer than usual.",
          "I felt unexpectedly attached already.",
          "This left me with such a warm feeling.",
          "I genuinely felt something watching this.",
          "That was quietly powerful.",
          "I think this story is going to hurt me in the best way.",
          "I wasn't prepared to care this much already.",
          "That emotional tone really got to me.",
          "I can already tell this series is going to make me feel a lot."
        ],
        endings: [
          "Really looking forward to seeing this story unfold.",
          "Hoping this series gets the love it deserves.",
          "This already feels special.",
          "Excited to see where this story goes.",
          "Wishing everyone involved so much success.",
          "This is shaping up to be something meaningful.",
          "I hope the full series keeps this same emotional honesty.",
          "I'm really looking forward to experiencing this story properly.",
          "This feels like a story worth getting attached to.",
          "I can't wait to see these emotions develop further.",
          "I'm already emotionally invested.",
          "I hope Heartbound gets all the love it deserves.",
          "This feels like the beginning of something really special.",
          "I'm ready for whatever emotional journey this series brings."
        ]
      },

      proud: {
        openings: [
          "So proud of everyone who worked on this pilot trailer.",
          "Watching this trailer, I just feel proud of how far this project has come.",
          "This trailer is such a proud moment for the whole team.",
          "I'm so happy to see this project come together.",
          "This feels like a well-deserved moment for everyone involved.",
          "Seeing this trailer finally out there is such a proud feeling.",
          "It's really satisfying to see Heartbound finally reaching this point.",
          "This feels like such an exciting milestone for everyone involved.",
          "Seeing the finished trailer makes all the anticipation feel worth it.",
          "What a beautiful moment for the cast and team behind Heartbound.",
          "It's amazing seeing this project finally come to life.",
          "This trailer really makes me appreciate all the work behind the scenes.",
          "It's such a good feeling seeing this project out in the world.",
          "This is the kind of release that makes you proud to support a project."
        ],
        observations: [
          "You can tell how much effort went into this.",
          "Every part of this trailer shows real dedication.",
          "The quality here really speaks for itself.",
          "This is the result of a lot of hard work paying off.",
          "The whole team should be proud of this.",
          "It's clear a lot of heart went into making this.",
          "The amount of effort behind every detail really shows.",
          "The production team clearly gave this project a lot of care.",
          "Everyone involved brought something valuable to this trailer.",
          "The final result feels polished and thoughtfully made.",
          "The teamwork behind this really comes through.",
          "You can see the dedication in both the performances and production.",
          "This looks like a project everyone involved believed in.",
          "The care behind the production is visible from beginning to end."
        ],
        reactions: [
          "I'm genuinely proud of this project.",
          "This makes me smile with pride.",
          "I feel proud just watching this.",
          "This deserves so much recognition.",
          "I'm rooting for this project's success.",
          "This is something to be proud of.",
          "This makes supporting Heartbound feel even more rewarding.",
          "I'm so happy seeing this project get its moment.",
          "This deserves to reach a huge audience.",
          "I'm proud to be here supporting it from the beginning.",
          "It's wonderful seeing everyone's hard work come together.",
          "This makes me want to support the project even more.",
          "I'm genuinely happy for the whole team.",
          "This feels like such a meaningful achievement."
        ],
        endings: [
          "Congratulations to everyone involved.",
          "Excited to keep supporting this project.",
          "Here's to Heartbound's success.",
          "So happy to be cheering this on.",
          "Wishing the whole team continued success.",
          "Proud to support this from the start.",
          "Here's hoping Heartbound reaches even more people.",
          "Wishing the cast and crew nothing but success.",
          "I'm excited to keep supporting everyone involved.",
          "May this be the start of something huge for Heartbound.",
          "Sending all my support to the entire team.",
          "I hope everyone involved gets the recognition they deserve.",
          "Looking forward to celebrating many more Heartbound milestones.",
          "Let's keep giving this project all the support we can."
        ]
      },

      acting: {
        openings: [
          "The acting in this trailer already stands out.",
          "I'm impressed by the range shown in just this short trailer.",
          "The performances here already feel so natural.",
          "Even in a short trailer, the acting really shines.",
          "The expressions in this trailer say so much.",
          "This trailer shows real skill from the cast.",
          "The performances caught my attention immediately.",
          "There's already so much nuance in the acting here.",
          "The cast is giving us a lot even in these short scenes.",
          "I'm really enjoying how grounded the performances feel.",
          "The acting already gives the characters a lot of personality.",
          "The performances make the trailer feel much more immersive.",
          "I'm impressed by how expressive everyone is without overdoing it.",
          "The cast really sells the emotion of these scenes."
        ],
        observations: [
          "The subtle expressions carry a lot of emotion.",
          "The delivery feels natural, not forced at all.",
          "Small reactions in this trailer feel very genuine.",
          "The body language alone tells a story.",
          "The timing in these scenes feels really well done.",
          "Every glance and pause feels intentional.",
          "The facial expressions are doing so much storytelling.",
          "The emotional shifts feel very believable.",
          "The actors make the quieter moments feel just as important.",
          "The chemistry between performance and direction is really strong.",
          "The reactions feel spontaneous rather than staged.",
          "The characters already feel distinct through the acting alone.",
          "The emotional beats land because the performances feel restrained.",
          "The little details in the acting make the scenes feel lived-in."
        ],
        reactions: [
          "Perth and Santa are both doing so well here.",
          "The acting really pulled me in.",
          "I'm impressed by the performances already.",
          "This is some really solid acting for a pilot.",
          "The cast is clearly putting in the work.",
          "I can already tell the acting will be a highlight.",
          "I'm already curious to see what these actors do with full episodes.",
          "The performances made these characters immediately interesting to me.",
          "I really enjoyed how believable the interactions felt.",
          "This cast already has my attention.",
          "The acting makes me want to know these characters better.",
          "I'm really impressed with what we've seen so far.",
          "The performances add so much depth to the trailer.",
          "I can already see a lot of potential in these characters."
        ],
        endings: [
          "Excited to see more of these performances.",
          "Can't wait to see the full range of acting in the series.",
          "Great work from the whole cast.",
          "Looking forward to seeing this talent shine further.",
          "This bodes really well for the full series.",
          "Really well acted for a pilot trailer.",
          "I'm excited to see how these performances grow over the series.",
          "Can't wait to see more character-driven scenes.",
          "I'm looking forward to seeing everyone get more room to shine.",
          "This cast looks ready to deliver something memorable.",
          "I'm excited to see the deeper emotional scenes later on.",
          "The performances already make me confident about the series.",
          "Can't wait to watch these characters fully come to life.",
          "I'm definitely watching for the performances as much as the story."
        ]
      },

      chemistry: {
        openings: [
          "The chemistry between Perth and Santa is already so clear.",
          "Perth and Santa's chemistry jumps off the screen instantly.",
          "You can feel the connection between Perth and Santa right away.",
          "The dynamic between these two is already so easy to watch.",
          "Perth and Santa's chemistry is exactly what I was hoping for.",
          "There's a natural spark between Perth and Santa in this trailer.",
          "Perth and Santa feel completely at ease with each other on screen.",
          "The connection between Perth and Santa comes through immediately.",
          "Their scenes together have such an effortless energy.",
          "There's something very natural about the way Perth and Santa interact.",
          "Their dynamic already feels incredibly easy and believable.",
          "Perth and Santa make even the small moments between them interesting.",
          "The chemistry here feels warm, playful, and completely natural.",
          "The moment they're on screen together, the energy changes."
        ],
        observations: [
          "Their timing together feels really natural.",
          "Even small interactions between them feel genuine.",
          "The way they play off each other is really enjoyable.",
          "Their chemistry doesn't feel forced at all.",
          "You can tell they have a real connection on screen.",
          "Their scenes together already feel comfortable and real.",
          "The eye contact between them adds so much to the scenes.",
          "Their reactions to each other feel spontaneous and real.",
          "The smallest gestures between them make the dynamic believable.",
          "They have such an easy rhythm when they're acting together.",
          "Their scenes feel natural instead of overly performed.",
          "The chemistry works even when neither of them is saying much.",
          "They bounce off each other really well.",
          "Their body language makes their connection feel convincing."
        ],
        reactions: [
          "I'm already invested in their dynamic.",
          "Their chemistry has me hooked.",
          "I love watching them together on screen.",
          "This pairing works so well.",
          "Their scenes are already a highlight for me.",
          "I can't get enough of their chemistry.",
          "I could watch their interactions all day.",
          "Their dynamic is already one of my favorite parts of the trailer.",
          "They make it very easy to care about their relationship.",
          "I'm completely sold on this pairing.",
          "The chemistry makes me even more excited for the story.",
          "I already want more scenes of them together.",
          "Their connection feels so easy to believe.",
          "I'm definitely invested in seeing where their relationship goes."
        ],
        endings: [
          "Can't wait to see more of their story together.",
          "Excited to watch their dynamic grow throughout the series.",
          "Perth and Santa are such a great match for this.",
          "Looking forward to more scenes with the two of them.",
          "This duo is going to be so much fun to watch.",
          "So here for this pairing.",
          "I'm ready to watch their relationship unfold properly.",
          "Can't wait to see all the different sides of their dynamic.",
          "Their chemistry is going to make this such a fun watch.",
          "I'm so curious to see how their relationship develops.",
          "This pairing already feels like one of Heartbound's biggest strengths.",
          "I can't wait for more quiet moments between these two.",
          "They really make this story feel alive.",
          "I'm excited to see what the full series brings for them."
        ]
      },

      story: {
        openings: [
          "The story being set up here already feels intriguing.",
          "I'm curious where this story is going to go.",
          "This trailer sets up a story I'm genuinely interested in.",
          "The premise shown in this trailer already has my attention.",
          "There's a lot of story potential packed into this short trailer.",
          "I'm already invested in the story after just this trailer.",
          "This trailer gives just enough story to make me want answers.",
          "The world of Heartbound already feels like it has a lot going on.",
          "I'm really interested in the direction this story seems to be heading.",
          "The setup feels familiar enough to pull me in but fresh enough to keep me curious.",
          "This trailer immediately made me want to understand these characters better.",
          "The story hints here are doing exactly what a good trailer should.",
          "There's clearly a much bigger story waiting behind these scenes.",
          "The premise already feels like it could go in some really interesting directions."
        ],
        observations: [
          "The setup leaves just enough to keep me curious.",
          "There's clearly more happening beneath the surface here.",
          "The world being built already feels layered and interesting.",
          "The narrative hints are doing their job — I'm curious.",
          "It's a good sign when a trailer leaves you with questions.",
          "The story pacing in this trailer feels well thought out.",
          "The trailer balances character moments and plot hints really well.",
          "There are enough unanswered questions to keep things interesting.",
          "The relationships seem closely tied to the larger story.",
          "The trailer gives us clues without spelling everything out.",
          "The setup feels like it has room for both emotional and dramatic moments.",
          "The characters already seem to have more going on beneath the surface.",
          "The world feels bigger than what we've been shown so far.",
          "The story looks like it could develop in several unexpected directions."
        ],
        reactions: [
          "I want to know more about where this is headed.",
          "This has me thinking about the story already.",
          "I'm intrigued by the direction this seems to be taking.",
          "This premise has a lot of promise.",
          "I'm curious how this story develops over the series.",
          "This trailer left me wanting the full story.",
          "I'm already trying to figure out what happens next.",
          "The trailer definitely succeeded in making me curious.",
          "I want to understand these characters and their history.",
          "I'm already wondering how all these pieces will connect.",
          "This feels like the kind of story that will be fun to theorize about.",
          "I need more context immediately.",
          "I'm genuinely curious about the conflicts being hinted at.",
          "The story has already given me plenty to think about."
        ],
        endings: [
          "Can't wait to see this story unfold.",
          "Really looking forward to following this story.",
          "Excited to see where the writers take this.",
          "This story already has my attention for the long run.",
          "Looking forward to watching this develop episode by episode.",
          "I'm in for the whole story.",
          "I'm excited to uncover the story one episode at a time.",
          "Can't wait to find out what all these hints actually mean.",
          "I'm ready to see how all of this connects.",
          "Definitely looking forward to learning more about these characters.",
          "I hope the full series explores all these story threads.",
          "I'm excited to see what surprises the story has in store.",
          "This has definitely convinced me to follow the series.",
          "I want the next chapter already."
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
          "Can't stop watching this trailer.",
          "This trailer has me so excited!",
          "Heartbound already looks amazing.",
          "PerthSanta did so well here!",
          "I need the full series immediately.",
          "This looks incredibly promising.",
          "Already obsessed with Heartbound.",
          "The chemistry is everything!",
          "Such a beautiful trailer.",
          "The acting already looks so good.",
          "Heartbound has my full attention.",
          "I can't wait to see more!",
          "This deserves so much love.",
          "Everything about this looks so promising.",
          "Perth and Santa look amazing together.",
          "This trailer made me even more excited.",
          "I'm officially ready for Heartbound.",
          "The visuals are stunning!",
          "I already love the atmosphere.",
          "This cast looks incredible.",
          "The story already has me curious.",
          "So much potential in this series!",
          "I'm definitely watching Heartbound.",
          "This trailer was worth the wait.",
          "I love the energy of this!",
          "Already waiting for episode one.",
          "This looks like it's going to be special.",
          "Heartbound, you have my attention.",
          "Such a strong first look at the series.",
          "I can't wait to meet these characters properly.",
          "Sending all my support to Heartbound!",
          "PerthSanta are shining here.",
          "This is such an exciting start.",
          "The whole trailer feels so polished.",
          "I'm ready for this story.",
          "This trailer made my day.",
          "Absolutely here for Heartbound!"
        ]
      }
    }
  },

  /*
    Trending (trending.html) — per-category (PerthSanta / Perth / Santa)
    current-event configuration only. This is a local fallback for when
    Firestore's trending/{category} docs are slow/unavailable; it does
    NOT include phrase libraries — those live entirely in Firestore
    (trendingPhrases/{category}/phrases/{id}) since they can grow into
    the hundreds/thousands and don't belong duplicated in a JS file. If
    Firestore phrases can't load, js/trending.js shows a friendly
    "couldn't load post ideas" message instead of falling back here.

    hashtags are stored as full literal tokens (e.g. "#Example") — no
    "#" is prepended at render time.
  */
  trending: {
    perthsanta: {
      eventName: "",
      keyword: "",
      hashtags: [],
      active: false
    },
    perth: {
      eventName: "",
      keyword: "",
      hashtags: [],
      active: false
    },
    santa: {
      eventName: "",
      keyword: "",
      hashtags: [],
      active: false
    }
  }
};
