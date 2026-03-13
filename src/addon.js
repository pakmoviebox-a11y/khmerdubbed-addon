const { addonBuilder } = require("stremio-addon-sdk");
const { getCatalog, getMeta } = require("./catalog");
const { getStreams } = require("./streams");

const manifest = {
  id: "com.khmerdubbed.addon",
  version: "1.0.0",
  name: "Khmer Dubbed",
  description: "Watch Khmer dubbed movies and series from khmerdubbed.com",
  logo: "https://khmerdubbed.com/wp-content/uploads/logo.png",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "khmerdubbed-movies",
      name: "Khmer Dubbed Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
      ],
    },
    {
      type: "series",
      id: "khmerdubbed-series",
      name: "Khmer Dubbed Series",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
      ],
    },
  ],
  behaviorHints: {
    adult: false,
    p2p: false,
  },
};

const builder = new addonBuilder(manifest);

// CATALOG handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log(`[CATALOG] type=${type} id=${id}`, extra);
  try {
    const metas = await getCatalog(type, extra);
    return { metas };
  } catch (err) {
    console.error("[CATALOG ERROR]", err.message);
    return { metas: [] };
  }
});

// META handler
builder.defineMetaHandler(async ({ type, id }) => {
  console.log(`[META] type=${type} id=${id}`);
  try {
    const meta = await getMeta(type, id);
    return { meta };
  } catch (err) {
    console.error("[META ERROR]", err.message);
    return { meta: null };
  }
});

// STREAM handler
builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[STREAM] type=${type} id=${id}`);
  try {
    const streams = await getStreams(type, id);
    return { streams };
  } catch (err) {
    console.error("[STREAM ERROR]", err.message);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
