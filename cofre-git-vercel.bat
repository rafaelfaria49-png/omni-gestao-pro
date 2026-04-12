@echo off
chcp 65001 >nul
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo [erro] Git nao encontrado. Instale: https://git-scm.com/download/win
  pause
  exit /b 1
)

echo === Inicia o cofre ===
git init

echo === Prepara os arquivos ===
git add .

echo === Carimba o envio ===
git commit -m "OmniGestao Pro - Versao para Vercel"
if errorlevel 1 (
  echo [aviso] Commit falhou. Configure: git config user.email "seu@email.com" ^&^& git config user.name "Seu Nome"
  pause
  exit /b 1
)

echo === Cria o caminho principal ===
git branch -M main

echo === Conecta com o GitHub ===
git remote remove origin 2>nul
git remote add origin https://github.com/rafaelfaria49-png/omni-gestao-pro.git

echo === Manda para a nuvem ===
git push -u origin main
if errorlevel 1 (
  echo [erro] Push falhou. Autentique-se ^(GitHub: token HTTPS ou GitHub Desktop^).
  pause
  exit /b 1
)

echo.
echo Pronto: https://github.com/rafaelfaria49-png/omni-gestao-pro
pause
