const { serveHTTP } = require('stremio-addon-sdk')
const addonInterface = require('./addon')

const PORT = process.env.PORT || 7000

serveHTTP(addonInterface, { port: PORT })

console.log(`
╔════════════════════════════════════════╗
║       Anime-Sama Stremio Addon         ║
╠════════════════════════════════════════╣
║  Manifest : http://localhost:${PORT}/manifest.json
║  Pour ajouter dans Stremio :
║  http://localhost:${PORT}/manifest.json
╚════════════════════════════════════════╝
`)
