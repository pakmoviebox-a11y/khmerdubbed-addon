const axios = require("axios");
const cheerio = require("cheerio");
const NodeCache = require("node-cache");

const BASE_URL = "https://khmerdubbed.com";
const WP_API = `${BASE_URL}/wp-json/wp/v2`;
const cache = new NodeCache({ stdTTL: 1800 }); // 30 min cache for streams

// ─── MAIN ENTRY ──────────────────────────────────────────────────────────────

async function getStreams(type, id) {
  const cacheKey = `streams_${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const wpId = id.split(":")[1];
  if (!wpId) return [];

  // 1. Get the post permalink from WP REST API
  const postUrl = await getPostUrl(wpId);
  if (!postUrl) return [];

  // 2. Scrape the page HTML
  const html = await fetchPage(postUrl);
  if (!html) return [];

  // 3. Extract video URLs from the page
  const streams = await extractStreams(html, postUrl);

  if (streams.length > 0) {
    cache.set(cacheKey, streams);
  }

  return streams;
}

// ─── FETCH POST URL ───────────────────────────────────────────────────────────

async function getPostUrl(wpId) {
  // Try multiple post types
  const postTypes = ["movies", "movie", "tvshows", "series", "episodes", "post"];
  for (const pt of postTypes) {
    try {
      const res = await axios.get(`${WP_API}/${pt}/${wpId}`, { timeout: 8000 });
      if (res.data?.link) return res.data.link;
    } catch {}
  }
  return null;
}

// ─── FETCH PAGE ───────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": BASE_URL,
      },
    });
    return res.data;
  } catch (err) {
    console.error("[FETCH PAGE]", url, err.message);
    return null;
  }
}

// ─── EXTRACT STREAMS ─────────────────────────────────────────────────────────

async function extractStreams(html, pageUrl) {
  const streams = [];
  const $ = cheerio.load(html);

  // ── 1. Direct MP4 / video src ──────────────────────────────────────────────
  $("video source, video[src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src && src.match(/\.mp4(\?|$)/i)) {
      streams.push({
        url: src,
        title: "Direct MP4",
        behaviorHints: { notWebReady: false },
      });
    }
  });

  // ── 2. Scan page HTML for direct MP4 URLs ─────────────────────────────────
  const mp4Matches = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi) || [];
  for (const url of [...new Set(mp4Matches)]) {
    if (!streams.find((s) => s.url === url)) {
      streams.push({ url, title: "Video (MP4)" });
    }
  }

  // ── 3. iframes (embedded players) ─────────────────────────────────────────
  const iframeSrcs = [];
  $("iframe").each((_, el) => {
    const src =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src");
    if (src) iframeSrcs.push(src);
  });

  // Also scan for iframe srcs in JS strings
  const jsIframes =
    html.match(/(?:src|iframe)['":\s]+['"](https?:\/\/[^\s'"<>]+)['"]/gi) || [];
  for (const match of jsIframes) {
    const urlMatch = match.match(/https?:\/\/[^\s'"<>]+/);
    if (urlMatch) iframeSrcs.push(urlMatch[0]);
  }

  // Resolve each iframe
  for (const src of [...new Set(iframeSrcs)]) {
    const resolved = await resolveEmbed(src, pageUrl);
    if (resolved.length > 0) streams.push(...resolved);
  }

  // ── 4. Known JS player variables ──────────────────────────────────────────
  const jwMatch = html.match(/file\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/gi) || [];
  for (const m of jwMatch) {
    const urlMatch = m.match(/https?:\/\/[^\s'"]+/);
    if (urlMatch && !streams.find((s) => s.url === urlMatch[0])) {
      streams.push({ url: urlMatch[0], title: "JW Player Stream" });
    }
  }

  // HLS m3u8
  const m3u8Matches = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
  for (const url of [...new Set(m3u8Matches)]) {
    if (!streams.find((s) => s.url === url)) {
      streams.push({ url, title: "HLS Stream" });
    }
  }

  console.log(`[STREAMS] Found ${streams.length} stream(s) on page: ${pageUrl}`);
  return streams;
}

// ─── RESOLVE EMBED URLS ───────────────────────────────────────────────────────

async function resolveEmbed(embedUrl, referer) {
  const streams = [];

  try {
    // ── Streamtape ────────────────────────────────────────────────────────────
    if (embedUrl.includes("streamtape.com") || embedUrl.includes("streamtape.to")) {
      const stream = await resolveStreamtape(embedUrl);
      if (stream) streams.push({ url: stream, title: "Streamtape" });
      return streams;
    }

    // ── Doodstream ────────────────────────────────────────────────────────────
    if (embedUrl.includes("dood.") || embedUrl.includes("doodstream")) {
      const stream = await resolveDoodstream(embedUrl);
      if (stream) streams.push({ url: stream, title: "Doodstream" });
      return streams;
    }

    // ── Fembed / Fembad ───────────────────────────────────────────────────────
    if (embedUrl.includes("fembed.com") || embedUrl.includes("fembad.org")) {
      const stream = await resolveFembed(embedUrl);
      if (stream) streams.push({ url: stream, title: "Fembed" });
      return streams;
    }

    // ── Filemoon ──────────────────────────────────────────────────────────────
    if (embedUrl.includes("filemoon")) {
      const stream = await resolveFilemoon(embedUrl);
      if (stream) streams.push({ url: stream, title: "Filemoon" });
      return streams;
    }

    // ── Generic: fetch the embed page and look for video ──────────────────────
    const html = await fetchPage(embedUrl);
    if (html) {
      const mp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      const m3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
      if (mp4) streams.push({ url: mp4[0], title: "Embedded MP4" });
      else if (m3u8) streams.push({ url: m3u8[0], title: "Embedded HLS" });
    }
  } catch (err) {
    console.error("[RESOLVE EMBED]", embedUrl, err.message);
  }

  return streams;
}

// ─── STREAMTAPE RESOLVER ──────────────────────────────────────────────────────

async function resolveStreamtape(url) {
  try {
    const html = await fetchPage(url);
    if (!html) return null;
    // Streamtape uses a JS obfuscated URL split across two variables
    const match1 = html.match(/robotlink\)\.\s*innerHTML\s*=\s*['"]([^'"]+)['"]/);
    const match2 = html.match(/\+\s*\(['"]([^'"]+)['"]\)/);
    if (match1 && match2) {
      const part1 = match1[1];
      const part2 = match2[1];
      return `https:${part1}${part2}`;
    }
    // Alternative pattern
    const altMatch = html.match(/document\.getElementById\('norobotlink'\).*?innerHTML\s*=\s*(['"])(.*?)\1/s);
    if (altMatch) return `https:${altMatch[2]}`;
  } catch {}
  return null;
}

// ─── DOODSTREAM RESOLVER ──────────────────────────────────────────────────────

async function resolveDoodstream(url) {
  try {
    // Convert /e/ to /d/ for the page
    const pageUrl = url.replace("/e/", "/d/");
    const html = await fetchPage(pageUrl);
    if (!html) return null;

    const passMatch = html.match(/pass_md5\/([^'"]+)/);
    if (!passMatch) return null;

    const passUrl = `https://dood.to/pass_md5/${passMatch[1]}`;
    const passRes = await axios.get(passUrl, {
      headers: { Referer: pageUrl },
      timeout: 8000,
    });

    const token = html.match(/token=([^'"&]+)/)?.[1] || "abc123";
    const ts = Date.now();
    return `${passRes.data}${token}?token=${token}&expiry=${ts}`;
  } catch {}
  return null;
}

// ─── FEMBED RESOLVER ─────────────────────────────────────────────────────────

async function resolveFembed(url) {
  try {
    const id = url.split("/").pop();
    const apiUrl = `${new URL(url).origin}/api/source/${id}`;
    const res = await axios.post(
      apiUrl,
      {},
      {
        headers: { Referer: url },
        timeout: 8000,
      }
    );
    const files = res.data?.data;
    if (Array.isArray(files) && files.length > 0) {
      // Pick highest quality
      files.sort((a, b) => parseInt(b.label) - parseInt(a.label));
      return files[0].file;
    }
  } catch {}
  return null;
}

// ─── FILEMOON RESOLVER ────────────────────────────────────────────────────────

async function resolveFilemoon(url) {
  try {
    const html = await fetchPage(url);
    if (!html) return null;
    const m3u8 = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    return m3u8 ? m3u8[0] : null;
  } catch {}
  return null;
}

module.exports = { getStreams };
