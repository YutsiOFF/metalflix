@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo === MetalFlix : mise a jour des plateformes (Netflix, Prime, Disney+...) ===
echo.
echo Redemande a TMDB, titre par titre, ou chaque film et serie est dispo en France.
echo Ca prend un moment (environ 46 000 titres), laisse la fenetre ouverte.
echo.

if not exist ".cache\tmdb-key" (
  echo [ERREUR] Cle TMDB introuvable : mets-la dans .cache\tmdb-key
  pause & exit /b 1
)

set FORCE=1
call node scripts/providers.mjs || (echo [ERREUR] La recolte des plateformes a echoue. & pause & exit /b 1)
set FORCE=

echo.
echo -- Reconstruction du catalogue avec les nouvelles plateformes...
call node scripts/build-catalog.mjs || (echo [ERREUR] build-catalog a echoue. & pause & exit /b 1)

echo.
echo === Termine. Lance publier.cmd pour mettre le site a jour. ===
echo.
pause
