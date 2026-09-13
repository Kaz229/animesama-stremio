#!/usr/bin/env bash
#
# Installeur Anime-Sama pour Stremio — macOS et Linux.
#
# L'extension .command le rend double-cliquable dans le Finder ; sous Linux,
# le lancer par `bash installer.command`. Un seul fichier, parce qu'il est
# téléchargé seul : il ne peut compter sur aucun autre.

set -euo pipefail

DEPOT='Kaz229/animesama-stremio'
BRANCHE='master'
PORT_MIN=7011
PORT_MAX=7060

case "$(uname -s)" in
  Darwin) DOSSIER="$HOME/Library/Application Support/animesama-stremio"; MACOS=1 ;;
  *)      DOSSIER="${XDG_DATA_HOME:-$HOME/.local/share}/animesama-stremio"; MACOS=0 ;;
esac

titre() { printf '\n\033[36m=== %s ===\033[0m\n' "$1"; }
info()  { printf '    %s\n' "$1"; }
souci() { printf '\033[33m    %s\033[0m\n' "$1"; }
fin()   { printf '\n\033[31m%s\033[0m\n\n' "$1"; read -r -p 'Appuyez sur Entrée pour fermer '; exit 1; }

printf '\n\033[32m  Anime-Sama pour Stremio\033[0m\n  Installation automatique\n'

# --- 1. Node.js ------------------------------------------------------------
titre 'Vérification de Node.js'

node_present() {
  command -v node >/dev/null 2>&1 || return 1
  # Node 18 minimum : en deçà, des API utilisées par le SDK manquent
  [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 18 ] 2>/dev/null
}

if node_present; then
  info "Node.js $(node -v) est déjà installé."
else
  souci 'Node.js est absent ou trop ancien. Tentative d'"'"'installation…'
  if [ "$MACOS" = 1 ] && command -v brew >/dev/null 2>&1; then
    brew install node || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y nodejs npm || true
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs || true
  fi
  if ! node_present; then
    [ "$MACOS" = 1 ] && open 'https://nodejs.org/fr/download' 2>/dev/null || true
    fin "Node.js n'a pas pu être installé automatiquement.
Installez la version LTS depuis https://nodejs.org/fr/download
puis relancez ce script. C'est le seul prérequis."
  fi
  info "Node.js $(node -v) installé."
fi

# --- 2. Arrêt d'une instance précédente ------------------------------------
# Avant de toucher aux fichiers, pas après : c'est indispensable sous Windows,
# où un fichier ouvert ne peut pas être remplacé, et sans inconvénient ici.
# Le port mémorisé redevient libre par la même occasion, ce qui permet de le
# réutiliser et de garder l'URL du manifest inchangée.
addon_a_nous() {
  curl -fsS --max-time 2 "http://localhost:$1/manifest.json" 2>/dev/null \
    | grep -q 'fr\.animesama\.stremio'
}

arreter_instance() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$1" 2>/dev/null | xargs kill 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$1/tcp" >/dev/null 2>&1 || true
  fi
  sleep 2
}

FICHIER_PORT="$DOSSIER/port.txt"
if [ -f "$FICHIER_PORT" ]; then
  DEJA_LA="$(tr -d '[:space:]' < "$FICHIER_PORT")"
  if [ -n "$DEJA_LA" ] && addon_a_nous "$DEJA_LA"; then
    titre 'Instance déjà en marche'
    info "L'addon tourne sur le port $DEJA_LA. Arrêt avant mise à jour…"
    arreter_instance "$DEJA_LA"
  fi
fi

# --- 3. Téléchargement du code ---------------------------------------------
titre 'Téléchargement de la dernière version'

TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

curl -fsSL "https://codeload.github.com/$DEPOT/zip/refs/heads/$BRANCHE" -o "$TEMP/source.zip" \
  || fin 'Téléchargement impossible. Vérifiez votre connexion internet.'
unzip -q "$TEMP/source.zip" -d "$TEMP/extrait"
SOURCE="$(find "$TEMP/extrait" -mindepth 1 -maxdepth 1 -type d | head -1)"

# node_modules est conservé : le remplacer ferait retélécharger toutes les
# dépendances à chaque mise à jour, pour rien.
mkdir -p "$DOSSIER"
(cd "$SOURCE" && find . -mindepth 1 -maxdepth 1 ! -name node_modules \
   -exec cp -R {} "$DOSSIER/" \;)
info "Code installé dans $DOSSIER"

