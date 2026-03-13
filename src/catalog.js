const axios = require("axios");
const NodeCache = require("node-cache");

const BASE_URL = "https://khmerdubbed.com";
const cache = new NodeCache({ stdTTL: 3600 }); // cache 1 hour

// WordPress REST API - most WP movie sites use custom post types
// Common post types: 'movies', 'tvshows', 'series', or just 'post' with categories
// We try multiple approaches and fall back gracefully

const WP_API = `${BASE_URL}/wp-json/wp/v2`;

// Map our type to likely WP post types (adjust if needed after inspecting your site)
const POST_TYPE_MAP = {
  movie: ["movies", "movie", "films", "post"],
  series: ["tvshows", "tv-shows", "series", "episodes", "post"],
};

async function discoverPostType(type) {
  const cacheKey = `posttype_${type}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const candidates = POST_TYPE_MAP[type];
  for (const pt of candidates) {
    try {
      const url = `${WP_API}/${pt}?per_page=1`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
        console.log(`[DISCOVER] Found post type: ${pt} for ${type}`);
        cache.set(cacheKey, pt);
        return pt;
      }
    } catch {
      // try next
    }
  }

  // Fallback: use 'post' with category filtering
  console.log(`[DISCOVER] Falling back to 'post' for ${type}`);
  cache.set(cacheKey, "post");
  return "post";
}

async function fetchPosts(type, extra = {}) {
  const postType = await discoverPostType(type);
  const skip = parseInt(extra.skip || 0);
  const page = Math.floor(skip / 20) + 1;
  const search = extra.search || "";

  let url = `${WP_API}/${postType}?per_page=20&page=${page}&_embed=true`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  // If using generic 'post', try to filter by category matching type
  if (postType === "post" && !search) {
    const catId = await getCategoryId(type);
    if (catId) url += `&categories=${catId}`;
  }

  const cacheKey = `catalog_${type}_${page}_${search}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(url, { timeout: 10000 });
    cache.set(cacheKey, res.data);
    return res.data;
  } catch (err) {
    console.error("[FETCH POSTS]", err.message);
    return [];
  }
}

async function getCategoryId(type) {
  const cacheKey = `catid_${type}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const keywords = type === "movie"
    ? ["movie", "movies", "film", "films"]
    : ["series", "tv", "tvshow", "drama"];

  try {
    const res = await axios.get(`${WP_API}/categories?per_page=50`, { timeout: 8000 });
    const categories = res.data;
    for (const kw of keywords) {
      const match = categories.find(
        (c) => c.slug.includes(kw) || c.name.toLowerCase().includes(kw)
      );
      if (match) {
        cache.set(cacheKey, match.id);
        return match.id;
      }
    }
  } catch {}

  cache.set(cacheKey, null);
  return null;
}

function buildMeta(post, type) {
  // Extract thumbnail
  let poster = null;
  try {
    poster =
      post._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
      post.jetpack_featured_media_url ||
      null;
  } catch {}

  // Clean title
  const title = post.title?.rendered
    ? post.title.rendered.replace(/<[^>]+>/g, "")
    : "Unknown";

  // Description
  const description = post.excerpt?.rendered
    ? post.excerpt.rendered.replace(/<[^>]+>/g, "").trim()
    : "";

  // Build ID: prefix with our namespace + WP post ID + slug
  const id = `khmerdubbed:${post.id}`;

  const meta = {
    id,
    type,
    name: title,
    poster,
    description,
    background: poster,
    // Release year from date
    releaseInfo: post.date ? post.date.substring(0, 4) : undefined,
    // Link back to site
    website: post.link,
  };

  return meta;
}

async function getCatalog(type, extra = {}) {
  const posts = await fetchPosts(type, extra);
  return posts.map((p) => buildMeta(p, type));
}

async function getMeta(type, id) {
  // id format: khmerdubbed:12345
  const wpId = id.split(":")[1];
  if (!wpId) return null;

  const cacheKey = `meta_${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const postType = await discoverPostType(type);

  try {
    const res = await axios.get(`${WP_API}/${postType}/${wpId}?_embed=true`, {
      timeout: 10000,
    });
    const post = res.data;
    const meta = buildMeta(post, type);

    // For series, try to extract episodes (WP REST API or custom endpoint)
    if (type === "series") {
      meta.videos = await getEpisodes(post);
    }

    cache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.error("[GET META]", err.message);
    return null;
  }
}

async function getEpisodes(post) {
  // Episodes may be stored in post content as links, or as child posts
  // Try child posts first
  const wpId = post.id;
  const videos = [];

  try {
    const postType = "episodes"; // common custom post type
    const res = await axios.get(
      `${WP_API}/${postType}?parent=${wpId}&per_page=100&orderby=date&order=asc`,
      { timeout: 8000 }
    );

    if (Array.isArray(res.data) && res.data.length > 0) {
      res.data.forEach((ep, i) => {
        const title = ep.title?.rendered?.replace(/<[^>]+>/g, "") || `Episode ${i + 1}`;
        // Parse season/episode from title if possible
        const epMatch = title.match(/[Ee]p(?:isode)?\s*(\d+)/);
        const seasonMatch = title.match(/[Ss](?:eason)?\s*(\d+)/);
        videos.push({
          id: `khmerdubbed:${ep.id}`,
          title,
          season: seasonMatch ? parseInt(seasonMatch[1]) : 1,
          episode: epMatch ? parseInt(epMatch[1]) : i + 1,
          released: ep.date,
        });
      });
      return videos;
    }
  } catch {}

  // Fallback: treat the series post itself as a single video
  videos.push({
    id: `khmerdubbed:${wpId}`,
    title: post.title?.rendered?.replace(/<[^>]+>/g, "") || "Episode 1",
    season: 1,
    episode: 1,
    released: post.date,
  });

  return videos;
}

module.exports = { getCatalog, getMeta };
