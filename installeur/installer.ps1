# Installeur Anime-Sama pour Stremio — logique commune, côté Windows.
#
# Amorcé par installer.bat. Le batch ne sert que de fichier double-cliquable :
# il gère mal l'UTF-8, et les accents de ses messages cassent selon la version
# de Windows. Tout ce qui compte se passe donc ici.
#
# Ce fichier doit rester encodé en UTF-8 **avec BOM** : sans lui, PowerShell 5.1,
# celui livré avec Windows, le lit en ANSI et rend les accents illisibles.

$ErrorActionPreference = 'Stop'

# PowerShell 5.1, celui livré avec Windows, négocie encore TLS 1.0 sur certaines
# installations. GitHub refuse alors la connexion, sans explication lisible.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$DEPOT    = 'Kaz229/animesama-stremio'
$BRANCHE  = 'master'
$DOSSIER  = Join-Path $env:LOCALAPPDATA 'animesama-stremio'
$PORT_MIN = 7011
$PORT_MAX = 7060

function Titre($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Info($t)  { Write-Host "    $t" }
function Souci($t) { Write-Host "    $t" -ForegroundColor Yellow }
function Fin($t) {
  Write-Host "`n$t" -ForegroundColor Red
  Write-Host ''
  Read-Host 'Appuyez sur Entrée pour fermer'
  exit 1
}

Write-Host ''
Write-Host '  Anime-Sama pour Stremio' -ForegroundColor Green
Write-Host '  Installation automatique'

# --- 1. Node.js ------------------------------------------------------------
Titre 'Vérification de Node.js'

function NodePresent {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  # Node 18 minimum : en deçà, des API utilisées par le SDK manquent
  $v = (& node -v) -replace '^v', ''
  return ([int]($v -split '\.')[0]) -ge 18
}

if (NodePresent) {
  Info "Node.js $(& node -v) est déjà installé."
} else {
  Souci "Node.js est absent ou trop ancien. Tentative d'installation…"
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    # --silent évite les fenêtres d'assistant. L'utilisateur voit malgré tout
    # la demande d'élévation de Windows, qu'il doit accepter.
    winget install --id OpenJS.NodeJS.LTS --silent `
                   --accept-source-agreements --accept-package-agreements
    # winget renseigne le PATH des sessions suivantes, pas de celle-ci
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
  }
  if (-not (NodePresent)) {
    Start-Process 'https://nodejs.org/fr/download'
    Fin @"
Node.js n'a pas pu être installé automatiquement.
La page de téléchargement vient de s'ouvrir : installez la version LTS,
puis relancez ce script. C'est le seul prérequis.
"@
  }
  Info "Node.js $(& node -v) installé."
}

# --- 2. Arrêt d'une instance précédente ------------------------------------
# Avant de toucher aux fichiers, pas après : sous Windows, un fichier ouvert
# par un processus en cours ne peut pas être remplacé, et la copie échouerait.
# Le port mémorisé redevient libre par la même occasion, ce qui permet de le
# réutiliser et de garder l'URL du manifest inchangée.

function AddonANous($p) {
  try {
    $r = Invoke-WebRequest "http://localhost:$p/manifest.json" -UseBasicParsing -TimeoutSec 2
    return $r.Content -match 'fr\.animesama\.stremio'
  } catch { return $false }
}

function ArreterInstance($p) {
  try {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch { }
  Start-Sleep -Seconds 2
}

$fichierPort = Join-Path $DOSSIER 'port.txt'
if (Test-Path $fichierPort) {
  $dejaLa = (Get-Content $fichierPort -Raw).Trim()
  if ($dejaLa -match '^\d+$' -and (AddonANous ([int]$dejaLa))) {
    Titre 'Instance déjà en marche'
    Info "L'addon tourne sur le port $dejaLa. Arrêt avant mise à jour…"
    ArreterInstance ([int]$dejaLa)
  }
}

# --- 3. Téléchargement du code ---------------------------------------------
Titre 'Téléchargement de la dernière version'

$zip     = Join-Path $env:TEMP 'animesama-stremio.zip'
$tempDir = Join-Path $env:TEMP 'animesama-stremio-extrait'

try {
  Invoke-WebRequest -Uri "https://codeload.github.com/$DEPOT/zip/refs/heads/$BRANCHE" `
                    -OutFile $zip -UseBasicParsing
} catch {
  Fin "Téléchargement impossible. Vérifiez votre connexion internet.`n$($_.Exception.Message)"
}

if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tempDir -Force
$source = Get-ChildItem $tempDir -Directory | Select-Object -First 1

# node_modules est conservé : le remplacer ferait retélécharger toutes les
# dépendances à chaque mise à jour, pour rien.
New-Item -ItemType Directory -Force -Path $DOSSIER | Out-Null
Copy-Item "$($source.FullName)\*" $DOSSIER -Recurse -Force -Exclude 'node_modules'
Remove-Item $zip, $tempDir -Recurse -Force
Info "Code installé dans $DOSSIER"

# --- 4. Dépendances --------------------------------------------------------
Titre 'Installation des dépendances'
Info 'Cette étape prend une à deux minutes la première fois.'

Push-Location $DOSSIER
& npm install --omit=dev --no-audit --no-fund --loglevel=error
$echec = $LASTEXITCODE -ne 0
Pop-Location
if ($echec) { Fin "L'installation des dépendances a échoué." }

# --- 5. Choix du port ------------------------------------------------------
# Le port doit rester le même d'un lancement à l'autre : l'URL du manifest en
# dépend, et Stremio obligerait à réinstaller l'addon à chaque changement. Il
# est donc mémorisé, et réattribué seulement s'il devient indisponible.
Titre 'Choix du port'

function PortLibre($p) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $p)
    $l.Start(); $l.Stop()
    return $true
  } catch { return $false }
}

