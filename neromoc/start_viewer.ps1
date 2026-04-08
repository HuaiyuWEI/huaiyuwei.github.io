$ErrorActionPreference = "Stop"

$viewerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $viewerDir
$jsonPath = Join-Path $viewerDir "data\neromoc_data.json"
$servedMatPath = Join-Path $viewerDir "data\NeroMOC_data.mat"
$matPath = Join-Path $rootDir "NeroMOC_data.mat"

if (-not (Test-Path $matPath)) {
    throw "Could not find NeroMOC_data.mat in $rootDir"
}

if (-not (Test-Path $jsonPath) -or ((Get-Item $jsonPath).LastWriteTime -lt (Get-Item $matPath).LastWriteTime)) {
    Write-Host "Generating viewer/data/neromoc_data.json from NeroMOC_data.mat..."
    Push-Location $rootDir
    try {
        py -3 viewer/convert_mat_to_json.py
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $servedMatPath) -or ((Get-Item $servedMatPath).LastWriteTime -lt (Get-Item $matPath).LastWriteTime)) {
    Write-Host "Copying NeroMOC_data.mat into viewer/data for browser download..."
    Copy-Item -LiteralPath $matPath -Destination $servedMatPath -Force
}

Write-Host "Starting NeroMOC viewer at http://localhost:8000"
Write-Host "Press Ctrl+C to stop the server."
Push-Location $viewerDir
try {
    py -3 -m http.server 8000
}
finally {
    Pop-Location
}
