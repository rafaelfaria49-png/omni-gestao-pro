# Regenera o cliente Prisma em generated/prisma (categorias, OS, etc.)
# O query_engine-windows.dll.node fica bloqueado se o Next.js (node) estiver rodando.

Write-Host "Encerrando processos Node (liberam o engine do Prisma)..." -ForegroundColor Yellow
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (Test-Path "generated\prisma") {
  Write-Host "Removendo generated\prisma..." -ForegroundColor Yellow
  Remove-Item -Recurse -Force "generated\prisma"
}

Write-Host "npx prisma generate" -ForegroundColor Green
npx prisma generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pronto. Suba o dev server de novo: npm run dev" -ForegroundColor Green
