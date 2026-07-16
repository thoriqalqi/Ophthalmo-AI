@echo off
rem ============================================================
rem  OPHTHALMO-AI — Launcher Demo
rem  Double-click file ini: server lokal jalan + browser terbuka.
rem  TUTUP jendela ini untuk menghentikan server.
rem ============================================================
title Ophthalmo-AI Demo Server
cd /d "%~dp0"

echo.
echo  ============================================
echo    OPHTHALMO-AI  -  Demo Server
echo    URL : http://localhost:5173
echo.
echo    Tutup jendela ini utk menghentikan server.
echo  ============================================
echo.

rem Buka browser 2 detik setelah server mulai
start "" cmd /c "timeout /t 2 /nobreak >nul && start "" http://localhost:5173/index.html"

rem Jalankan server statis (tanpa cache agar perubahan selalu terbaca)
npx -y http-server public -p 5173 -c-1