# --- 4. Dépendances --------------------------------------------------------
titre 'Installation des dépendances'
info 'Cette étape prend une à deux minutes la première fois.'

(cd "$DOSSIER" && npm install --omit=dev --no-audit --no-fund --loglevel=error) \
  || fin "L'installation des dépendances a échoué."

# --- 5. Choix du port ------------------------------------------------------
# Le port doit rester le même d'un lancement à l'autre : l'URL du manifest en
# dépend, et Stremio obligerait à réinstaller l'addon à chaque changement.
titre 'Choix du port'

port_libre() {
  ! node -e "
    const n=require('net'), s=n.createServer();
    s.once('error',()=>process.exit(1));
    s.once('listening',()=>s.close(()=>process.exit(0)));
    s.listen($1);
  " 2>/dev/null && return 1 || return 0
}

# L'instance précédente a déjà été arrêtée plus haut : le port mémorisé est
# donc normalement libre. Le filet de sécurité reste utile si elle avait été
# lancée depuis un autre dossier, ou si l'arrêt avait échoué.
PORT=''

if [ -f "$FICHIER_PORT" ]; then
  MEMORISE="$(tr -d '[:space:]' < "$FICHIER_PORT")"
  if [ -n "$MEMORISE" ] && port_libre "$MEMORISE"; then
    PORT="$MEMORISE"
  elif [ -n "$MEMORISE" ] && addon_a_nous "$MEMORISE"; then
    souci "L'addon tourne déjà sur le port $MEMORISE. Arrêt de cette instance…"
    arreter_instance "$MEMORISE"
    if port_libre "$MEMORISE"; then
      PORT="$MEMORISE"
    else
      souci "Instance impossible à arrêter. Fermez sa fenêtre puis relancez."
    fi
  elif [ -n "$MEMORISE" ]; then
    souci "Le port $MEMORISE est pris par un autre programme."
    souci "L'addon devra être réinstallé dans Stremio avec la nouvelle adresse."
  fi
fi

if [ -z "$PORT" ]; then
  # Sur macOS, 7000 est pris par le récepteur AirPlay : la plage démarre après.
  for p in $(seq $PORT_MIN $PORT_MAX); do
    if port_libre "$p"; then PORT="$p"; break; fi
  done
  [ -n "$PORT" ] || fin "Aucun port libre entre $PORT_MIN et $PORT_MAX."
  printf '%s' "$PORT" > "$FICHIER_PORT"
fi
info "Port retenu : $PORT"

# --- 6. Démarrage ----------------------------------------------------------
titre 'Démarrage du serveur'

(cd "$DOSSIER" && PORT="$PORT" node index.js) &
SERVEUR=$!
trap 'kill $SERVEUR 2>/dev/null || true; rm -rf "$TEMP"' EXIT

MANIFEST="http://localhost:$PORT/manifest.json"
PRET=0
for _ in $(seq 1 30); do
  sleep 0.5
  if curl -fsS --max-time 2 "$MANIFEST" >/dev/null 2>&1; then PRET=1; break; fi
done
[ "$PRET" = 1 ] || fin "Le serveur n'a pas répondu. Relancez ce script."

# --- 7. Installation dans Stremio ------------------------------------------
if [ "$MACOS" = 1 ]; then
  printf '%s' "$MANIFEST" | pbcopy 2>/dev/null || true
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$MANIFEST" | xclip -selection clipboard 2>/dev/null || true
fi

printf '\n\033[32m  ================================================\033[0m\n'
printf '\033[32m   Tout est prêt.\033[0m\n'
printf '\033[32m  ================================================\033[0m\n\n'
printf '\033[1m   %s\033[0m\n\n' "$MANIFEST"
info 'Ce lien a été copié dans votre presse-papier.'
printf '\n'
info "Stremio va s'ouvrir sur la fenêtre d'installation de l'addon."
info 'Si rien ne se passe : Stremio, puis Modules, puis collez le lien.'
printf '\n\033[33m  IMPORTANT : gardez cette fenêtre ouverte tant que vous regardez.\033[0m\n'
printf "\033[33m  La fermer arrête l'addon.\033[0m\n\n"

# Stremio enregistre le protocole stremio:// : la même URL sous ce schéma ouvre
# directement la fenêtre d'installation, sans copier-coller. Le lien reste
# affiché au cas où le protocole ne serait pas enregistré.
if [ "$MACOS" = 1 ]; then
  open "stremio://localhost:$PORT/manifest.json" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "stremio://localhost:$PORT/manifest.json" 2>/dev/null || true
fi

wait $SERVEUR
