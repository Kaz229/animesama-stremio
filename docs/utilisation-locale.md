# Utilisation en local

C'est le mode d'emploi recommandé, et celui pour lequel l'addon a été écrit.
Le déploiement sur un serveur public a des limites réelles, détaillées dans
[deploiement.md](deploiement.md).

## 1. Prérequis

- Node.js >= 18
- npm
- Google Chrome, uniquement pour l'extracteur lpayer — qui ne fonctionne pas
  aujourd'hui, donc facultatif en pratique

## 2. Installation

```bash
git clone https://github.com/Kaz229/animesama-stremio.git
cd animesama-stremio
npm install
```

## 3. Choix du port

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

## 4. Ajouter l'addon dans Stremio, sur la machine qui héberge le serveur

1. Ouvrir Stremio
2. **Paramètres → Addons → Addon communautaire**
3. Coller `http://localhost:7010/manifest.json`
4. Installer

## 5. Utiliser l'addon depuis vos autres appareils

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

## 6. En cas de problème

| Symptôme | Cause probable |
|---|---|
| `EADDRINUSE` au démarrage | Port déjà pris — en choisir un autre via `PORT=` |
| Le catalogue est vide, timeouts dans les logs | L'IP codée en dur d'anime-sama a changé, voir [architecture.md](architecture.md#contournement-dns-fai-français) |
| Des mangas apparaissent encore | Catalogue mémorisé par Stremio — désinstaller et réinstaller l'addon |
| Un épisode ne démarre pas | Essayer une autre source ; lpayer n'est pas extractible et Sendvid est en panne, voir [hebergeurs.md](hebergeurs.md) |

