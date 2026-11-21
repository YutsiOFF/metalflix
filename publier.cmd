@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo === MetalFlix : publication sur GitHub ===
echo.

where git >nul 2>nul || (echo [ERREUR] Git n'est pas installe. & pause & exit /b 1)
where npm >nul 2>nul || (echo [ERREUR] Node.js / npm n'est pas installe. & pause & exit /b 1)

if not exist node_modules (
  echo -- Installation des dependances...
  call npm install || (echo [ERREUR] npm install a echoue. & pause & exit /b 1)
)

echo -- Verification du build avant de publier...
call npm run build || (echo [ERREUR] Le build a echoue : rien n'a ete publie. & pause & exit /b 1)

echo.
echo -- Envoi des sources sur la branche main...
git add -A
git diff --cached --quiet && (echo    Aucune modification a commiter.) || (
  git commit -m "Nouveau style : theme clean (Poppins, cartes epurees, top 10)" || (echo [ERREUR] Commit impossible. & pause & exit /b 1)
)
git push origin main || (echo [ERREUR] git push a echoue. Verifie ta connexion GitHub. & pause & exit /b 1)

echo.
echo -- Mise a jour du site github.io (branche gh-pages)...
call npm run deploy || (echo [ERREUR] Le deploiement a echoue. & pause & exit /b 1)

echo.
echo === Termine ! Le site sera a jour dans 1 a 2 minutes : ===
echo     https://yutsioff.github.io/metalflix/
echo     (fais Ctrl+F5 pour vider le cache si tu vois encore l'ancien style)
echo.
pause
