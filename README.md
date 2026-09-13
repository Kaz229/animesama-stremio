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

## Installation simplifiée (recommandée)

Pour une installation sans ligne de commande, un script fait tout : il installe
Node.js si besoin, télécharge l'addon, choisit un port libre, démarre le serveur
et ouvre Stremio directement sur la fenêtre d'installation.

| Système | Fichier à télécharger |
|---|---|
| Windows | [installer.bat](https://raw.githubusercontent.com/Kaz229/animesama-stremio/master/installeur/installer.bat) |
| macOS, Linux | [installer.command](https://raw.githubusercontent.com/Kaz229/animesama-stremio/master/installeur/installer.command) |

**Windows** — clic droit sur le lien, « Enregistrer la cible sous », puis
double-cliquer le fichier. Windows affichera un avertissement SmartScreen sur
un fichier téléchargé : « Informations complémentaires », puis « Exécuter
quand même ».

**macOS** — enregistrer le fichier, puis dans le Terminal :
`chmod +x installer.command`, et double-cliquer. macOS bloquera le premier
lancement : **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**.

**Linux** — `bash installer.command`.

Relancer le même fichier plus tard met l'addon à jour et le redémarre, en
conservant la même adresse.

> La fenêtre ouverte par le script **est** le serveur : la fermer arrête
> l'addon. Il faut la laisser ouverte pendant le visionnage.

Le détail de ce que fait le script, et la marche à suivre en cas de problème,
sont dans [docs/installation-simplifiee.md](docs/installation-simplifiee.md).

## Installation manuelle

### Prérequis

- Node.js >= 18
- npm

### Étapes

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
