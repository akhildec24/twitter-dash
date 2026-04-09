# twitter-dash

Browse any public Twitter / X account's media as a full-screen visual gallery — masonry, grid, or feed layouts with a liquid glass UI.

---

## Features

- **Search any handle** — type any public Twitter/X username on the landing page
- **Three layouts** — Masonry, Grid, and Feed; switch anytime from the toolbar
- **Column control** — 2–8 columns, adjustable with − / + buttons
- **Sort** — newest first, oldest first, or most liked
- **Lightbox** — click any post to open a full-screen view with spring animation
  - Multi-image carousel with dot indicators
  - Prev / Next navigation (arrow keys or on-screen buttons)
  - Like, repost, and bookmark counts + post date
  - View on X, Copy link, Download image
  - **Slideshow** — auto-advances through posts; speed cycles through 2s / 3s / 5s / 8s (Space to play/pause)
  - **Video playback** — Twitter videos and GIFs play inline with native controls
- **Per-handle caching** — data is saved locally so repeat visits are instant
- **Load more** — fetch additional pages beyond the initial 200 posts
- **Reload** — re-fetch fresh data for the current account
- **Reset** — search a different account without restarting
- **Hide posts** — edit mode (localhost only) lets you hide individual posts
- **Light / Dark theme** — toggle from the toolbar
- **Keyboard shortcuts** — `←` / `→` navigate posts, `Space` play/pause slideshow, `Esc` close lightbox

---

## Requirements

| Requirement | Notes |
|---|---|
| **macOS** | Cookie extraction uses macOS Keychain (`security` CLI) |
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Google Chrome** | Must be installed and logged into x.com |
| **sqlite3 CLI** | Pre-installed on macOS |

> Windows / Linux are not supported — the Chrome cookie decryption uses macOS-specific Keychain APIs.

---

## Setup

```bash
# 1. Clone the repo
git clone git@github.com:akhildec24/twitter-dash.git
cd twitter-dash/app

# 2. Install dependencies
npm install

# 3. Start
npm run dev
```

The browser opens automatically at `http://localhost:3000`.

---

## How authentication works

No API keys or tokens are needed. The app reads your **existing Chrome login session** for x.com:

1. It copies Chrome's `Cookies` SQLite database to a temp file
2. Decrypts the `ct0` and `auth_token` cookies using the key stored in macOS Keychain under **Chrome Safe Storage**
3. Uses those cookies to call Twitter's internal GraphQL API — the same requests the x.com web app makes in the browser

**Chrome must be installed and you must be logged into x.com.** No credentials are stored by this app; the cookies are read live on each fetch.

---

## Data & caching

Fetched data is saved as JSON files in `app/data/{handle}.json`. This directory is git-ignored.

| Action | What it does |
|---|---|
| Visit a handle you've loaded before | Loads from cache instantly |
| Click **↻ Reload** in the profile bar | Deletes cache and re-fetches |
| Click **Load more** in the toolbar | Fetches the next page and appends |
| Click **⌕ Reset** in the profile bar | Returns to the landing page |

To wipe all cached data:

```bash
rm -rf app/data/
```

---

## Updating Twitter query IDs

Twitter's internal GraphQL query IDs change when they ship updates to x.com. If fetches start failing with "User not found" or similar errors, update the IDs in `app/twitter.js`:

1. Open Chrome and go to x.com
2. Open DevTools → Network tab → filter by `graphql`
3. Navigate to a profile page and look for:
   - `UserByScreenName` — copy the ID from the URL path
   - `UserMedia` — copy the ID from the URL path
4. Replace the two IDs near the top of the fetch calls in `app/twitter.js`:

```js
// Profile lookup (~line 256)
const userJson = await gql('NimuplG1OB7Fd2btCLdBOw', 'UserByScreenName', ...

// Media timeline (~line 307)
json = await gql('y4E0HTZKPhAOXewRMqMqgw', 'UserMedia', vars, ...
```

---

## Project structure

```
app/
├── server.js        Express server + API routes
├── twitter.js       Twitter GraphQL API + Chrome cookie auth
├── app.js           Frontend SPA (rendering, lightbox, toolbar)
├── index.html       Single HTML page (3 views: landing, loading, portfolio)
├── style.css        Liquid glass design system
├── assets/          SVG icons + favicon
├── data/            Per-handle JSON cache (git-ignored)
└── node_modules/    Dependencies (git-ignored)
```

### API routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/check?handle=` | Return cached data if it exists |
| `GET` | `/api/fetch?handle=&maxPosts=` | SSE stream — fetch fresh data |
| `GET` | `/api/load-more?handle=&maxPosts=` | SSE stream — fetch next page |
| `POST` | `/api/hidden` | Save hidden post IDs to cache |
| `DELETE` | `/api/cache/:handle` | Delete cached data for a handle |

---

## Troubleshooting

**"Could not read Chrome Safe Storage key from Keychain"**
- Make sure Google Chrome (not Chromium, Brave, or Arc) is installed
- Open Chrome and log into x.com at least once

**"No ct0 cookie found"**
- You are not logged into x.com in Chrome — log in and try again

**Fetch fails / no media returned**
- The GraphQL query IDs may be stale — see [Updating Twitter query IDs](#updating-twitter-query-ids)
- The account may be private or suspended

**Videos don't play**
- Old cached data was fetched before video URL extraction was added
- Click **↻ Reload** on the account to re-fetch with video support

**Port 3000 already in use**

```bash
lsof -ti:3000 | xargs kill
npm run dev
```

---

## Credits

Originally forked from [nomanjack/twitter-media-portfolio](https://github.com/nomanjack), now adapted as twitter-dash. Connect your Twitter/X profile to explore, curate, download, and present media posts in a clean visual portfolio.
