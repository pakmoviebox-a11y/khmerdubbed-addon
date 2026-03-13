const axios = require("axios");
const cheerio = require("cheerio");
const NodeCache = require("node-cache");

const BASE_URL = "https://khmerdubbed.com";
const cache = new NodeCache({ stdTTL: 3600 });

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": BASE_URL,
};

async function fetchPage(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    return res.data;
  } catch (err) {
    console.error("[FETCH]", url, err.message);
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

  let url;
  if (search) {
    url = `${BASE_URL}/?s=${encodeURIComponent(search)}`;
  } else if (type === "movie") {
    url = `${BASE_URL}/movie/page/${page}/`;
  } else {
    url = `${BASE_URL}/series/page/${page}/`;
  }

  const html = await fetchPage(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const metas = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (
      (href.includes("/movie/") || href.includes("/series/") || href.includes("/tv/")) &&
      !href.includes("/page/") &&
      !href.includes("/episode/") &&
      !seen.has(href)
    ) {
      seen.add(href);
      const title =
        $(el).find("img").attr("alt") ||
        $(el).attr("title") ||
        $(el).text().trim();
      const img =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src") ||
        $(el).find("img").attr("data-lazy-src") ||
        null;

      if (title && title.length > 1) {
        const id = Buffer.from(href).toString("base64url");
        metas.push({ id: `khmerdubbed:${id}`, type, name: title, poster: img, website: href });
      }
    }
  });

  cache.set(cacheKey, metas);
  return metas;
}

async function getMeta(type, stremioId) {
  const id = stremioId.split(":")[1];
  if (!id) return null;

  const cacheKey = `meta_${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let url;
  try { url = Buffer.from(id, "base64url").toString("utf8"); } catch { return null; }

  const html = await fetchPage(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text().trim() ||
    $("title").text().replace(/[-|].*$/, "").trim();

  const poster =
    $("meta[property='og:image']").attr("content") ||
    $(".poster img, .film-poster img, .movie-poster img, .wp-post-image").first().attr("src") ||
    null;

  const description =
    $("meta[property='og:description']").attr("content") ||
    $(".description, .synopsis, .entry-content p").first().text().trim() ||
    "";

  const meta = { id: stremioId, type, name: title, poster, background: poster, description, website: url };

  if (type === "series") {
    const videos = [];
    const seen = new Set();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!href.includes("/episode/") || seen.has(href)) return;
      seen.add(href);
      const text = $(el).text().trim();
      const epMatch = href.match(/episode[\/\-_]?0*(\d+)/i);
      const epNum = epMatch ? parseInt(epMatch[1]) : videos.length + 1;
      const epId = Buffer.from(href).toString("base64url");
      videos.push({
        id: `khmerdubbed:${epId}`,
        title: text || `Episode ${epNum}`,
        season: 1,
        episode: epNum,
        released: new Date().toISOString(),
      });
    });
    meta.videos = videos.sort((a, b) => a.episode - b.episode);
  }

  cache.set(cacheKey, meta);
  return meta;
}

function idToUrl(id) {
  try { return Buffer.from(id, "base64url").toString("utf8"); } catch { return null; }
}

module.exports = { getCatalog, getMeta, idToUrl };