# L'instance précédente a déjà été arrêtée plus haut : le port mémorisé est
# donc normalement libre. Le filet de sécurité reste utile si elle avait été
# lancée depuis un autre dossier, ou si l'arrêt avait échoué.
$port = $null

if (Test-Path $fichierPort) {
  $memorise = (Get-Content $fichierPort -Raw).Trim()
  if ($memorise -match '^\d+$') {
    if (PortLibre ([int]$memorise)) {
      $port = [int]$memorise
    } elseif (AddonANous ([int]$memorise)) {
      Souci "L'addon tourne déjà sur le port $memorise. Arrêt de cette instance…"
      ArreterInstance ([int]$memorise)
      if (PortLibre ([int]$memorise)) {
        $port = [int]$memorise
      } else {
        Souci 'Instance impossible à arrêter. Fermez sa fenêtre puis relancez.'
      }
    } else {
      Souci "Le port $memorise est pris par un autre programme."
      Souci "L'addon devra être réinstallé dans Stremio avec la nouvelle adresse."
    }
  }
}

if (-not $port) {
  # Hyper-V, WSL2 et Docker Desktop réservent des plages entières de ports :
  # une valeur en dur échouerait chez certains sans la moindre explication.
  foreach ($p in $PORT_MIN..$PORT_MAX) { if (PortLibre $p) { $port = $p; break } }
  if (-not $port) { Fin "Aucun port libre entre $PORT_MIN et $PORT_MAX." }
  Set-Content $fichierPort $port -NoNewline
}
Info "Port retenu : $port"

# --- 6. Démarrage ----------------------------------------------------------
Titre 'Démarrage du serveur'

$env:PORT = $port
$serveur = Start-Process node -ArgumentList 'index.js' `
                              -WorkingDirectory $DOSSIER -PassThru -NoNewWindow

$manifest = "http://localhost:$port/manifest.json"
$pret = $false
foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 500
  try {
    Invoke-WebRequest $manifest -UseBasicParsing -TimeoutSec 2 | Out-Null
    $pret = $true
    break
  } catch { }
}
if (-not $pret) {
  if (-not $serveur.HasExited) { Stop-Process -Id $serveur.Id -Force }
  Fin "Le serveur n'a pas répondu. Relancez ce script."
}

# --- 7. Installation dans Stremio ------------------------------------------
try { Set-Clipboard $manifest } catch { }

Write-Host ''
Write-Host '  ================================================' -ForegroundColor Green
Write-Host '   Tout est prêt.' -ForegroundColor Green
Write-Host '  ================================================' -ForegroundColor Green
Write-Host ''
Write-Host "   $manifest" -ForegroundColor White
Write-Host ''
Info 'Ce lien a été copié dans votre presse-papier.'
Write-Host ''
Info "Stremio va s'ouvrir sur la fenêtre d'installation de l'addon."
Info 'Si rien ne se passe : Stremio, puis Modules, puis collez le lien.'
Write-Host ''
Write-Host '  IMPORTANT : gardez cette fenêtre ouverte tant que vous regardez.' -ForegroundColor Yellow
Write-Host "  La fermer arrête l'addon." -ForegroundColor Yellow
Write-Host ''

# Stremio enregistre le protocole stremio:// : la même URL sous ce schéma ouvre
# directement la fenêtre d'installation, sans copier-coller. Le lien reste
# affiché au cas où le protocole ne serait pas enregistré.
try { Start-Process "stremio://localhost:$port/manifest.json" } catch { }

Wait-Process -Id $serveur.Id
