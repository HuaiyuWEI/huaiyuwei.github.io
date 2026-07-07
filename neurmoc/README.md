# NeurMOC Interactive Viewer

Browser-based viewer for the NeurMOC reconstruction (published at
https://huaiyuwei.github.io/neurmoc/). Vanilla HTML/CSS/JS, no build step.

## What it shows

- Time-mean overturning streamfunction in latitude–density space, split into
  Southern Ocean (SMOC) and Atlantic (AMOC) sectors.
- Local time series with the uncertainty envelope and linear trend at the
  clicked latitude–density cell, plus location presets (RAPID 26.5°N, 45°N,
  abyssal 60°S).
- 21-year linear-trend map with significance stippling.
- Latitude–time Hovmöller diagram at a selected density level.
- Month-by-month snapshot with animation.

Hovering over any heatmap shows a value readout; clicking selects the cell.

## Files

- `index.html`, `app.js`, `styles.css` — the static viewer.
- `prepare_viewer_data.py` — converts `data/NeroMOC_data.mat` into the two
  files the viewer loads:
  - `data/neurmoc_meta.json` (~100 KB): axes, labels, time-mean field, trend
    statistics, and the binary descriptor.
  - `data/neurmoc_series.bin` (~2.5 MB): the monthly reconstruction and its
    uncertainty as int16 quantized at 0.005 Sv (max round-trip error
    0.0025 Sv). This replaced a 23.7 MB full-precision JSON.
- `data/NeroMOC_data.mat` — the source data, also offered for download on
  the page (as `NeurMOC_data.mat`; variables inside keep the legacy
  `NeroMOC_*` names).

## Updating the data

Drop a new `NeroMOC_data.mat` into `data/`, then from this directory:

```powershell
py -3 .\prepare_viewer_data.py
```

Bump the `?v=` query strings in `index.html` (stylesheet + script) when
changing `app.js`/`styles.css` so GitHub Pages visitors get the new files.
The series binary is cache-busted automatically by its generation date.

## Launch locally

```powershell
py -3 -m http.server 8000     # from this directory, then open localhost:8000
```

or `powershell -ExecutionPolicy Bypass -File .\start_viewer.ps1`, which also
regenerates the data files if the .mat is newer.

## Notes

- Array order in the .mat is `[time, density, latitude]`; density is σ₂ and
  increases downward in the plots.
- Trend, its 95% CI, and significance are read directly from
  `NeroMOC_trend_*` (no recomputation in the browser).
- The GRACE/GRACE-FO gap window comes from `GRACE_Gap_TimeRang` and is
  shaded in the time-series panel.
- Plot fonts auto-enlarge (and ticks thin out) when panels are displayed
  much narrower than their 1200 px drawing resolution, so phones stay
  readable.
