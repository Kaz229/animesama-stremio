const axios = require('axios')
const cheerio = require('cheerio')
const https = require('https')

// IPs résolues via DoH pour contourner le blocage DNS de l'ISP
const DNS_MAP = {
  'anime-sama.to': '104.26.12.154',
}

// Requête HTTPS avec IP forcée pour contourner le blocage DNS
function httpsGet(url) {
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
      rejectUnauthorized: false,
    }
    const req = https.get(options, res => {
      // Gère les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location
        const newUrl = loc.startsWith('http') ? loc : `https://${hostname}${loc}`
        return resolve(httpsGet(newUrl))
      }
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
function slugDepuisHref(href) {
  const match = (href || '').match(/\/catalogue\/([^/]+)\/?$/)
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

// Récupère les métadonnées d'un anime
async function getAnimeMeta(slug) {
  const cached = getCached(`meta:${slug}`)
  if (cached) return cached

  const url = `${BASE_URL}/catalogue/${slug}/`
  const html = await fetchPage(url)
  const $ = cheerio.load(html)

  const title = $('h1').first().text().trim() ||
                $('meta[property="og:title"]').attr('content') || slug

  const description = $('meta[property="og:description"]').attr('content') ||
                      $('p.synopsis, p.description, .synopsis').first().text().trim() || ''

  const poster = $('meta[property="og:image"]').attr('content') ||
                 $('img.poster, img.cover, .cover img').first().attr('src') || ''

  const genres = []
  $('a[href*="/genre/"], a[href*="genre="]').each((_, el) => {
    const g = $(el).text().trim()
    if (g) genres.push(g)
  })

  // Détecte les saisons via panneauAnime("Saison 1", "saison1/vostfr") dans le JS de la page
  const seasons = []
  const panneauRegex = /panneauAnime\s*\(\s*["'][^"']*["']\s*,\s*["']([^"']+)["']\s*\)/g
  let pm
  while ((pm = panneauRegex.exec(html)) !== null) {
    const path = pm[1] // ex: "saison1/vostfr"
    const m = path.match(/saison(\d+)\/(vostfr|vf|vkr|scan)/i)
    if (!m) continue
    const num = parseInt(m[1])
    const lang = m[2].toLowerCase()
    const existing = seasons.find(s => s.num === num)
    if (existing) {
      if (!existing.langs.includes(lang)) existing.langs.push(lang)
    } else {
      seasons.push({ num, langs: [lang] })
    }
  }

  const meta = {
    id: `as:${slug}`,
    type: 'series',
    name: title,
    description,
    poster: poster.startsWith('http') ? poster : (poster ? BASE_URL + poster : ''),
    genres,
    slug,
    seasons: seasons.sort((a, b) => a.num - b.num),
  }

  setCache(`meta:${slug}`, meta)
  return meta
}

// Parse episodes.js — format : var eps1 = ['url1','url2']; var eps2 = [...]
function parseEpisodesJs(jsContent) {
  const episodes = []
  // Cherche toutes les variables eps1, eps2, etc.
  const regex = /var\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/g
  let match
  while ((match = regex.exec(jsContent)) !== null) {
    const epNum = parseInt(match[1])
    // Extrait toutes les URLs entre guillemets simples ou doubles
    const urlRegex = /['"]([^'"]+)['"]/g
    const urls = []
    let urlMatch
    while ((urlMatch = urlRegex.exec(match[2])) !== null) {
      urls.push(urlMatch[1])
    }
    if (urls.length > 0) {
      episodes.push({ episode: epNum, urls })
    }
  }
  episodes.sort((a, b) => a.episode - b.episode)
  return episodes
}

// Récupère les épisodes d'une saison
async function getEpisodes(slug, season, lang = 'vostfr') {
  const key = `eps:${slug}:${season}:${lang}`
  const cached = getCached(key)
  if (cached) return cached

  const url = `${BASE_URL}/catalogue/${slug}/saison${season}/${lang}/episodes.js`
  try {
    const res = { data: await httpsGet(url) }
    const episodes = parseEpisodesJs(res.data)
    setCache(key, episodes)
    return episodes
  } catch (err) {
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
      behaviorHints: {
        // notWebReady est obligatoire pour que Stremio honore proxyHeaders
        notWebReady: true,
        proxyHeaders: {
          request: {
            // Les hébergeurs refusent la requête sans le Referer de leur page embed
            // (Sibnet renvoie 400 sans Referer, 403 avec celui d'anime-sama)
            'Referer': embedUrl,
            'User-Agent': headers['User-Agent'],
          },
        },
      },
    })
  }

  return streams
}

function getPlayerName(url) {
  if (url.includes('ansembed')) return 'Ansembed'
  if (url.includes('sendvid')) return 'Sendvid'
  if (url.includes('sibnet')) return 'Sibnet'
  if (url.includes('vidmoly')) return 'Vidmoly'
  if (url.includes('uqload')) return 'Uqload'
  if (url.includes('vudeo')) return 'Vudeo'
  if (url.includes('streamtape')) return 'Streamtape'
  return 'Source'
}

module.exports = { getCatalogue, getAnimeMeta, getEpisodes, getStreams }
