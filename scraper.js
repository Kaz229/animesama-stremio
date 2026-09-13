const cheerio = require('cheerio')
const https = require('https')

// IPs résolues via DoH pour contourner le blocage DNS de l'ISP
const DNS_MAP = {
  'anime-sama.to': '104.26.12.154',
}

// Nombre de redirections suivies avant d'abandonner : sans borne, un site
// qui se redirige vers lui-même ferait récurser httpsGet indéfiniment.
const MAX_REDIRECTIONS = 5

// Requête HTTPS avec IP forcée pour contourner le blocage DNS.
// `servername` porte le vrai nom d'hôte, la validation du certificat reste
// donc pleinement fonctionnelle malgré la connexion par IP.
function httpsGet(url, redirectionsRestantes = MAX_REDIRECTIONS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    const ip = DNS_MAP[hostname] || hostname
    const options = {
      hostname: ip,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      servername: hostname,
      headers: {
        'Host': hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    }
    const req = https.get(options, res => {
      // Gère les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirectionsRestantes <= 0) {
          return reject(new Error(`trop de redirections pour ${url}`))
        }
        const loc = res.headers.location
        const newUrl = loc.startsWith('http') ? loc : `https://${hostname}${loc}`
        return resolve(httpsGet(newUrl, redirectionsRestantes - 1))
      }
      // Une erreur HTTP renvoyait jusqu'ici sa page d'erreur comme si c'était
      // le contenu attendu : le parseur n'y trouvait rien et l'échec passait
      // pour un résultat vide. Le code de statut est porté par l'erreur, les
      // appelants qui sondent une ressource optionnelle pouvant le consulter.
      if (res.statusCode >= 400) {
        res.resume()
        const err = new Error(`HTTP ${res.statusCode} sur ${url}`)
        err.statusCode = res.statusCode
        return reject(err)
      }
      // Sans encodage déclaré, une lettre accentuée à cheval sur deux paquets
      // TCP est convertie en deux moitiés invalides
      res.setEncoding('utf8')
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

const BASE_URL = 'https://anime-sama.to'
const CATALOGUE_URL = `${BASE_URL}/catalogue/`

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': BASE_URL,
}

// Cache simple en mémoire
const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function getCached(key) {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data
  return null
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() })
}

async function fetchPage(url) {
  const cached = getCached(url)
  if (cached) return cached
  const data = await httpsGet(url)
  setCache(url, data)
  return data
}

// Types de contenu à conserver dans le catalogue.
// Le site mélange animés et scans (mangas à lire) ; seuls les premiers ont des épisodes.
const TYPES_VIDEO = ['anime', 'film']

// Lit le type d'une carte du catalogue (`<p class="info-value">Anime, Scans</p>`)
// et dit si elle correspond à du contenu regardable.
function estContenuVideo($card) {
  const brut = $card.find('.info-value').first().text().trim().toLowerCase()
  // Pas de marqueur : on garde la carte plutôt que de perdre un animé valide
  if (!brut) return true
  const types = brut.split(',').map(t => t.trim())
  return types.some(t => TYPES_VIDEO.includes(t))
}

