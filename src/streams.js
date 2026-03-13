const axios = require("axios");
const cheerio = require("cheerio");
const NodeCache = require("node-cache");
const { idToUrl } = require("./catalog");

const BASE_URL = "https://khmerdubbed.com";
const cache = new NodeCache({ stdTTL: 1800 });

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": BASE_URL,
};

async function fetchPage(url, referer) {
  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, Referer: referer || BASE_URL },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    console.error("[FETCH PAGE]", url, err.message);
    return null;
  }
}

async function getStreams(type, stremioId) {
  const cacheKey = `streams_${stremioId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const id = stremioId.split(":")[1];
  if (!id) return [];

  const pageUrl = idToUrl(id);
  if (!pageUrl) return [];

  console.log("[STREAM] Fetching page:", pageUrl);

  const html = await fetchPage(pageUrl);
  if (!html) return [];

  const streams = await extractStreams(html, pageUrl);

  console.log(`[STREAM] Found ${streams.length} stream(s)`);
  if (streams.length > 0) cache.set(cacheKey, streams);

  return streams;
}

async function extractStreams(html, pageUrl) {
  const streams = [];
  const $ = cheerio.load(html);

  // ── 1. ok.ru links ────────────────────────────────────────────────────────
  const okruMatches = [
    ...new Set([
      ...(html.match(/https?:\/\/(?:www\.)?ok\.ru\/video\/[\w\d]+[^\s"'<>]*/gi) || []),
      ...(html.match(/https?:\/\/(?:www\.)?ok\.ru\/videoembed\/[\w\d]+[^\s"'<>]*/gi) || []),
    ]),
  ];

  for (const okUrl of okruMatches) {
    const stream = await resolveOkRu(okUrl);
    if (stream) {
      streams.push(...stream);
    }
  }

  // ── 2. iframes ────────────────────────────────────────────────────────────
  const iframeSrcs = [];
  $("iframe[src], iframe[data-src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src) iframeSrcs.push(src);
  });

  // Also find iframes in JS
  const jsIframes = html.match(/['"](https?:\/\/[^'"]*(?:embed|player|video)[^'"]*)['"]/gi) || [];
  for (const m of jsIframes) {
    const u = m.replace(/['"]/g, "");
    if (u.includes("ok.ru") || u.includes("embed") || u.includes("player")) {
      iframeSrcs.push(u);
    }
  }

  for (const src of [...new Set(iframeSrcs)]) {
    if (src.includes("ok.ru")) {
      const resolved = await resolveOkRu(src);
      if (resolved) streams.push(...resolved);
    } else {
      // Generic iframe - fetch and look for video
      const iHtml = await fetchPage(src, pageUrl);
      if (iHtml) {
        const mp4 = iHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
        const m3u8 = iHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (mp4) streams.push({ url: mp4[0], title: "Video" });
        else if (m3u8) streams.push({ url: m3u8[0], title: "HLS Stream" });
      }
    }
  }

  // ── 3. Direct MP4 / m3u8 ─────────────────────────────────────────────────
  const mp4s = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi) || [];
  const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];

  for (const url of [...new Set(mp4s)]) {
    if (!streams.find((s) => s.url === url))
      streams.push({ url, title: "Direct MP4" });
  }
  for (const url of [...new Set(m3u8s)]) {
    if (!streams.find((s) => s.url === url))
      streams.push({ url, title: "HLS Stream" });
  }

  return streams;
}

// ── ok.ru resolver ────────────────────────────────────────────────────────────
// ok.ru provides a metadata API we can use to get direct video URLs
async function resolveOkRu(url) {
  try {
    // Normalise: get video ID
    const idMatch = url.match(/\/video(?:embed)?\/(\d+)/);
    if (!idMatch) return null;
    const videoId = idMatch[1];

    console.log("[OK.RU] Resolving video ID:", videoId);

    // Fetch the embed page
    const embedUrl = `https://ok.ru/videoembed/${videoId}`;
    const html = await fetchPage(embedUrl, url);
    if (!html) return null;

    // ok.ru stores video data in a JSON blob called "flashvars" or "data-options"
    const dataMatch =
      html.match(/data-options="([^"]+)"/) ||
      html.match(/flashvars="([^"]+)"/);

    if (dataMatch) {
      const raw = dataMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      let data;
      try { data = JSON.parse(decodeURIComponent(raw)); } catch {
        try { data = JSON.parse(raw); } catch { }
      }

      if (data?.flashvars?.metadata) {
        const meta = JSON.parse(data.flashvars.metadata);
        return extractOkRuVideos(meta);
      }
      if (data?.metadata) {
        return extractOkRuVideos(data.metadata);
      }
    }

    // Alternative: look for JSON in a script tag
    const scriptMatch = html.match(/\"videos\"\s*:\s*(\[[\s\S]*?\])/);
    if (scriptMatch) {
      const videos = JSON.parse(scriptMatch[1]);
      return videos
        .filter((v) => v.url)
        .map((v) => ({
          url: v.url,
          title: `ok.ru (${v.name || v.type || "video"})`,
        }));
    }

    // Last resort: return the embed URL as an external link Stremio can open
    return [{
      externalUrl: `https://ok.ru/video/${videoId}`,
      title: "Open on ok.ru",
    }];

  } catch (err) {
    console.error("[OK.RU ERROR]", err.message);
    return null;
  }
}

function extractOkRuVideos(meta) {
  const streams = [];
  const videos = meta?.videos || [];
  // Quality order: highest first
  const qualityOrder = ["full hd", "hd", "sd", "low", "lowest", "mobile"];
  const sorted = [...videos].sort((a, b) => {
    const ai = qualityOrder.indexOf((a.name || "").toLowerCase());
    const bi = qualityOrder.indexOf((b.name || "").toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const v of sorted) {
    if (v.url) {
      streams.push({
        url: v.url,
        title: `ok.ru (${v.name || "video"})`,
        behaviorHints: { notWebReady: false },
      });
    }
  }
  return streams;
}

module.exports = { getStreams };
