@echo off
cd /d "%~dp0"
echo [arrumar_banco] Sincronizando schema com o banco (Prisma)...
call npx prisma db push --accept-data-loss
if errorlevel 1 (
  echo [arrumar_banco] prisma db push falhou. Verifique a rede e o .env.
  pause
  exit /b 1
)
echo.
echo [arrumar_banco] Iniciando servidor de desenvolvimento...
call npm run dev
