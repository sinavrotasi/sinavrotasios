<#
  SınavRotası — paylaşılabilir kaynak ZIP'i oluşturur (O-05).

  Hariç tutulanlar: imza/anahtar dosyaları, yerel SDK yolları, derleme
  çıktıları, AAB/APK/IPA, node_modules, IDE ve önbellek klasörleri,
  soru bankası dökümleri (cevap anahtarı içerir).

  Kullanım (proje kökünde):
    powershell -ExecutionPolicy Bypass -File scripts\kaynak-paketle.ps1
    powershell -ExecutionPolicy Bypass -File scripts\kaynak-paketle.ps1 -Cikti ..\SinavRotasi-kaynak.zip
#>
param(
  [string]$Cikti = (Join-Path (Split-Path -Parent $PSScriptRoot) ("..\SinavRotasi-kaynak-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmm')))
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$haricKlasorler = @(
  'node_modules', '.git', '.gradle', '.kotlin', '.idea', '.vscode', 'build',
  'android\app\release', 'android\app\debug', 'ios\App\build',
  'supabase\export', 'supabase\.temp', 'supabase\.branches'
)
$haricDosyaDesenleri = @(
  'keystore.properties', 'local.properties', '*.jks', '*.keystore', '*.p12', '*.p8',
  '*.mobileprovision', 'google-services.json', 'GoogleService-Info.plist',
  '.env', '.env.*', '*.aab', '*.apk', '*.ipa', 'seed.sql', '*.log'
)

function Test-Haric([string]$tamYol) {
  $goreli = $tamYol.Substring($root.Length).TrimStart('\', '/')
  foreach ($k in $haricKlasorler) {
    $k2 = $k.Replace('/', '\')
    if ($goreli -eq $k2 -or $goreli.StartsWith("$k2\") -or $goreli -match "(^|\\)$([regex]::Escape($k2))(\\|$)") { return $true }
  }
  $ad = [System.IO.Path]::GetFileName($tamYol)
  foreach ($d in $haricDosyaDesenleri) { if ($ad -like $d) { return $true } }
  return $false
}

$dosyalar = Get-ChildItem -Path $root -Recurse -File -Force | Where-Object { -not (Test-Haric $_.FullName) }

$gecici = Join-Path ([System.IO.Path]::GetTempPath()) ("sr-paket-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $gecici | Out-Null
try {
  foreach ($f in $dosyalar) {
    $goreli = $f.FullName.Substring($root.Length).TrimStart('\', '/')
    $hedef = Join-Path $gecici $goreli
    New-Item -ItemType Directory -Path (Split-Path -Parent $hedef) -Force | Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $hedef
  }
  $ciktiTam = [System.IO.Path]::GetFullPath($Cikti)
  if (Test-Path $ciktiTam) { Remove-Item $ciktiTam }
  Compress-Archive -Path (Join-Path $gecici '*') -DestinationPath $ciktiTam
  Write-Host ("Oluşturuldu: {0} ({1} dosya)" -f $ciktiTam, $dosyalar.Count)
  Write-Host 'Hariç tutuldu: anahtar/imza dosyaları, derleme çıktıları, node_modules, soru dökümleri.'
} finally {
  Remove-Item -Recurse -Force $gecici
}
