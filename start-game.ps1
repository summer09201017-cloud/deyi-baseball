param(
  [int]$Port = 9876,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$projectRoot = (Resolve-Path -LiteralPath $scriptDir).Path
$distPath = Join-Path $projectRoot 'dist'
$distIndex = Join-Path $distPath 'index.html'
$url = "http://127.0.0.1:$Port/"

Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath $distIndex)) {
  Write-Host 'dist not found. Building production files...'
  $env:npm_config_cache = '.npm-cache'
  $env:NODE_OPTIONS = '--max-old-space-size=4096'
  & 'C:\Program Files\nodejs\npm.cmd' run build
}

$listener = $null
try {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
} catch {
  $listener = $null
}

if (-not $listener) {
  $pythonCommand = $null
  foreach ($candidate in @('py', 'python')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
      $pythonCommand = $candidate
      break
    }
  }

  if (-not $pythonCommand) {
    throw 'Python launcher not found.'
  }

  Write-Host "Starting local site at $url"
  Start-Process -FilePath $pythonCommand -ArgumentList @('-m', 'http.server', $Port, '-d', $distPath) -WorkingDirectory $projectRoot -WindowStyle Minimized | Out-Null
}

$ready = $false
for ($index = 0; $index -lt 20; $index += 1) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $ready) {
  throw "Site did not start correctly: $url"
}

if (-not $NoBrowser) {
  Start-Process $url | Out-Null
}

Write-Host "Baseball game is ready: $url"
