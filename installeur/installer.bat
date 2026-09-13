@echo off
title Anime-Sama pour Stremio
chcp 65001 >nul 2>&1

rem  Amorceur. Il ne fait que recuperer installer.ps1 et le lancer :
rem  le batch gere mal l'UTF-8, toute la logique vit donc dans PowerShell.
rem
rem  Chaque appel PowerShell tient sur UNE seule ligne. La continuation ^
rem  ne fonctionne pas a l'interieur d'une chaine entre guillemets : elle
rem  coupe la commande en deux, et un try/catch s'y retrouve scinde.

echo.
echo   Anime-Sama pour Stremio
echo   Lancement de l'installation...
echo.

where powershell >nul 2>&1
if errorlevel 1 (
  echo   PowerShell est introuvable sur ce poste.
  echo   Windows 10 ou 11 est requis.
  pause
  exit /b 1
)

rem  Le script est telecharge dans un fichier plutot qu'execute a la volee :
rem  PowerShell lit ainsi son BOM UTF-8 et affiche correctement les accents.
set "SCRIPT=%TEMP%\animesama-installer.ps1"
set "SOURCE=https://raw.githubusercontent.com/Kaz229/animesama-stremio/master/installeur/installer.ps1"

rem  Supprime un eventuel script reste d'un lancement precedent, pour ne pas
rem  relancer une version perimee si le telechargement echoue.
if exist "%SCRIPT%" del /f /q "%SCRIPT%" >nul 2>&1

rem  TLS 1.2 force : PowerShell 5.1 negocie encore TLS 1.0 sur certaines
rem  installations, et GitHub refuse la connexion sans explication.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing '%SOURCE%' -OutFile '%SCRIPT%'"

rem  La presence du fichier est un test plus sur que %errorlevel% en batch.
if not exist "%SCRIPT%" (
  echo.
  echo   Telechargement impossible.
  echo   Verifiez votre connexion internet, puis relancez ce fichier.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"

if errorlevel 1 pause
