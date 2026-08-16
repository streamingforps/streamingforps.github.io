# PerthSanta Streaming

A fan-run streaming & support hub for the PerthSanta fandom — one place for fans
to find the current campaign, streaming guides, goals, and links, without
digging through social media.

Live site: https://streamingforps.github.io/

Static site only — HTML, CSS, and vanilla JavaScript. No backend, no build
step, no dependencies.

## Project structure

```
/
├── index.html            Homepage: hero, active campaign, missions, quick
│                          links, platforms, goals, guides, updates, FAQ
├── campaign.html          Full page for the current campaign (Heartbound
│                          pilot trailer streaming campaign)
├── guides/                One placeholder page per platform guide
│   ├── youtube.html
│   ├── spotify.html
│   ├── x.html
│   ├── instagram.html
│   ├── tiktok.html
│   └── facebook.html
├── css/
│   ├── variables.css      Design tokens (colors, spacing, type, radius) —
│   │                      edit this file to re-theme the whole site
│   └── style.css          Layout, components, responsive rules
├── js/
│   ├── data.js             All editable content — see below
│   └── main.js             Rendering + nav/FAQ behavior, shared by every page
├── assets/
│   ├── images/             Real banners/photos go here later
│   └── icons/               Real icon files go here later (v1 uses text glyphs)
└── .nojekyll               Disables GitHub Pages' Jekyll processing
```

## Editing campaign content — `js/data.js`

`js/data.js` is the only file you should need to touch to update most content.
`js/main.js` reads it and renders the campaign card, goals, platform cards,
missions, quick links, announcements, and FAQ on both `index.html` and
`campaign.html`.

- **Links**: set any `url` field to the real URL string. Anything still set to
  `null` renders on the site as a visible "Coming soon" badge instead of a
  dead or guessed link — so it's safe to leave links as `null` until they're
  confirmed.
- **Goals**: edit the `goals` array's `target`/`current` numbers — progress
  bars recalculate automatically.
- **Missions**: edit the `missions` array (order = display order).
- **Announcements**: add `{ date: "YYYY-MM-DD", message: "..." }` objects to
  `announcements`, newest first.
- **FAQ**: edit the `faq` array's `q`/`a` pairs.
- **Switching campaigns**: when the Heartbound pilot trailer campaign ends,
  move the current `currentCampaign` object into the `pastCampaigns` array
  and replace `currentCampaign` with the new campaign's data. `campaign.html`
  and the homepage don't need to change — they always render whatever is in
  `currentCampaign`.

## Previewing locally

Because the pages load `js/data.js`/`js/main.js` via `<script src="...">`,
opening `index.html` directly by double-clicking it works in most browsers,
but running a tiny local server avoids any browser quirks with local file
loading:

```
npx serve .
```

or, with Python:

```
python -m http.server
```

Then open the printed `localhost` URL.

## Deployment (GitHub Pages)

This repository is named `streamingforps.github.io`, so GitHub Pages serves
it automatically from the root of the `main` branch — no workflow file or
extra configuration needed. To deploy:

1. Commit and push changes to `main`.
2. Confirm in the repo's **Settings → Pages** that the source is "Deploy from
   a branch" → `main` / `/(root)` (this is the default for a repo named
   `<name>.github.io`).
3. The site publishes at https://streamingforps.github.io/ within a minute or
   two of each push.
