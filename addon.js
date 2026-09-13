const { addonBuilder } = require('stremio-addon-sdk')
const { getCatalogue, getSectionAccueil, getAnimeMeta, getStreams } = require('./scraper')

const manifest = {
  id: 'fr.animesama.stremio',
  version: '1.2.1',
  name: 'Anime-Sama',
  description: 'Regardez les animes de Anime-Sama en VOSTFR et VF directement dans Stremio.',
  logo: 'https://anime-sama.fr/favicon.ico',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  idPrefixes: ['as:'],
  catalogs: [
    {
      type: 'series',
      id: 'animesama-recents',
      name: 'Anime-Sama — Derniers épisodes',
    },
    {
      type: 'series',
      id: 'animesama-classiques',
      name: 'Anime-Sama — Les classiques',
    },
    {
      type: 'series',
      id: 'animesama-pepites',
      name: 'Anime-Sama — Pépites',
    },
    {
      // Catalogue dédié à la recherche : isRequired le rend invisible dans
      // Discover, il ne répond qu'aux requêtes de la barre de recherche.
      //
      // extraSupported/extraRequired sont l'ancienne forme du même contrat.
      // Le SDK ne les dérive pas de `extra`, et c'est pourtant sur eux que
      // Stremio v4 se fonde pour choisir les catalogues à interroger depuis
      // la barre de recherche : sans eux, ce catalogue n'est jamais appelé.
      type: 'series',
      id: 'animesama-recherche',
      name: 'Anime-Sama — Recherche',
      extra: [{ name: 'search', isRequired: true }],
      extraSupported: ['search'],
      extraRequired: ['search'],
    },
  ],
  behaviorHints: {
    adult: false,
    configurable: false,
  },
}

const builder = new addonBuilder(manifest)

// === CATALOG ===
// Les trois catalogues thématiques proviennent des sections de la page
// d'accueil, servies par une seule requête mutualisée. La recherche garde son
// propre catalogue et interroge /catalogue/?search=, seul endroit du site qui
// sache chercher.
const SECTIONS_PAR_CATALOGUE = {
  'animesama-recents': 'recents',
  'animesama-classiques': 'classiques',
  'animesama-pepites': 'pepites',
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'series') return { metas: [] }

  const search = extra?.search || ''
  console.log(`[catalog] ${id}${search ? ` search="${search}"` : ''}`)

  try {
    // La recherche n'est servie que par son catalogue dédié : y répondre
    // depuis les trois catalogues thématiques ferait apparaître les mêmes
    // résultats quatre fois dans Stremio.
    if (search) {
      if (id !== 'animesama-recherche') return { metas: [] }
      const metas = await getCatalogue(search)
      return { metas, cacheMaxAge: 600 }
    }

    const section = SECTIONS_PAR_CATALOGUE[id]
    if (!section) return { metas: [] }

    const metas = await getSectionAccueil(section)
    // Borne la rétention côté Stremio, qui garderait sinon un catalogue périmé
    return { metas, cacheMaxAge: 600 }
  } catch (err) {
    console.error(`[catalog] Erreur (${id}):`, err.message)
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
