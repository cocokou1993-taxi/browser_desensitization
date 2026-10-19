$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$manifestPath = Join-Path $dist 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "找不到构建产物：$manifestPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$releaseDir = Join-Path $root 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$zipPath = Join-Path $releaseDir "local-redaction-extension-$($manifest.version).zip"
$files = Get-ChildItem -LiteralPath $dist -File | Where-Object { $_.Extension -ne '.map' }
Compress-Archive -LiteralPath $files.FullName -DestinationPath $zipPath -Force

$hash = (& node -e "const fs=require('fs');const crypto=require('crypto');console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" $zipPath).Trim()
Write-Host "PACKAGE=$zipPath"
Write-Host "SHA256=$hash"
