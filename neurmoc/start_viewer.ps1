$ErrorActionPreference = "Stop"

$viewerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$matPath = Join-Path $viewerDir "data\NeurMOC_data.mat"
$binPath = Join-Path $viewerDir "data\neurmoc_series.bin"

if (-not (Test-Path $matPath)) {
    throw "Could not find NeurMOC_data.mat in $viewerDir\\data"
}

if (-not (Test-Path $binPath) -or ((Get-Item $binPath).LastWriteTime -lt (Get-Item $matPath).LastWriteTime)) {
    Write-Host "Generating viewer data from data/NeurMOC_data.mat..."
    Push-Location $viewerDir
    try {
        py -3 .\prepare_viewer_data.py
    }
    finally {
        Pop-Location
    }
}

Write-Host "Starting NeurMOC viewer at http://localhost:8000"
Write-Host "Press Ctrl+C to stop the server."
Push-Location $viewerDir
try {
    py -3 -m http.server 8000
}
finally {
    Pop-Location
}
