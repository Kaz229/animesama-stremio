@echo off
title Anime-Sama pour Stremio
chcp 65001 >nul 2>&1

rem  Amorceur. Il ne fait que recuperer installer.ps1 et le lancer :
rem  le batch gere mal l'UTF-8, toute la logique vit donc dans PowerShell.

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

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -UseBasicParsing '%SOURCE%' -OutFile '%SCRIPT%' } ^
   catch { Write-Host '  Telechargement impossible. Verifiez votre connexion.' -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"

if errorlevel 1 pause
