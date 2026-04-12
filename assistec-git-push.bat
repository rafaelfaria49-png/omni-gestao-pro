@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Repositório: github.com/rafaelfaria49-png/omni-gestao-pro
set "GITHUB_USER=rafaelfaria49-png"
set "GITHUB_REPO=omni-gestao-pro"

where git >nul 2>&1
if errorlevel 1 (
  echo [erro] Git nao encontrado no PATH. Instale: https://git-scm.com/download/win
  pause
  exit /b 1
)


echo [1/5] git init
if not exist .git git init

echo [2/5] git add .
git add .

echo [3/5] git commit
git commit -m "OmniGestão Pro - Setup Oficial"
if errorlevel 1 (
  echo [aviso] Commit falhou ^(talvez nada alterado ou ja commitado^). Continuando...
)

echo [4/5] branch main e remote
git branch -M main 2>nul
git remote remove origin 2>nul
git remote add origin "https://github.com/%GITHUB_USER%/%GITHUB_REPO%.git"

echo [5/5] push para GitHub ^(precisa estar logado: gh auth login ou Git Credential Manager^)
git push -u origin main
if errorlevel 1 (
  echo.
  echo Se o push falhou:
  echo  - Crie o repositorio VAZIO "assistec-pro" em https://github.com/new
  echo  - Nao marque README, .gitignore ou license no assistente do GitHub.
  echo  - Tente de novo este .bat.
  pause
  exit /b 1
)

echo.
echo Pronto. Repositorio: https://github.com/%GITHUB_USER%/%GITHUB_REPO%
pause
