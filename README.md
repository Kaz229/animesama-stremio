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

Taux d'extraction mesuré sur 10 URLs embed par hébergeur :

| Hébergeur | Extraction | Format livré | Referer exigé |
|-----------|-----------|--------------|---------------|
| **Sibnet** | 10/10 | MP4 après redirection signée | **oui** — 400 sans |
| **Ansembed** | 10/10 | HLS m3u8 | non |
| **Sendvid** | 0/10 | — | — (hébergeur en 502) |
| **Streamtape** | non rencontré | MP4 (regex JS) | — |
| **Lpayer (embed4me.com)** | ❌ | — | — |

> Sendvid répond actuellement `502` sur ses pages embed : la panne est chez
> l'hébergeur, l'extracteur n'est pas en cause.

### En-têtes par hébergeur

Seul Sibnet refuse la requête sans le `Referer` de sa page embed. Lui seul reçoit donc
`notWebReady: true` + `proxyHeaders`, qui font relayer le flux par le serveur interne
de Stremio.

Appliquer ce drapeau à tout le monde pénalisait Ansembed : son HLS (master, variantes,
44 segments) transitait par le proxy alors qu'il se sert sans aucun en-tête — master,
variante et segment répondent `200` sans `Referer`. Les hébergeurs sans contrainte
gardent `notWebReady: false` et sont lus nativement.

Les jetons Ansembed sont valides 12 h et liés à l'ASN appelant (`asn=` dans l'URL),
ce qui les rend inutilisables depuis un réseau différent de celui qui les a obtenus.

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

## Utilisation en local

C'est le mode d'emploi recommandé, et celui pour lequel l'addon a été écrit.
Le déploiement sur un serveur public a des limites réelles, détaillées plus bas.

### 1. Prérequis

- Node.js >= 18
- npm
- Google Chrome, uniquement pour l'extracteur lpayer — qui ne fonctionne pas
  aujourd'hui, donc facultatif en pratique

### 2. Installation

```bash
git clone https://github.com/Kaz229/animesama-stremio.git
cd animesama-stremio
npm install
```

### 3. Choix du port

Le port par défaut est 7000, mais **sur macOS il est occupé par le récepteur
AirPlay** (`ControlCenter`). Vérifier avant de lancer :

```bash
lsof -i tcp:7000          # macOS / Linux
```

Si quelque chose écoute déjà, ne pas tuer le processus : passer un autre port,
`index.js` lit `process.env.PORT`.

```bash
PORT=7010 node index.js
```

Le serveur affiche l'URL du manifest au démarrage. Vérifier qu'il répond :

```bash
curl -s http://localhost:7010/manifest.json | head -c 120
```

### 4. Ajouter l'addon dans Stremio, sur la machine qui héberge le serveur

1. Ouvrir Stremio
2. **Paramètres → Addons → Addon communautaire**
3. Coller `http://localhost:7010/manifest.json`
4. Installer

### 5. Utiliser l'addon depuis vos autres appareils

Stremio rattache la liste des addons à **votre compte** : l'addon installé sur
le PC apparaît tout seul sur la tablette, le téléphone et la TV connectés au
même compte.

Mais l'URL, elle, ne se traduit pas. `localhost` signifie « cette machine-ci » :
pour la TV, cela désigne la TV, où rien n'écoute. **L'addon sera listé partout
et ne fonctionnera que sur la machine hôte.**

Pour que les autres appareils l'atteignent réellement, enregistrer l'addon avec
l'adresse de la machine sur le réseau local plutôt qu'avec `localhost` :

```bash
ipconfig getifaddr en0                      # macOS
hostname -I | awk '{print $1}'              # Linux
ipconfig | findstr IPv4                     # Windows
```

Puis installer `http://192.168.1.42:7010/manifest.json` (avec votre adresse).
Le serveur écoute déjà sur toutes les interfaces, il n'y a rien à changer dans
le code.

Quatre conditions pour que cela marche :

- tous les appareils sur le **même réseau** local ;
- la machine hôte **allumée et non endormie** tant que vous regardez ;
- l'adresse IP locale **stable** — la réserver dans la box, sinon le DHCP peut
  l'attribuer ailleurs et l'addon cessera de répondre ;
- si l'URL change, **désinstaller puis réinstaller** l'addon dans Stremio.

### 6. En cas de problème

| Symptôme | Cause probable |
|---|---|
| `EADDRINUSE` au démarrage | Port déjà pris — en choisir un autre via `PORT=` |
| Le catalogue est vide, timeouts dans les logs | L'IP codée en dur d'anime-sama a changé, voir « Contournement DNS » |
| Des mangas apparaissent encore | Catalogue mémorisé par Stremio — désinstaller et réinstaller l'addon |
| Un épisode ne démarre pas | Essayer une autre source ; lpayer n'est pas extractible et Sendvid est en panne |

