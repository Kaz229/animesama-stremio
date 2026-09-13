# Architecture du projet

```
animesama-stremio/
├── index.js       — Point d'entrée, lance le serveur HTTP sur le port 7011
├── addon.js       — Handlers Stremio (catalog, meta, stream)
├── scraper.js     — Scraping d'anime-sama.to (catalogue, métadonnées, épisodes)
├── extractor.js   — Extraction des URLs vidéo depuis les hébergeurs
└── package.json
```

## Flux de données

```
Stremio → addon.js (handler stream)
  → scraper.js (getEpisodes → episodes.js)
    → extractor.js (extractVideoUrl)
      → retourne URL m3u8 ou mp4 directe
```


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

### Catalogues et sections de l'accueil

Les trois catalogues thématiques proviennent de la page d'accueil, qui contient
tout en HTML déjà rendu — une seule requête les alimente donc tous les trois,
mutualisée par `fetchPage()`.

| Catalogue Stremio | Conteneur HTML | Entrées après filtrage |
|---|---|---|
| `animesama-recents` | `#containerAjoutsAnimes` | 19 |
| `animesama-classiques` | `#containerClassiques` | 32 |
| `animesama-pepites` | `#containerPepites` | 25 |

Deux formes de cartes cohabitent sur l'accueil, d'où `estCarteAnime()` :

- **carte complète** (`.catalog-card`), identique à celle du catalogue, dont le
  type se lit dans `.info-value` ;
- **carte compacte**, sans `.info-value` mais porteuse d'un badge explicite —
  `.badge-text` vaut `Anime`, `Scans`, `Webtoon` ou `Manga`. Le tri y est plus
  fiable qu'au catalogue.

Les cartes compactes pointent vers `/catalogue/<slug>/<saison>/<langue>/` et non
vers `/catalogue/<slug>`, d'où `slugDepuisHref()` qui prend le **premier** segment
après `/catalogue/` plutôt que le dernier.

Les ajouts récents listent un épisode par ligne : un même animé y apparaît
plusieurs fois, la déduplication se fait par slug.

Sections écartées volontairement : `#containerAjoutsScans` (que des webtoons et
mangas), `#containerSorties` (57 scans sur 70) et les sept sections par jour.

### Recherche

La recherche a son propre catalogue, `animesama-recherche`, déclaré avec
`isRequired: true` : il n'apparaît donc pas dans Discover et ne répond qu'à la
barre de recherche. Il interroge `/catalogue/?search=`, seul endroit du site qui
sache chercher — les sections de l'accueil sont des listes figées.

La déclaration doit exister sous **les deux formes** : `extra` (moderne) et
`extraSupported` / `extraRequired` (héritée). Le SDK ne dérive pas les secondes
des premières, et Stremio v4 s'appuie sur elles pour choisir les catalogues à
interroger depuis la barre de recherche — sans elles, le catalogue reste muet.

Le handler refuse par ailleurs une requête `search` adressée à un autre
catalogue : les trois catalogues thématiques y répondaient aussi, ce qui
affichait les mêmes résultats quatre fois.

### Format des IDs Stremio

```
as:{slug}:{saison}:{episode}
Exemple : as:sword-art-online:1:1
```

La langue n'y figure pas. Elle l'a fait, et c'était une erreur de modèle : un
épisode existait alors deux fois, en VOSTFR et en VF, sous le même couple
(saison, épisode). Stremio ne pouvait plus désigner l'épisode suivant, et la
lecture enchaînée sautait de la fin de la VOSTFR au premier épisode VF.

La langue appartient au **stream**, pas à l'épisode : le handler `stream`
propose désormais toutes les langues disponibles comme autant de sources.
La forme historique `as:{slug}:{saison}:{episode}:{langue}` reste acceptée,
car Stremio l'a enregistrée dans les bibliothèques existantes.

Chaque épisode porte aussi `released` — requis par la spec — et `available`.
Le site ne publie aucune date de diffusion : celle-ci est synthétique, un jour
par rang à partir du 1ᵉʳ janvier 2000. Elle vaut ordre, pas information
éditoriale, mais Stremio n'enchaîne pas sur un épisode qu'il croit à venir.

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


## Dépendances

```json
{
  "stremio-addon-sdk": "^1.6.10",
  "cheerio": "^1.0.0-rc.12",
  "express": "^4.18.2",
  "puppeteer-core": "^25.10.0"
}
```

> `axios` et `dns2` ont été retirés : le premier était remplacé par `https` natif
> (bug Node v25.9 avec `httpsAgent`), le second abandonné avec l'approche DoH.
> `express` reste déclaré mais n'est pas importé par le code : c'est le SDK qui
> l'utilise, et il le déclare déjà de son côté.

Les 8 vulnérabilités npm (4 hautes) proviennent toutes de `stremio-addon-sdk@1.6.10`,
qui épingle `inquirer@6.5.2` (→ `external-editor` → `tmp`) et une version
vulnérable de `qs` via `express`. `npm audit fix` ne peut rien sans `--force`,
qui casserait le SDK. Elles concernent des outils de développement du SDK, pas
le chemin de code servi aux requêtes.

