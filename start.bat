@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ szukseges: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\lighthouse (
  echo Fuggosegek telepitese, ez elso inditaskor 1-2 perc...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
echo A felulet a bongeszoben nyilik meg: http://127.0.0.1:4580/
echo Leallitas: zard be ezt az ablakot.
node server.mjs --open
pause