---

## Déploiement sur un serveur public — à lire avant

Le code est prêt techniquement : `index.js` lit `process.env.PORT`, ce qu'attendent
Railway, Render et consorts. Mais quatre points doivent être pesés d'abord.

### Ansembed cessera probablement de fonctionner

C'est la limite la plus concrète. Les URLs HLS d'Ansembed portent un jeton lié à
**l'ASN du réseau qui l'a demandé** (`asn=` dans l'URL), valable 12 h.

L'addon récupère ce jeton depuis le serveur. Hébergé à distance, c'est l'ASN du
datacenter qui est gravé dans l'URL, alors que votre lecteur, lui, est chez votre
opérateur. Le flux a toutes les chances d'être refusé.

Sibnet n'a pas ce problème : l'addon ne renvoie qu'une URL statique, et c'est le
lecteur qui déclenche la redirection signée depuis son propre réseau.

Un déploiement distant fait donc perdre Ansembed et garder Sibnet — la majorité du
catalogue d'après l'échantillon mesuré, mais pas la totalité.

### Stremio Web exige du HTTPS

Les applications desktop, mobile et TV acceptent un addon en HTTP simple.
`web.stremio.com` non : il faut un certificat valide. La plupart des hébergeurs en
fournissent un automatiquement.

### L'addon n'a aucune authentification

Toute personne connaissant l'URL peut l'installer et s'en servir. Il n'y a ni jeton,
ni restriction d'origine, ni limite de débit. Sachant que le contenu servi provient
d'un site de streaming illégal, exposer publiquement cette URL n'engage pas la même
responsabilité que de faire tourner l'addon chez soi pour son propre usage.

### Le contournement DNS devient inutile

L'IP codée en dur existe parce que les FAI français bloquent `anime-sama.to`.
Sur un serveur à l'étranger la résolution DNS fonctionne normalement : le
contournement reste inoffensif, mais c'est une IP figée de plus à surveiller.

### Si vous déployez quand même

- ne rien coder en dur : laisser l'hébergeur fournir `PORT` ;
- garder le cache mémoire tel quel — il s'efface à chaque redémarrage, ce qui est
  sans gravité ;
- surveiller `DNS_MAP` dans `scraper.js`, seul point qui casse silencieusement.

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

Piège : `eps<N>` ne désigne **pas** l'épisode N mais **l'hébergeur N**. Chaque tableau
liste tous les épisodes de la saison chez cet hébergeur, indexés par position.

```js
var eps1 = ['lpayer/ep1', 'lpayer/ep2', 'lpayer/ep3', ...];  // hébergeur 1
var eps2 = ['sibnet/ep1', 'sibnet/ep2', 'sibnet/ep3', ...];  // hébergeur 2
```

L'épisode N est donc la **colonne** N : `[eps1[N-1], eps2[N-1], ...]`.
Le nombre d'épisodes de la saison est la longueur du tableau le plus complet.

Certaines saisons annoncées mais non publiées contiennent des gabarits vides
(`shell.php?videoid=`, `embed-.html`, `sendvid.com/embed/`, `oid=&hd=3`) : ils sont
écartés par `estUrlExploitable()`, ce qui fait disparaître la saison si elle est vide.

### Langues disponibles

La fiche ne déclare que la VOSTFR via `panneauAnime`. La VF existe pour beaucoup de
titres sans apparaître dans le HTML : elle est découverte en sondant
`saison{N}/{langue}/episodes.js`, dont le résultat est mis en cache.

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

## Feuille de route

### ✅ P1 — Filtrer le catalogue pour n'afficher que les animés — fait

Le site mélange animés et **scans** (mangas à lire) dans `/catalogue/`. Le scraper prenait
tous les liens `/catalogue/<slug>/` sans distinction, donc Stremio affichait des mangas
dépourvus d'épisode vidéo.

Le type se lit dans le premier `.info-value` de chaque `.catalog-card` :

```html
<div class="catalog-card">
  <a href="https://anime-sama.to/catalogue/07-ghost">
    <p class="info-value">Anime, Scans</p>
```

`getCatalogue()` itère désormais sur `.catalog-card` et ne garde que les types contenant
`Anime` ou `Film`. Un repli sur l'ancien sélecteur reste en place si la mise en page change.

**Résultat : 48 → 32 entrées**, les 16 cartes `Scans` seules sont exclues.

### ✅ P2 — Corriger la lecture (spinner infini) — fait

Symptôme : l'animé s'affichait, mais au lancement le logo Stremio tournait en boucle.

**Cause.** `extractSibnet()` renvoie l'URL brute `video.sibnet.ru/v/<hash>/<id>.mp4`,
qui n'est pas jouable telle quelle. Sibnet exige le `Referer` de sa page embed :

```
Referer absent                                          → HTTP 400
Referer: https://anime-sama.to/                         → HTTP 403
Referer: https://video.sibnet.ru/shell.php?videoid=<id> → HTTP 302 → URL signée
```

Stremio requêtait sans `Referer`, recevait un 400, et tournait indéfiniment.

**Correctif.** `getStreams()` pose maintenant sur chaque stream :

```js
behaviorHints: {
  notWebReady: true,          // obligatoire pour que Stremio honore proxyHeaders
  proxyHeaders: {
    request: { 'Referer': embedUrl, 'User-Agent': ... },
  },
}
```

L'URL embed d'anime-sama est exactement le `Referer` attendu par l'hébergeur, aucune
reconstruction n'est nécessaire.

**Vérifié** : requête initiale → `302`, suivi de redirection → `HTTP 206`, `video/mp4`,
400 Ko de MP4 valide téléchargés. Ansembed répond `200` avec une playlist HLS 1080p/480p.

> L'URL signée Sibnet porte `noip=1` et expire vite : la résoudre côté serveur
> fonctionnerait en local mais casserait sur un déploiement distant. D'où `proxyHeaders`,
> qui laisse le lecteur faire la requête lui-même.

### ✅ P5 — Numérotation des épisodes — fait

Symptôme : les trois « sources » proposées pour l'épisode 1 étaient en réalité
les épisodes 1, 2 et 3.

`parseEpisodesJs()` prenait `eps<N>` pour l'épisode N et ses URLs pour autant
d'hébergeurs. C'est l'inverse (voir « Format episodes.js »). Le parseur transpose
désormais la matrice.

**Vérifié** : 07 Ghost 25 épisodes (au lieu de 5), Sword Art Online 25, Naruto 220.
SAO S1 E1/E5/E12 pointent bien sur trois vidéos distinctes.

Effet de bord bienvenu : le nombre réel d'épisodes est maintenant connu, donc le
handler meta ne génère plus 500 épisodes fictifs par saison plafonnés à 2000.

### ✅ P6 — Version française — fait

Symptôme : seule la VOSTFR fonctionnait, la VF renvoyait toujours sur la VOSTFR.

Rien n'exposait la VF : la fiche ne déclare que `saison{N}/vostfr`, et le handler meta
ne générait donc que des épisodes VOSTFR. La VF existe pourtant côté site.
`getAnimeMeta()` sonde maintenant chaque langue de `LANGUES_VIDEO` et ne retient que
celles qui répondent.

**Vérifié** : Naruto 220 épisodes en VF et 220 en VOSTFR ; One Piece 2305 entrées sur
19 combinaisons saison/langue ; 07 Ghost reste en VOSTFR seule, sa VF renvoyant un 404.
Lecture d'un stream VF confirmée : `HTTP 206`, `video/mp4`, 300 Ko.

### P3 — Extraction lpayer

Toujours bloquée, voir la section « Problème lpayer » plus haut.
Affecte Naruto, Bleach, 07 Ghost, etc.

- [ ] Analyser le bundle `prod-CbREaqWl.js` pour trouver la génération du token
- [ ] Ou monkey-patcher `fetch` avant chargement pour capturer `/api/v1/player`

### P4 — Confort et robustesse

- [ ] Paginer le catalogue (aujourd'hui 32 animés après filtrage, une seule page)
- [ ] Brancher la recherche du catalogue (le manifest déclare déjà `search`)
- [ ] Basculer le port par défaut sur une valeur libre : 7000 est occupé par le
      récepteur AirPlay sur macOS (contournement documenté dans « Utilisation en local »)
- [ ] Traiter les 8 vulnérabilités npm (4 hautes) sans casser `puppeteer-core`
- [ ] Retirer `axios` et `dns2` du `package.json`, tous deux inutilisés
- [ ] Containeriser avec Docker
- [ ] Déployer sur un serveur public (Railway, Render) pour ne plus dépendre d'un PC
      allumé — lire d'abord « Déploiement sur un serveur public », Ansembed y perd
      probablement sa lecture

---

## Problèmes connus

- **Lpayer** : aucune URL vidéo extraite (P3)
- **Sendvid hors service** : ses pages embed renvoient un `502`, panne côté hébergeur
- **Ansembed lié à l'ASN** : ses jetons ne valent que pour le réseau qui les a obtenus,
  ce qui interdit en pratique un déploiement distant
- **Catalogue limité** : une seule page du site, 32 animés après filtrage
- **Posters manquants** : certaines affiches ne chargent pas si le CDN d'images est
  lui aussi bloqué par DNS
- **IP hardcodée** : `104.26.12.154` pour `anime-sama.to`, à re-résoudre via DoH si
  le scraper tombe en timeout
