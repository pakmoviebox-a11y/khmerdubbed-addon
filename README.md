# Khmer Dubbed — Stremio Addon

A Stremio addon that scrapes **khmerdubbed.com** (your WordPress site) and serves movies & series directly in Stremio.

---

## How It Works

1. Uses the **WordPress REST API** (`/wp-json/wp/v2/`) to fetch your posts
2. Scrapes individual post pages to find embedded video players
3. Resolves video URLs from common hosts: Streamtape, Doodstream, Fembed, Filemoon, direct MP4/HLS
4. Serves a Stremio-compatible API so you can install it in the app

---

## Setup

### Requirements
- Node.js 16+
- Your WordPress site must have REST API enabled (default in WP 5+)

### Install & Run

```bash
# Install dependencies
npm install

# Start the addon server
npm start
```

The server runs on **http://localhost:7000** by default.

---

## Install in Stremio

1. Open Stremio
2. Go to **Settings → Addons**
3. Click **"+ Install Addon"** or paste this URL in the search bar:
   ```
   http://localhost:7000/manifest.json
   ```
4. Click Install

> **Tip:** If running on a remote server, replace `localhost:7000` with your server's IP or domain.

---

## Deployment (Recommended: Railway or Render)

### Deploy to Railway (Free)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variable: `PORT=7000`
4. Use the public Railway URL as your addon URL

### Deploy to Render (Free)
1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Build command: `npm install`
4. Start command: `npm start`

---

## Customisation

### If your WordPress uses custom post types

Edit `src/catalog.js` and update `POST_TYPE_MAP`:

```js
const POST_TYPE_MAP = {
  movie: ["your-movie-post-type"],
  series: ["your-series-post-type"],
};
```

To discover your post types, visit:
```
https://khmerdubbed.com/wp-json/wp/v2/types
```

### If videos are on a host not listed

Edit `src/streams.js` → `resolveEmbed()` and add a new `if` block:

```js
if (embedUrl.includes("yourhost.com")) {
  const stream = await resolveYourHost(embedUrl);
  if (stream) streams.push({ url: stream, title: "Your Host" });
  return streams;
}
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Catalog is empty | Check `https://khmerdubbed.com/wp-json/wp/v2/types` to find correct post type names |
| No streams found | Open the post URL in browser → right-click → Inspect → Network tab → look for `.mp4` or `.m3u8` requests |
| 403 errors from WP API | Make sure REST API is not blocked. Check Security/Firewall plugins |
| Stremio shows "no streams" | The video host may require a browser to load (JS-heavy). Add a custom resolver in `streams.js` |

---

## File Structure

```
khmerdubbed-addon/
├── index.js          ← Server entry point
├── package.json
├── src/
│   ├── addon.js      ← Stremio addon definition & handlers
│   ├── catalog.js    ← WordPress API fetcher, catalog & meta
│   └── streams.js    ← Video scraper & embed resolvers
└── README.md
```