// Extrait le slug d'un lien de fiche, ou null si le lien ne pointe pas vers une fiche
// Le slug est le premier segment après /catalogue/. Les fiches du catalogue
// s'arrêtent là (/catalogue/07-ghost) tandis que les cartes de l'accueil
// poussent jusqu'à la saison et la langue (/catalogue/bleach/saison2-4/vostfr/).
function slugDepuisHref(href) {
  const match = (href || '').match(/\/catalogue\/([^/?#]+)/)
  if (!match) return null
  const slug = match[1]
  return slug && slug !== 'catalogue' ? slug : null
}

function versEntree(slug, title, poster) {
  return {
    id: `as:${slug}`,
    type: 'series',
    name: title,
    poster: poster.startsWith('http') ? poster : BASE_URL + poster,
    slug,
  }
}

// Récupère la liste des animes du catalogue
async function getCatalogue(search = '', genre = '', skip = 0) {
  let url = CATALOGUE_URL
  if (search) url += `?search=${encodeURIComponent(search)}`

  const html = await fetchPage(url)
  const $ = cheerio.load(html)
  const results = []

  const cards = $('.catalog-card')

  if (cards.length) {
    cards.each((_, el) => {
      const $card = $(el)
      const slug = slugDepuisHref($card.find('a[href*="/catalogue/"]').first().attr('href'))
      if (!slug) return
      if (!estContenuVideo($card)) return

      const img = $card.find('img').first()
      const title = (img.attr('alt') || $card.find('.card-title').first().text() || '').trim()
      const poster = img.attr('src') || img.attr('data-src') || ''

      if (title) results.push(versEntree(slug, title, poster))
    })
  } else {
    // Repli si la mise en page du site change : on reprend tous les liens de fiche,
    // sans filtrage de type possible
    console.warn('[scraper] aucune .catalog-card trouvée, repli sur les liens bruts')
    $('a[href*="/catalogue/"]').each((_, el) => {
      const slug = slugDepuisHref($(el).attr('href'))
      if (!slug) return

      const img = $(el).find('img')
      const title = (img.attr('alt') || $(el).text() || '').trim()
      const poster = img.attr('src') || img.attr('data-src') || ''

      if (title) results.push(versEntree(slug, title, poster))
    })
  }

  // Déduplique par slug
  const seen = new Set()
  const deduped = results.filter(r => {
    if (seen.has(r.slug)) return false
    seen.add(r.slug)
    return true
  })

  return deduped.slice(skip, skip + 100)
}

// === Sections de la page d'accueil ===
//
// L'accueil regroupe tout ce qu'on expose en catalogues dans un seul document,
// d'où une seule requête pour les trois sections, mutualisée par fetchPage().
//
// Deux formes de cartes y cohabitent :
//   - carte complète (.catalog-card), identique à celle du catalogue, dont le
//     type se lit dans .info-value ;
//   - carte compacte, sans .info-value mais porteuse d'un badge explicite
//     (.badge-text vaut Anime, Scans, Webtoon ou Manga).
const SECTIONS_ACCUEIL = {
  recents: '#containerAjoutsAnimes',
  classiques: '#containerClassiques',
  pepites: '#containerPepites',
}

function estCarteAnime($carte) {
  const badge = $carte.find('.badge-text').first().text().trim().toLowerCase()
  if (badge) return badge === 'anime'
  return estContenuVideo($carte)
}

async function getSectionAccueil(section) {
  const selecteur = SECTIONS_ACCUEIL[section]
  if (!selecteur) return []

  const html = await fetchPage(BASE_URL + '/')
  const $ = cheerio.load(html)
  const results = []

  $(`${selecteur} a[href*="/catalogue/"]`).each((_, el) => {
    const $carte = $(el)
    const slug = slugDepuisHref($carte.attr('href'))
    if (!slug) return
    if (!estCarteAnime($carte)) return

    const img = $carte.find('img.card-image').first()
    const title = (img.attr('alt') || $carte.find('.card-title').first().text() || '').trim()
    const poster = img.attr('src') || img.attr('data-src') || ''

    if (title) results.push(versEntree(slug, title, poster))
  })

  // Un même animé peut apparaître plusieurs fois dans les ajouts récents,
  // une entrée par épisode publié
  const vus = new Set()
  return results.filter(r => {
    if (vus.has(r.slug)) return false
    vus.add(r.slug)
    return true
  })
}

// Récupère les métadonnées d'un anime
async function getAnimeMeta(slug) {
  const cached = getCached(`meta:${slug}`)
  if (cached) return cached

  const url = `${BASE_URL}/catalogue/${slug}/`
  const html = await fetchPage(url)
  const $ = cheerio.load(html)

  const title = $('h1').first().text().trim() ||
                $('meta[property="og:title"]').attr('content') || slug

  // La fiche ne porte ni og:description ni meta description : le synopsis vit
  // dans .clamp-synopsis, présent une seule fois par page. Les anciens
  // sélecteurs ne trouvaient rien, toutes les fiches sortaient sans résumé.
  const description = $('.clamp-synopsis').first().text().trim() ||
                      $('meta[property="og:description"]').attr('content') || ''

  const poster = $('meta[property="og:image"]').attr('content') ||
                 $('img.poster, img.cover, .cover img').first().attr('src') || ''

  // Les genres du titre sont les .genre-pill. Ne pas confondre avec les
  // .genre-tag, qui appartiennent aux cartes de recommandation en bas de page
  // et mélangeraient les genres d'autres animés à ceux-ci.
  const genres = $('.genre-pill')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)

  // Détecte les saisons via panneauAnime("Saison 1", "saison1/vostfr")
  // dans le JS de la page. Les sections scan/vf, film/vostfr, oav/vostfr,
  // saison1hs/vostfr et kai/vostfr ne sont volontairement pas retenues.
  const numeros = new Set()
  const panneauRegex = /panneauAnime\s*\(\s*["'][^"']*["']\s*,\s*["']([^"']+)["']\s*\)/g
  let pm
  while ((pm = panneauRegex.exec(html)) !== null) {
    const m = pm[1].match(/^saison(\d+)\/(vostfr|vf|vkr)$/i)
    if (m) numeros.add(parseInt(m[1]))
  }

  // La fiche ne déclare que la VOSTFR : la VF existe pour beaucoup de titres
  // mais n'apparaît nulle part dans le HTML. On la découvre en sondant
  // saison{N}/{langue}/episodes.js, dont le résultat est mis en cache.
  const seasons = await Promise.all(
    [...numeros].sort((a, b) => a - b).map(async num => {
      const langs = []
      for (const code of LANGUES_VIDEO) {
        const eps = await getEpisodes(slug, num, code).catch(() => [])
        if (eps.length) langs.push({ code, episodes: eps.length })
      }
      return { num, langs }
    })
  )

  const meta = {
    id: `as:${slug}`,
    type: 'series',
    name: title,
    description,
    poster: poster.startsWith('http') ? poster : (poster ? BASE_URL + poster : ''),
    genres,
    slug,
    seasons: seasons.filter(s => s.langs.length),
  }

  setCache(`meta:${slug}`, meta)
  return meta
}

// Parse episodes.js.
//
// Contrairement à ce que le nom des variables laisse croire, `eps<N>` ne
// désigne pas l'épisode N mais **l'hébergeur N** : chaque tableau liste tous
// les épisodes de la saison chez cet hébergeur, indexés par position.
//
//   var eps1 = ['lpayer/ep1', 'lpayer/ep2', ...]   // hébergeur 1
//   var eps2 = ['sibnet/ep1', 'sibnet/ep2', ...]   // hébergeur 2
//
// L'épisode N est donc la colonne N : [eps1[N-1], eps2[N-1], ...].
// Certaines saisons annoncées mais non publiées contiennent des gabarits
// vides : https://video.sibnet.ru/shell.php?videoid=, .../embed-.html,
// https://sendvid.com/embed/, https://vk.com/video_ext.php?oid=&hd=3
function estUrlExploitable(u) {
  if (!u || !u.startsWith('http')) return false
  if (/[=/]$/.test(u)) return false      // identifiant absent en fin d'URL
  if (/=&/.test(u)) return false         // paramètre vide suivi d'un autre
  if (/embed-\./.test(u)) return false   // embed-.html
  return true
}

function parseEpisodesJs(jsContent) {
  const listes = []
  const regex = /var\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/g
  let match
  while ((match = regex.exec(jsContent)) !== null) {
    const urls = [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    listes.push({ hebergeur: parseInt(match[1]), urls })
  }
  if (!listes.length) return []

  // L'hébergeur le plus complet donne le nombre d'épisodes de la saison
  listes.sort((a, b) => a.hebergeur - b.hebergeur)
  const nbEpisodes = Math.max(...listes.map(l => l.urls.length))

  const episodes = []
  for (let i = 0; i < nbEpisodes; i++) {
    // Un hébergeur peut être incomplet : on ignore les trous plutôt que
    // de décaler la numérotation des épisodes suivants
    const urls = listes.map(l => l.urls[i]).filter(estUrlExploitable)
    if (urls.length) episodes.push({ episode: i + 1, urls })
  }
  return episodes
}

const LANGUES_VIDEO = ['vostfr', 'vf', 'vkr']

async function getEpisodes(slug, season, lang = 'vostfr') {
  // Empêche de composer une URL vers la section scans (chapitres de manga)
  if (!LANGUES_VIDEO.includes(String(lang).toLowerCase())) {
    console.warn(`[scraper] langue non vidéo ignorée : ${lang}`)
    return []
  }

  const key = `eps:${slug}:${season}:${lang}`
  const cached = getCached(key)
  if (cached) return cached

  const url = `${BASE_URL}/catalogue/${slug}/saison${season}/${lang}/episodes.js`
  try {
    const episodes = parseEpisodesJs(await httpsGet(url))
    setCache(key, episodes)
    return episodes
  } catch (err) {
    // getAnimeMeta sonde chaque langue pour découvrir celles qui existent :
    // un 404 y est une réponse normale, pas une panne. On la mémorise pour
    // ne pas resonder à chaque requête.
    if (err.statusCode === 404) {
      setCache(key, [])
      return []
    }
    console.error(`[scraper] Erreur episodes.js ${url}:`, err.message)
    return []
  }
}

// Extrait l'URL vidéo directe depuis une URL de player embed
async function extractStreamUrl(embedUrl) {
  try {
    const { extractVideoUrl } = require('./extractor')
    const url = await extractVideoUrl(embedUrl)
    if (url) return url
  } catch (err) {
    console.error('[scraper] Extraction échouée pour', embedUrl, ':', err.message)
  }
  // Fallback : retourne l'embed tel quel (non lisible par Stremio)
  return null
}

// Récupère les streams pour un épisode donné
// Hébergeurs qui refusent la requête sans le Referer de leur page embed.
// Pour eux seulement on passe notWebReady + proxyHeaders, ce qui fait relayer
// le flux par le serveur interne de Stremio. Les autres — Ansembed en tête —
// servent leurs segments sans condition : les proxifier priverait le lecteur
// de la lecture HLS native pour rien.
const HEBERGEURS_AVEC_REFERER = ['sibnet.ru']

function construireBehaviorHints(embedUrl) {
  if (!HEBERGEURS_AVEC_REFERER.some(h => embedUrl.toLowerCase().includes(h))) {
    return { notWebReady: false }
  }
  return {
    notWebReady: true,
    proxyHeaders: {
      request: {
        'Referer': embedUrl,
        'User-Agent': headers['User-Agent'],
      },
    },
  }
}

async function getStreams(slug, season, episode, lang = 'vostfr') {
  const episodes = await getEpisodes(slug, season, lang)
  const ep = episodes.find(e => e.episode === episode)
  if (!ep) return []

  const streams = []

  // On n'essaie que les 3 premières sources pour limiter le temps de chargement
  for (const embedUrl of ep.urls.slice(0, 3)) {
    const url = await extractStreamUrl(embedUrl).catch(() => null)
    if (!url) continue
    const name = getPlayerName(embedUrl)
    streams.push({
      url,
      name: `AnimeSama ${lang.toUpperCase()}`,
      title: `${name} — Ep. ${episode}`,
      behaviorHints: construireBehaviorHints(embedUrl),
    })
  }

  return streams
}

// Comparaison en minuscules : le site écrit certains hôtes avec une majuscule
function getPlayerName(url) {
  const hote = url.toLowerCase()
  if (hote.includes('ansembed')) return 'Ansembed'
  if (hote.includes('sendvid')) return 'Sendvid'
  if (hote.includes('sibnet')) return 'Sibnet'
  if (hote.includes('vidmoly')) return 'Vidmoly'
  if (hote.includes('smoothpre')) return 'Smoothpre'
  if (hote.includes('uqload')) return 'Uqload'
  if (hote.includes('vudeo')) return 'Vudeo'
  if (hote.includes('streamtape')) return 'Streamtape'
  return 'Source'
}

module.exports = { getCatalogue, getSectionAccueil, getAnimeMeta, getEpisodes, getStreams, LANGUES_VIDEO }
