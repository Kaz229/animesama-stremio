# Anime-Sama Stremio Addon

Addon Stremio non-officiel pour regarder les animés de [anime-sama.to](https://anime-sama.to) directement dans Stremio (VOSTFR et VF).

---

## Fonctionnalités

- Catalogue des animés avec affiches
- Détection automatique des saisons et des langues (VOSTFR / VF)
- Extraction des liens vidéo depuis plusieurs hébergeurs
- Contournement du blocage DNS des FAI français (hardcoded IP + servername)

---

## État actuel (septembre 2026)

### Hébergeurs supportés

| Hébergeur | Extraction | Exemples d'animés |
|-----------|-----------|-------------------|
| **Sibnet** | ✅ MP4 direct | SAO, One Piece ep.1 |
| **Ansembed / Vidmoly** | ✅ HLS m3u8 | One Piece, Dragon Ball Z, Fairy Tail |
| **Streamtape** | ✅ MP4 (regex JS) | Selon l'animé |
| **Sendvid** | ✅ MP4 direct | Selon l'animé |
| **Lpayer (embed4me.com)** | ❌ Non fonctionnel | Naruto, Bleach, 07 Ghost |

### Problème lpayer (TODO principal)

Le player `lpayer.embed4me.com` est une SPA React avec Vidstack. Il :
1. Appelle `/api/v1/info?id=HASH` → réponse chiffrée AES-CBC
2. Clé hardcodée : `kiemtienua911ca` (hex: `6b69656d7469656e6d75613931316361`)
3. IV hardcodé : `1234567890oiuytr` (hex: `313233343536373839306f6975797472`)
4. Réponse déchiffrée = JSON avec `playerId`, `title`, `poster`, etc. — **mais pas d'URL vidéo**
5. L'URL vidéo devrait venir de `/api/v1/player?t=TOKEN` — mais ce call n'est jamais déclenché malgré des clics simulés
6. La détection anti-bot est forte : vérifie `navigator.webdriver`, `userAgent` (cherche "puppeteer", "playwright", etc.), et le contexte d'exécution
7. Le `data-load="custom"` du player indique un chargement manuel déclenché par un événement React — pas par un simple `.click()` sur `.vds-play-button`

**Pistes pour débloquer lpayer :**
- Injecter du JS pour appeler directement la fonction React qui charge la source vidéo
- Utiliser Playwright avec bypass stealth plus avancé
- Monkey-patcher `fetch` avant le chargement de la page pour capturer l'appel `/api/v1/player`
- Analyser le bundle `prod-CbREaqWl.js` pour trouver la fonction qui génère le token et appelle l'API player
- Essayer de déconstruire le token manuellement (encrypt de quoi ?)

---

## Architecture du projet

```
animesama-stremio/
├── index.js       — Point d'entrée, lance le serveur HTTP sur le port 7000
├── addon.js       — Handlers Stremio (catalog, meta, stream)
├── scraper.js     — Scraping d'anime-sama.to (catalogue, métadonnées, épisodes)
├── extractor.js   — Extraction des URLs vidéo depuis les hébergeurs
└── package.json
```

### Flux de données

```
Stremio → addon.js (handler stream)
  → scraper.js (getEpisodes → episodes.js)
    → extractor.js (extractVideoUrl)
      → retourne URL m3u8 ou mp4 directe
```

---

## Installation et lancement

### Prérequis

- Node.js >= 18
- Google Chrome installé (pour l'extracteur lpayer, non fonctionnel actuellement)
- npm

### Installation

```bash
git clone https://github.com/Kaz229/animesama-stremio.git
cd animesama-stremio
npm install
```

### Lancement

```bash
node index.js
```

Le serveur démarre sur `http://localhost:7000`.

### Ajouter dans Stremio

1. Ouvrir Stremio
2. Aller dans **Paramètres → Addons → Addon communautaire**
3. Entrer l'URL : `http://localhost:7000/manifest.json`
4. Cliquer sur "Installer"

---

## Détails techniques importants

### Contournement DNS (FAI français)

Les FAI français (Orange, SFR, Free, Bouygues) bloquent `anime-sama.to` via DNSSEC.
Les serveurs publics (1.1.1.1, 8.8.8.8, 9.9.9.9) retournent SERVFAIL.

**Solution** : IP hardcodée + connexion HTTPS directe avec SNI.

```js
// scraper.js
const DNS_MAP = { 'anime-sama.to': '104.26.12.154' }

// connexion avec IP directe mais servername correct pour TLS
https.get({ hostname: ip, servername: hostname, ... })
```

> ⚠️ L'IP peut changer. Si le scraper tombe en timeout, résoudre `anime-sama.to` via DoH :
> `curl "https://cloudflare-dns.com/dns-query?name=anime-sama.to&type=A" -H "Accept: application/dns-json"`

### Format des IDs Stremio

```
as:{slug}:{saison}:{episode}:{langue}
Exemple : as:sword-art-online:1:1:vostfr
```

### Détection des saisons

Le site utilise du JS inline pour afficher les saisons :
```js
panneauAnime("Saison 1", "saison1/vostfr")
```

Le scraper parse ce pattern avec une regex sur le HTML brut.

### Format episodes.js

```js
var eps1 = ['url1', 'url2', 'url3'];  // épisode 1
var eps2 = ['url1', 'url2'];          // épisode 2
```

`eps{N}` = épisode N, les URLs sont les différents hébergeurs disponibles.

### Extraction Ansembed (Vidmoly)

```js
// Regex dans le HTML de la page embed
/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
```

### Extraction Sibnet

```js
// Regex dans le HTML de la page embed
/player\.src\s*\(\s*\[\s*\{\s*src:\s*['"]([^'"]+\.mp4[^'"]*)['"]/i
```

---

## Dépendances

```json
{
  "stremio-addon-sdk": "^1.6.10",
  "axios": "^1.6.0",
  "cheerio": "^1.0.0-rc.12",
  "express": "^4.18.2",
  "puppeteer-core": "^25.10.0",
  "dns2": "^3.1.1"
}
```

> `axios` est importé dans `package.json` mais non utilisé dans `scraper.js` (remplacé par `https` natif à cause d'un bug Node v25.9 avec `httpsAgent`).
> `dns2` est importé mais non utilisé (approche DoH abandonnée au profit de l'IP hardcodée).

---

## Problèmes connus

- **Lpayer** : aucune URL vidéo extraite (voir section ci-dessus)
- **Catalogue limité** : le scraper récupère ~48 animés par page, sans pagination automatique
- **Épisodes générés à la volée** : le handler meta génère 2000 faux épisodes par saison/langue. Les épisodes inexistants retournent `[]` côté stream (pas idéal mais fonctionnel)
- **Posters manquants** : certaines affiches ne chargent pas si le CDN d'images est aussi bloqué par DNS
- **Port occupé** : si le serveur crash et redémarre, utiliser `netstat -ano | grep 7000` puis `taskkill /F /PID {pid}` pour libérer le port 7000

---

## Pistes d'amélioration

- [ ] Résoudre l'extraction lpayer (affecter Naruto, Bleach, 07 Ghost, etc.)
- [ ] Paginer le catalogue pour récupérer tous les animés
- [ ] Persister le nombre d'épisodes réels par saison (plutôt que générer 500 par défaut)
- [ ] Ajouter la recherche dans le catalogue (endpoint `?search=`)
- [ ] Containeriser avec Docker pour faciliter le déploiement
- [ ] Déployer sur un serveur public (Railway, Render, etc.) pour ne pas nécessiter un PC allumé
