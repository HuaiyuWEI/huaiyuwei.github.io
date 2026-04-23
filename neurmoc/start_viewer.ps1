$ErrorActionPreference = "Stop"

$viewerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsonPath = Join-Path $viewerDir "data\neromoc_data.json"
$matPath = Join-Path $viewerDir "data\NeroMOC_data.mat"

if (-not (Test-Path $matPath)) {
    throw "Could not find NeroMOC_data.mat in $viewerDir\\data"
}

if (-not (Test-Path $jsonPath) -or ((Get-Item $jsonPath).LastWriteTime -lt (Get-Item $matPath).LastWriteTime)) {
    Write-Host "Generating data/neromoc_data.json from data/NeroMOC_data.mat..."
    Push-Location $viewerDir
    try {
        py -3 .\convert_mat_to_json.py
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
