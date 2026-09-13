# Installation simplifiée

Les scripts de `installeur/` visent quelqu'un qui ne connaît ni git ni la ligne
de commande. Le pari est qu'un seul fichier à double-cliquer suffit, et qu'aucune
étape ne demande de comprendre ce qui se passe.

## Le problème d'amorçage

Un script rangé dans le dépôt ne sert à rien si l'utilisateur ne sait pas cloner
le dépôt. Le script doit donc être **téléchargeable seul** et aller chercher le
code lui-même. D'où deux conséquences :

- **pas de git** — le code arrive par l'archive ZIP de GitHub, dépliée par le
  script. Une dépendance entière disparaît ;
- **aucun fichier compagnon** — chaque script est autonome, il ne peut compter
  sur rien d'autre que lui-même.

## Les trois fichiers

| Fichier | Rôle |
|---|---|
| `installer.bat` | Amorceur Windows, ASCII pur, en CRLF |
| `installer.ps1` | Toute la logique Windows |
| `installer.command` | macOS et Linux, autonome |

Sous Windows, le `.bat` ne fait que télécharger le `.ps1` et le lancer. Cette
séparation n'est pas cosmétique : **le batch gère mal l'UTF-8**, et les accents
de ses messages cassent selon la version de Windows. Il reste le fichier
double-cliquable, PowerShell fait le travail — et gère au passage le JSON, les
téléchargements et les sockets bien mieux que `cmd`.

> `installer.ps1` doit rester encodé en **UTF-8 avec BOM**. Sans lui, PowerShell
> 5.1, celui livré avec Windows, lit le fichier en ANSI et rend les accents
> illisibles.

## Ce que fait le script

1. **Node.js** — vérifie la présence et la version (18 minimum). Absent, il tente
   `winget` sous Windows, `brew`/`apt`/`dnf` ailleurs, et à défaut ouvre la page
   de téléchargement en expliquant la marche à suivre. C'est le seul prérequis
   qu'on ne peut pas supprimer.
2. **Téléchargement** — l'archive ZIP de la branche `master`, dépliée dans le
   dossier de données de l'utilisateur : `%LOCALAPPDATA%` sous Windows,
   `~/Library/Application Support` sous macOS, `~/.local/share` sous Linux.
   Aucun droit administrateur n'est requis.
3. **Dépendances** — `npm install --omit=dev`. `node_modules` est conservé d'une
   mise à jour à l'autre, sinon tout serait retéléchargé à chaque fois.
4. **Port** — voir ci-dessous.
5. **Démarrage**, puis attente que le manifest réponde vraiment avant d'annoncer
   quoi que ce soit.
6. **Installation dans Stremio** — le lien est affiché, copié dans le
   presse-papier, et ouvert via `stremio://`, protocole que Stremio enregistre :
   l'application s'ouvre directement sur la fenêtre d'installation de l'addon,
   sans copier-coller. Le lien reste affiché au cas où le protocole ne serait pas
   enregistré.

## La stabilité du port

C'est le point le plus délicat, et celui qui a demandé deux essais.

L'URL du manifest contient le port. S'il change, Stremio considère qu'il s'agit
d'un autre addon et l'utilisateur doit le réinstaller. **Le port doit donc rester
le même d'un lancement à l'autre**, et il est mémorisé dans `port.txt`.

Mais un port mémorisé est souvent occupé à la relance — par l'instance
précédente, restée en marche. La première version en déduisait qu'il fallait
changer de port, et l'adresse changeait à chaque lancement : exactement ce qu'il
fallait éviter.

Le script interroge donc le port avant de conclure. Si le manifest qui répond
porte `fr.animesama.stremio`, c'est notre propre addon : il est arrêté et le port
réutilisé. Ce n'est que si le port est tenu par un **autre** programme qu'un
nouveau est choisi — et l'utilisateur est alors prévenu qu'il devra réinstaller
l'addon.

La plage balayée va de 7011 à 7060. Elle commence après 7000, occupé par le
récepteur AirPlay sous macOS, et reste assez large pour contourner les plages
que Hyper-V, WSL2 et Docker Desktop réservent sous Windows — une valeur en dur
échouerait chez certains utilisateurs sans la moindre explication.

## Ce que l'utilisateur doit accepter

Deux avertissements système sont inévitables et doivent être documentés, faute
de quoi l'utilisateur abandonne là :

- **Windows SmartScreen** sur un `.bat` téléchargé : « Informations
  complémentaires », puis « Exécuter quand même » ;
- **Gatekeeper sur macOS** au premier lancement : Réglages Système →
  Confidentialité et sécurité → « Ouvrir quand même ».

Les signer supprimerait ces avertissements, mais suppose un certificat
d'éditeur — payant, et nominatif.

## Limites connues

- **La fenêtre est le serveur.** La fermer arrête l'addon. Un vrai service en
  arrière-plan (tâche planifiée, `launchd`) supprimerait cette contrainte au prix
  d'une installation nettement plus intrusive.
- **Aucune désinstallation automatique.** Supprimer le dossier d'installation
  suffit, mais rien ne le fait à la place de l'utilisateur.
- **Le script suit `master`.** Une régression poussée sur la branche se propage
  à la prochaine relance de n'importe quel utilisateur. Publier des versions
  étiquetées et faire pointer l'installeur sur la dernière serait plus prudent.
