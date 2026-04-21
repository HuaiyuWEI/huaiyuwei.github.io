# NeurMOC Interactive Viewer

This folder contains a lightweight browser-based visualization tool for `NeroMOC_data.mat`, presented publicly as NeurMOC.

## What it shows

- A time-mean latitude-density section split into Southern Ocean and Atlantic basins.
- A latitude-density trend map split into Southern Ocean and Atlantic basins.
- A time series plus `pred_yz_std` uncertainty and a fitted linear trend at the clicked latitude-density point.
- A time-latitude Hovmoller diagram at a selected density level.

## Files

- `convert_mat_to_json.py`: converts `NeroMOC_data.mat` into `viewer/data/neromoc_data.json`.
- `index.html`, `app.js`, `styles.css`: the static viewer.

## First-time setup

From the `RealWorld` directory:

```powershell
py -3 viewer/convert_mat_to_json.py
```
The converter reads `NeroMOC_time` directly, so no synthetic time axis or edge trimming is applied during export.

## Launch locally

From the `RealWorld/viewer` directory:

```powershell
py -3 -m http.server 8000
```

Then open:

`http://localhost:8000`

Or use the helper launcher:

```powershell
powershell -ExecutionPolicy Bypass -File viewer/start_viewer.ps1
```

## Interaction tips

- Drag the month slider or press `Play`.
- Click on the latitude-density section to inspect a feature.
- Click on the Hovmoller panel to jump to a month-latitude pair.
- Adjust the color limit to emphasize weak or strong circulation features.

## Notes

- The viewer assumes `NeroMOC` is stored as `[time, density, latitude]`.
- Density is displayed from `NeroMOC_density` and increases downward.
- Trend and significance are read directly from `NeroMOC_trend` and `NeroMOC_trend_significant`.
- The local time series uses `GRACE_Gap_TimeRang` for cyan gap shading.
- Units are displayed as Sv.
- The exported JSON stores rounded values for lighter browser loading.
