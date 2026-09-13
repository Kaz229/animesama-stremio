# Feuille de route

## ✅ P1 — Filtrer le catalogue pour n'afficher que les animés — fait

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

## ✅ P2 — Corriger la lecture (spinner infini) — fait

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

## ✅ P5 — Numérotation des épisodes — fait

Symptôme : les trois « sources » proposées pour l'épisode 1 étaient en réalité
les épisodes 1, 2 et 3.

`parseEpisodesJs()` prenait `eps<N>` pour l'épisode N et ses URLs pour autant
d'hébergeurs. C'est l'inverse (voir [architecture.md](architecture.md#format-episodesjs)). Le parseur transpose
désormais la matrice.

**Vérifié** : 07 Ghost 25 épisodes (au lieu de 5), Sword Art Online 25, Naruto 220.
SAO S1 E1/E5/E12 pointent bien sur trois vidéos distinctes.

Effet de bord bienvenu : le nombre réel d'épisodes est maintenant connu, donc le
handler meta ne génère plus 500 épisodes fictifs par saison plafonnés à 2000.

## ✅ P6 — Version française — fait

Symptôme : seule la VOSTFR fonctionnait, la VF renvoyait toujours sur la VOSTFR.

Rien n'exposait la VF : la fiche ne déclare que `saison{N}/vostfr`, et le handler meta
ne générait donc que des épisodes VOSTFR. La VF existe pourtant côté site.
`getAnimeMeta()` sonde maintenant chaque langue de `LANGUES_VIDEO` et ne retient que
celles qui répondent.

**Vérifié** : Naruto 220 épisodes en VF et 220 en VOSTFR ; One Piece 2305 entrées sur
19 combinaisons saison/langue ; 07 Ghost reste en VOSTFR seule, sa VF renvoyant un 404.
Lecture d'un stream VF confirmée : `HTTP 206`, `video/mp4`, 300 Ko.

## ✅ P7 — Recherche sans résultat dans Stremio — fait

Symptôme : la barre de recherche de Stremio ne remontait aucun animé, alors que
le scraper répondait correctement.

**Cause.** Le catalogue `animesama-recherche` ne déclarait la recherche que sous
la forme moderne, `extra: [{ name: 'search', isRequired: true }]`. Stremio v4 se
fonde encore sur l'ancienne forme — `extraSupported` / `extraRequired` — pour
choisir les catalogues à interroger depuis la barre de recherche, et le SDK ne
les dérive pas de `extra`. Le catalogue n'était donc jamais appelé.

**Correctif.** Les deux formes cohabitent désormais dans le manifest. Au passage,
le handler ne sert plus la recherche que depuis son catalogue dédié : les trois
catalogues thématiques y répondaient aussi, ce qui aurait affiché les mêmes
résultats quatre fois.

**Vérifié** : `search=naruto` → 5 entrées (Naruto, Shippuden, Boruto, Naruto SD
Rock Lee, Sasuke Retsuden), `search=one piece` → 1 ; les catalogues thématiques
renvoient bien une liste vide sur une requête de recherche.

> Le manifest est mémorisé par Stremio : désinstaller puis réinstaller l'addon
> pour que le changement soit pris en compte.

## P3 — Extraction lpayer

Toujours bloquée, voir [hebergeurs.md](hebergeurs.md#problème-lpayer-todo-principal).
Affecte Naruto, Bleach, 07 Ghost, etc.

- [ ] Analyser le bundle `prod-CbREaqWl.js` pour trouver la génération du token
- [ ] Ou monkey-patcher `fetch` avant chargement pour capturer `/api/v1/player`

## P4 — Confort et robustesse

- [ ] Paginer la recherche, qui ne renvoie que la première page de résultats
- [ ] Basculer le port par défaut sur une valeur libre : 7000 est occupé par le
      récepteur AirPlay sur macOS (contournement documenté dans [utilisation-locale.md](utilisation-locale.md))
- [ ] Traiter les 8 vulnérabilités npm (4 hautes) sans casser `puppeteer-core`
- [ ] Retirer `axios` et `dns2` du `package.json`, tous deux inutilisés
- [ ] Containeriser avec Docker
- [ ] Déployer sur un serveur public (Railway, Render) pour ne plus dépendre d'un PC
      allumé — lire d'abord [deploiement.md](deploiement.md), Ansembed y perd
      probablement sa lecture


# Problèmes connus

- **Lpayer** : aucune URL vidéo extraite (P3)
- **Sendvid hors service** : ses pages embed renvoient un `502`, panne côté hébergeur
- **Ansembed lié à l'ASN** : ses jetons ne valent que pour le réseau qui les a obtenus,
  ce qui interdit en pratique un déploiement distant
- **Catalogues figés** : les sections de l'accueil comptent 19 à 32 entrées, sans
  pagination possible ; seule la recherche donne accès au reste du site
- **Posters manquants** : certaines affiches ne chargent pas si le CDN d'images est
  lui aussi bloqué par DNS
- **IP hardcodée** : `104.26.12.154` pour `anime-sama.to`, à re-résoudre via DoH si
  le scraper tombe en timeout
