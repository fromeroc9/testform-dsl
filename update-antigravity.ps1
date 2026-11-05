# Script para empaquetar y actualizar la extension en Antigravity IDE
$ErrorActionPreference = "Stop"

Write-Host "[1/3] Empaquetando la extension..." -ForegroundColor Cyan
npx vsce package

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Fallo al empaquetar la extension." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Obtener el archivo .vsix mas reciente
$latestVsix = Get-ChildItem -Filter *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $latestVsix) {
    Write-Host "[ERROR] No se encontro ningun archivo .vsix en el directorio." -ForegroundColor Red
    exit 1
}

Write-Host "[2/3] Archivo encontrado: $($latestVsix.Name)" -ForegroundColor Cyan
Write-Host "[3/3] Instalando/actualizando en Antigravity IDE..." -ForegroundColor Cyan
& antigravity-ide --install-extension $latestVsix.FullName --force

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] Extension $($latestVsix.Name) actualizada con exito en Antigravity IDE!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Fallo la instalacion en Antigravity IDE." -ForegroundColor Red
    exit $LASTEXITCODE
}
