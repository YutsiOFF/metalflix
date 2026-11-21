@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo === MetalFlix : envoi de l'annonce Discord du 21/11/2026 ===
echo.
where node >nul 2>nul || (echo [ERREUR] Node.js n'est pas installe. & pause & exit /b 1)

call node scripts/send-discord.mjs discord-update-2026-11-21.json || (echo [ERREUR] L'envoi a echoue. & pause & exit /b 1)

echo.
echo === Annonce envoyee sur Discord. ===
echo.
pause
