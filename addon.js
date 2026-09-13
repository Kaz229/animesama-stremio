const { addonBuilder } = require('stremio-addon-sdk')
const { getCatalogue, getAnimeMeta, getStreams } = require('./scraper')

const manifest = {
  id: 'fr.animesama.stremio',
  version: '1.1.0',
  name: 'Anime-Sama',
  description: 'Regardez les animes de Anime-Sama en VOSTFR et VF directement dans Stremio.',
  logo: 'https://anime-sama.fr/favicon.ico',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  idPrefixes: ['as:'],
  catalogs: [
    {
      type: 'series',
      id: 'animesama-vostfr',
      name: 'Anime-Sama VOSTFR',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
      ],
    },
    {
      type: 'series',
      id: 'animesama-vf',
      name: 'Anime-Sama VF',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
      ],
    },
  ],
  behaviorHints: {
    adult: false,
    configurable: false,
  },
}

const builder = new addonBuilder(manifest)

// === CATALOG ===
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'series') return { metas: [] }

  const search = extra?.search || ''
  const skip = parseInt(extra?.skip || '0')

  try {
    const metas = await getCatalogue(search, '', skip)
    // Borne la rétention côté Stremio, qui garderait sinon un catalogue périmé
    return { metas, cacheMaxAge: 600 }
  } catch (err) {
    console.error('[catalog] Erreur:', err.message)
    return { metas: [] }
  }
})

// === META ===
builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'series' || !id.startsWith('as:')) return { meta: null }

  const slug = id.replace('as:', '')

  try {
    const animeData = await getAnimeMeta(slug)

    // Construit les épisodes pour l'interface Stremio.
    // Le nombre d'épisodes vient désormais d'episodes.js, plus besoin d'en
    // générer un lot arbitraire dont l'essentiel ne renvoyait aucun stream.
    const videos = []
    for (const season of animeData.seasons) {
      for (const lang of season.langs) {
        for (let ep = 1; ep <= lang.episodes; ep++) {
          videos.push({
            id: `${id}:${season.num}:${ep}:${lang.code}`,
            title: `S${season.num} E${ep} ${lang.code.toUpperCase()}`,
            season: season.num,
            episode: ep,
          })
        }
      }
    }

    const meta = {
      id,
      type: 'series',
      name: animeData.name,
      description: animeData.description,
      poster: animeData.poster,
      genres: animeData.genres,
      videos,
    }

    return { meta, cacheMaxAge: 600 }
  } catch (err) {
    console.error('[meta] Erreur:', err.message)
    return { meta: null }
  }
})

// === STREAM ===
// L'ID d'épisode est au format : as:{slug}:{season}:{episode}:{lang}
builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'series' || !id.startsWith('as:')) return { streams: [] }

  // Format : as:naruto:1:1:vostfr
  const parts = id.split(':')
  if (parts.length < 5) return { streams: [] }

  const [, slug, seasonStr, episodeStr, lang] = parts
  const season = parseInt(seasonStr)
  const episode = parseInt(episodeStr)

  if (!slug || isNaN(season) || isNaN(episode)) return { streams: [] }

  try {
    const streams = await getStreams(slug, season, episode, lang || 'vostfr')
    console.log(`[stream] ${slug} S${season}E${episode} ${lang} → ${streams.length} stream(s)`)
    return { streams }
  } catch (err) {
    console.error('[stream] Erreur:', err.message)
    return { streams: [] }
  }
})

module.exports = builder.getInterface()
