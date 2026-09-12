const https = require('https')

// Cache des URLs extraites
const urlCache = new Map()
const CACHE_TTL = 20 * 60 * 1000 // 20 minutes

// Puppeteer lazy-loadé uniquement si nécessaire
let puppeteerBrowser = null

function getCachedUrl(key) {
  const cached = urlCache.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.url
  return null
}

function setCachedUrl(key, url) {
  urlCache.set(key, { url, time: Date.now() })
}

// Requête HTTPS générique
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://anime-sama.to/',
        ...headers,
      },
      rejectUnauthorized: false,
    }
    const req = https.get(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location
        const newUrl = loc.startsWith('http') ? loc : `${parsed.origin}${loc}`
        return resolve(httpsGet(newUrl, headers))
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// === Ansembed.net (Vidmoly) ===
async function extractAnsembed(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  try {
    const html = await httpsGet(embedUrl)
    // Cherche l'URL m3u8 dans sources: [{ file: 'URL' }]
    const m3u8Match = html.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
    if (m3u8Match) {
      const url = m3u8Match[1]
      console.log('[extractor] ansembed m3u8:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
    // Fallback: cherche un mp4
    const mp4Match = html.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+\.mp4[^'"]*)['"]/i)
    if (mp4Match) {
      const url = mp4Match[1]
      console.log('[extractor] ansembed mp4:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
  } catch (err) {
    console.error('[extractor] ansembed erreur:', err.message)
  }
  return null
}

// === Sibnet ===
async function extractSibnet(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  try {
    const html = await httpsGet(embedUrl)
    // Cherche player.src([{src: "/v/hash/id.mp4", type: "video/mp4"}])
    const srcMatch = html.match(/player\.src\s*\(\s*\[\s*\{\s*src:\s*['"]([^'"]+\.mp4[^'"]*)['"]/i)
    if (srcMatch) {
      let url = srcMatch[1]
      if (url.startsWith('/')) {
        const parsed = new URL(embedUrl)
        url = `${parsed.protocol}//${parsed.hostname}${url}`
      }
      console.log('[extractor] sibnet mp4:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
  } catch (err) {
    console.error('[extractor] sibnet erreur:', err.message)
  }
  return null
}

// === Vidmoly direct ===
async function extractVidmoly(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  try {
    const html = await httpsGet(embedUrl)
    const m3u8Match = html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/i)
    if (m3u8Match && m3u8Match[1].startsWith('http')) {
      const url = m3u8Match[1]
      console.log('[extractor] vidmoly m3u8:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
  } catch (err) {
    console.error('[extractor] vidmoly erreur:', err.message)
  }
  return null
}

// === Streamtape ===
async function extractStreamtape(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  try {
    const html = await httpsGet(embedUrl)
    // Streamtape expose l'URL via du JS obfusqué : var robotlink='...' + '...'
    const parts = html.match(/robotlink'\)\.innerHTML\s*=\s*(['"])(.*?)\1\s*\+\s*(['"])(.*?)\3/i)
    if (parts) {
      const url = 'https:' + parts[2] + parts[4]
      console.log('[extractor] streamtape:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
  } catch (err) {
    console.error('[extractor] streamtape erreur:', err.message)
  }
  return null
}

// === Sendvid ===
async function extractSendvid(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  try {
    const html = await httpsGet(embedUrl)
    const srcMatch = html.match(/<source[^>]+src=['"]([^'"]+\.mp4[^'"]*)['"]/i)
    if (srcMatch) {
      const url = srcMatch[1]
      console.log('[extractor] sendvid mp4:', url.substring(0, 80))
      setCachedUrl(embedUrl, url)
      return url
    }
  } catch (err) {
    console.error('[extractor] sendvid erreur:', err.message)
  }
  return null
}

// === Lpayer (Puppeteer) ===
async function getPuppeteerBrowser() {
  try {
    if (puppeteerBrowser) {
      // Test if browser is still alive (isConnected may or may not exist)
      const connected = typeof puppeteerBrowser.isConnected === 'function'
        ? puppeteerBrowser.isConnected()
        : puppeteerBrowser._connection && !puppeteerBrowser._connection._closed
      if (connected) return puppeteerBrowser
    }
  } catch {}
  puppeteerBrowser = null

  const fs = require('fs')
  const executablePaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]

  let executablePath = null
  for (const p of executablePaths) {
    try { fs.accessSync(p); executablePath = p; break } catch {}
  }

  if (!executablePath) {
    throw new Error('Chrome non trouvé pour lpayer extraction')
  }

  const puppeteer = require('puppeteer-core')
  puppeteerBrowser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security',
           '--disable-blink-features=AutomationControlled'],
  })
  puppeteerBrowser.on('disconnected', () => { puppeteerBrowser = null })
  return puppeteerBrowser
}

async function extractLpayer(embedUrl) {
  const cached = getCachedUrl(embedUrl)
  if (cached) return cached

  let page = null
  try {
    const br = await getPuppeteerBrowser()
    page = await br.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    let videoUrl = null

    await page.setRequestInterception(true)
    const IGNORE = ['google', 'yandex', 'analytics', 'gtm', 'metrika', 'doubleclick',
                    'facebook', 'mc.', 'imasdk', '2mdn.net', 'googlesyndication']

    page.on('request', req => {
      const url = req.url()
      if (IGNORE.some(d => url.includes(d))) {
        req.abort().catch(() => {})
        return
      }
      req.continue().catch(() => {})
    })

    page.on('response', async res => {
      const url = res.url()
      if (!videoUrl && (url.includes('.m3u8') || url.includes('.mp4')) &&
          !url.includes('vidstack') && !url.includes('preload') &&
          !IGNORE.some(d => url.includes(d))) {
        videoUrl = url
        console.log('[extractor] lpayer trouvé:', url.substring(0, 100))
      }
    })

    // Hook pour capturer l'appel API player
    await page.evaluateOnNewDocument(() => {
      const origFetch = window.fetch.bind(window)
      window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '')
        const res = await origFetch(...args)
        if (url.includes('/api/v1/player')) {
          const clone = res.clone()
          clone.text().then(b => { window.__playerApiBody = b }).catch(() => {})
        }
        return res
      }
    })

    await page.setExtraHTTPHeaders({
      'Referer': 'https://anime-sama.to/',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    })

    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 20000 })
    await new Promise(r => setTimeout(r, 2000))

    // Tente de déclencher la lecture
    await page.click('.vds-play-button').catch(() => {})
    await new Promise(r => setTimeout(r, 8000))

    if (videoUrl) {
      setCachedUrl(embedUrl, videoUrl)
    }

    return videoUrl
  } catch (err) {
    console.error('[extractor] lpayer erreur:', err.message)
    return null
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

// === Extracteur principal ===
async function extractVideoUrl(embedUrl) {
  console.log('[extractor] Extraction:', embedUrl.substring(0, 80))

  if (embedUrl.includes('ansembed.net')) return extractAnsembed(embedUrl)
  if (embedUrl.includes('sibnet.ru')) return extractSibnet(embedUrl)
  if (embedUrl.includes('vidmoly')) return extractVidmoly(embedUrl)
  if (embedUrl.includes('streamtape')) return extractStreamtape(embedUrl)
  if (embedUrl.includes('sendvid')) return extractSendvid(embedUrl)
  if (embedUrl.includes('lpayer') || embedUrl.includes('embed4me')) return extractLpayer(embedUrl)

  // Fallback: tentative générique m3u8/mp4 dans le HTML
  try {
    const cached = getCachedUrl(embedUrl)
    if (cached) return cached

    const html = await httpsGet(embedUrl)
    const m3u8 = html.match(/['"]([^'"]+\.m3u8[^'"]{0,200})['"]/)?.[1]
    if (m3u8 && m3u8.startsWith('http')) {
      setCachedUrl(embedUrl, m3u8)
      return m3u8
    }
  } catch {}

  return null
}

async function closeBrowser() {
  if (puppeteerBrowser) await puppeteerBrowser.close().catch(() => {})
  puppeteerBrowser = null
}

module.exports = { extractVideoUrl, closeBrowser }
