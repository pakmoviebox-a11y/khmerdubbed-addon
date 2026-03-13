const axios = require("axios");
const NodeCache = require("node-cache");

const BASE_URL = "https://khmerdubbed.com";
const API_URL = "https://api.khmerdubbed.com";
const cache = new NodeCache({ stdTTL: 1800 });

const HEADERS = {
  "Origin": BASE_URL,
  "Referer": BASE_URL + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

async function apiGet(path) {
  try {
    const res = await axios.get(`${API_URL}${path}`, { headers: HEADERS, timeout: 15000 });
    return res.data;
  } catch (err) {
    console.error("[STREAM API]", path, err.response?.status, err.message);
    return null;
  }
}

async function getStreams(type, stremioId) {
  const cacheKey = `streams_${stremioId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const parts = stremioId.split(":");
  const slug = parts[1];
  const epNum = parts[3] || null; // format: khmerdubbed:slug:ep:1

  if (!slug) return [];

  console.log("[STREAM] slug:", slug, "ep:", epNum);

  let data = null;

  if (epNum) {
    // Series episode
    data = await apiGet(`/videos/${slug}/episodes/${epNum}`);
    if (!data) data = await apiGet(`/videos/${slug}/episode/${epNum}`);
    if (!data) data = await apiGet(`/episodes/${slug}/${epNum}`);
  } else {
    // Movie
    data = await apiGet(`/videos/${slug}`);
    if (!data) data = await apiGet(`/movies/${slug}`);
  }

  if (!data) return [];

  const streams = extractStreams(data, slug, epNum);

  if (streams.length > 0) cache.set(cacheKey, streams);
  return streams;
}

function extractStreams(data, slug, epNum) {
  const streams = [];

  // Common field names for video URLs
  const urlFields = [
    "video_url", "stream_url", "url", "source", "src",
    "hls_url", "mp4_url", "embed_url", "iframe_url", "player_url",
  ];

  for (const field of urlFields) {
    const val = data[field];
    if (!val || typeof val !== "string") continue;

    if (val.includes("ok.ru")) {
      // ok.ru - return as external URL since direct extraction needs a browser
      streams.push({
        externalUrl: val,
        title: "▶ Watch (ok.ru)",
        behaviorHints: { notWebReady: true },
      });
    } else if (val.includes(".m3u8")) {
      streams.push({ url: val, title: "HLS Stream" });
    } else if (val.includes(".mp4")) {
      streams.push({ url: val, title: "MP4 Stream" });
    } else if (val.startsWith("http")) {
      streams.push({ externalUrl: val, title: "▶ Watch Online" });
    }
  }

  // Check nested sources array
  const sources = data.sources || data.streams || data.videos || data.qualities || [];
  if (Array.isArray(sources)) {
    for (const s of sources) {
      const url = s.url || s.src || s.file || s.link;
      const label = s.label || s.quality || s.name || "Stream";
      if (!url) continue;
      if (url.includes(".m3u8")) streams.push({ url, title: `HLS (${label})` });
      else if (url.includes(".mp4")) streams.push({ url, title: `MP4 (${label})` });
      else if (url.includes("ok.ru")) streams.push({ externalUrl: url, title: `▶ ${label}` });
      else streams.push({ externalUrl: url, title: `▶ ${label}` });
    }
  }

  // If the API returned an ok.ru URL anywhere in the response, find it
  const raw = JSON.stringify(data);
  const okMatches = raw.match(/https?:\/\/(?:www\.)?ok\.ru\/video(?:embed)?\/[\d]+/g) || [];
  for (const url of [...new Set(okMatches)]) {
    if (!streams.find((s) => s.externalUrl === url || s.url === url)) {
      streams.push({ externalUrl: url, title: "▶ Watch (ok.ru)" });
    }
  }

  // Fallback: direct page link
  if (streams.length === 0) {
    const pageUrl = epNum
      ? `${BASE_URL}/movie/${slug}/episode/${epNum}`
      : `${BASE_URL}/movie/${slug}`;
    streams.push({
      externalUrl: pageUrl,
      title: "▶ Watch on khmerdubbed.com",
    });
  }

  console.log(`[STREAM] Returning ${streams.length} stream(s) for ${slug}`);
  return streams;
}

module.exports = { getStreams };
