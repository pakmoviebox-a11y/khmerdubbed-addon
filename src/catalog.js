const axios = require("axios");
const NodeCache = require("node-cache");

const BASE_URL = "https://khmerdubbed.com";
const API_URL = "https://api.khmerdubbed.com";
const cache = new NodeCache({ stdTTL: 3600 });

// Must send Origin + Referer to avoid 403
const HEADERS = {
  "Origin": BASE_URL,
  "Referer": BASE_URL + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

async function apiGet(path) {
  try {
    const res = await axios.get(`${API_URL}${path}`, {
      headers: HEADERS,
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    console.error("[API]", path, err.response?.status, err.message);
    return null;
  }
}

async function getCatalog(type, extra = {}) {
  const skip = parseInt(extra.skip || 0);
  const page = Math.floor(skip / 20) + 1;
  const search = extra.search || "";

  const cacheKey = `catalog_${type}_${page}_${search}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Try common API patterns
  let data = null;

  if (search) {
    data = await apiGet(`/search?q=${encodeURIComponent(search)}&type=${type}`);
    if (!data) data = await apiGet(`/videos?search=${encodeURIComponent(search)}&type=${type}`);
  } else {
    data = await apiGet(`/videos?type=${type}&page=${page}&limit=20`);
    if (!data) data = await apiGet(`/${type}s?page=${page}&limit=20`);
    if (!data) data = await apiGet(`/videos?category=${type}&page=${page}`);
  }

  if (!data) {
    console.error("[CATALOG] All API attempts failed for", type);
    return [];
  }

  // Handle various response shapes
  const items = Array.isArray(data)
    ? data
    : data.results || data.data || data.videos || data.items || [];

  const metas = items.map((item) => buildMeta(item, type));
  cache.set(cacheKey, metas);
  return metas;
}

function buildMeta(item, type) {
  const slug = item.slug || item.id || item._id || "";
  const id = `khmerdubbed:${slug}`;

  const poster =
    item.thumbnail ||
    item.poster ||
    item.image ||
    item.cover ||
    (slug ? `${API_URL}/static/thumbnail/${slug}.jpg` : null);

  return {
    id,
    type,
    name: item.title || item.name || slug,
    poster,
    background: poster,
    description: item.description || item.synopsis || "",
    releaseInfo: item.year ? String(item.year) : undefined,
    website: `${BASE_URL}/${type}/${slug}`,
  };
}

async function getMeta(type, stremioId) {
  const slug = stremioId.split(":")[1];
  if (!slug) return null;

  const cacheKey = `meta_${slug}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await apiGet(`/videos/${slug}`);
  if (!data) return null;

  const meta = buildMeta(data, type);

  // For series get episodes
  if (type === "series") {
    const epData = await apiGet(`/videos/${slug}/episodes`);
    if (epData) {
      const episodes = Array.isArray(epData)
        ? epData
        : epData.episodes || epData.data || epData.results || [];

      meta.videos = episodes.map((ep, i) => ({
        id: `khmerdubbed:${slug}:ep:${ep.episode_number || ep.number || ep.ep || i + 1}`,
        title: ep.title || `Episode ${ep.episode_number || ep.number || i + 1}`,
        season: ep.season || ep.season_number || 1,
        episode: ep.episode_number || ep.number || ep.ep || i + 1,
        released: ep.created_at || ep.date || new Date().toISOString(),
        thumbnail: ep.thumbnail || null,
      }));
    }
  }

  cache.set(cacheKey, meta);
  return meta;
}

module.exports = { getCatalog, getMeta };
