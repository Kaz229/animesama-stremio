const { serveHTTP } = require('stremio-addon-sdk')
const addonInterface = require('./addon')

// 7000 est occupé par le récepteur AirPlay sur macOS : le défaut vise un port libre
const PORT = process.env.PORT || 7011

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
