const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./src/addon");

const PORT = process.env.PORT || 7000;

serveHTTP(addonInterface, { port: PORT });

console.log(`
╔════════════════════════════════════════════╗
║     Khmer Dubbed Stremio Addon             ║
╠════════════════════════════════════════════╣
║  Running at: http://localhost:${PORT}         ║
║                                            ║
║  Install URL for Stremio:                  ║
║  http://localhost:${PORT}/manifest.json       ║
╚════════════════════════════════════════════╝
`);
