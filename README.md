# Anime-Sama Stremio Addon

Addon Stremio non-officiel pour regarder les animés d'[anime-sama.to](https://anime-sama.to)
en VOSTFR et en VF, directement dans Stremio.

## Fonctionnalités

- Trois catalogues issus du site : derniers épisodes, classiques, pépites
- Recherche dans l'ensemble du catalogue
- Détection automatique des saisons et des langues disponibles
- Extraction des liens vidéo chez plusieurs hébergeurs
- Contournement du blocage DNS des FAI français

Seuls les animés sont exposés : les scans et webtoons du site sont filtrés.

## Prérequis

- Node.js >= 18
- npm

## Installation

```bash
git clone https://github.com/Kaz229/animesama-stremio.git
cd animesama-stremio
npm install
```

## Lancement

```bash
node index.js
```

Le serveur écoute sur le port 7011, configurable via `PORT` :

```bash
PORT=7042 node index.js
```

> Le défaut évite le port 7000, occupé par le récepteur AirPlay sur macOS.
> Sur Windows, la syntaxe ci-dessus ne fonctionne pas : utiliser
> `set PORT=7042 && node index.js` en `cmd`, ou `$env:PORT=7042; node index.js`
> en PowerShell.

## Ajouter dans Stremio

**Paramètres → Addons → Addon communautaire**, puis l'URL du manifest :

```
http://localhost:7011/manifest.json
```

Pour utiliser l'addon depuis vos autres appareils (tablette, TV), remplacez
`localhost` par l'adresse locale de la machine hôte — voir
[docs/utilisation-locale.md](docs/utilisation-locale.md).

## Documentation

| Document | Contenu |
|---|---|
| [utilisation-locale.md](docs/utilisation-locale.md) | Mode d'emploi complet, usage multi-appareils, dépannage |
| [deploiement.md](docs/deploiement.md) | Mises en garde avant d'héberger l'addon publiquement |
| [architecture.md](docs/architecture.md) | Structure du code, formats du site, contournement DNS |
| [hebergeurs.md](docs/hebergeurs.md) | Hébergeurs vidéo, taux d'extraction, en-têtes requis |
| [feuille-de-route.md](docs/feuille-de-route.md) | Correctifs apportés, limites connues, pistes |

## Limites connues

- **Lpayer** (`embed4me.com`) n'est pas extractible : les titres servis uniquement
  par cet hébergeur ne se lisent pas
- **Sendvid** est hors service (`502` côté hébergeur)
- Les catalogues reprennent les sections de l'accueil du site, soit 19 à 32 entrées
  chacun ; le reste du catalogue n'est accessible que par la recherche
- L'IP d'anime-sama est codée en dur pour contourner le blocage DNS et doit être
  mise à jour si elle change

## Avertissement

Ce projet est un exercice technique de scraping. Il n'héberge ni ne redistribue
aucun contenu : il lit les pages publiques d'un site tiers, qui diffuse des œuvres
sans autorisation des ayants droit. L'utilisation de cet addon relève de votre
responsabilité, et l'exposer publiquement n'engage pas la même que de le faire
tourner chez soi.
