param(
    [switch]$RefreshData
)

$ErrorActionPreference = "Stop"

$viewerDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($RefreshData) {
    Write-Host "Refreshing viewer data from the pipeline paths configured in prepare_viewer_data.py..."
    Push-Location $viewerDir
    try {
        py -3 .\prepare_viewer_data.py
        py -3 .\make_og_image.py
    }
    finally {
        Pop-Location
    }
}

$required = @(
    "data\neurmoc_meta.json",
    "data\neurmoc_core.bin",
    "data\neurmoc_combos.bin",
    "data\NeurMOC_data.mat",
    "data\NeurMOC_data.nc"
)
$missing = @($required | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $viewerDir $_))
})
if ($missing.Count -gt 0) {
    throw "Viewer data are incomplete ($($missing -join ', ')). Run prepare_viewer_data.py or relaunch with -RefreshData."
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
