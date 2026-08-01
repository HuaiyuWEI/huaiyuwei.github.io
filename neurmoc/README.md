# NeurMOC Interactive Viewer

Browser-based viewer for the NeurMOC reconstruction (published at
https://huaiyuwei.github.io/neurmoc/). Vanilla HTML/CSS/JS, no build step.

Updated 2026-07-31 to the m26r2 reference network (PCAinY64 ResNet
192x96x48 swish): the reconstruction is now the overturning **anomaly**
relative to 2004–2009 (GRACE convention), the trend statistics use the
serial-correlation-aware budget, and the viewer carries **every satellite
product combination** so visitors can switch inputs.

## What it shows

- A satellite-product selector (GRACE JPL/CSR × DUACS/NASA-SSH ×
  CCMP/ERA5): every combination is an independent stage-14 reconstruction
  by the same trained network; all series panels follow the selection.
  A "difference vs. default" toggle switches the anomaly heatmaps to
  selected − default.
- The RAPID moored-array anomaly overlaid on the 26.5°N time series
  (same 2004–2009 reference and 2-year filter — the project's standard
  RAPID protocol), plus a chip that reads the local trend against the
  mean-state sign (a positive trend on a negative cell = weakening).
- Light/dark theme (floating toggle, persisted) and shareable URLs: the
  selected products, cell, month, color limit, and diff mode live in the
  URL hash ("Copy link to this view").
- Mean overturning state (2004–2009 model baseline + reconstructed anomaly
  mean of the selected products), split into SMOC and AMOC sectors.
- Local anomaly time series with the total uncertainty envelope and the
  linear trend at the clicked cell, plus location presets (RAPID 26.5°N,
  45°N, abyssal 60°S). The envelope and trend belong to the default
  combination; the across-product spread is already a term of both.
- 2003–2024 trend map: OLS slope with ±2σ from the moving-block bootstrap
  combined with the ensemble, cross-model-transfer, and product-spread
  terms; thin diagonal hatching (the fig02 style) marks cells not significant
  after FDR control.
- Latitude–time Hovmöller diagram at a selected density level.
- Month-by-month snapshot with animation.

Hovering over any heatmap shows a value readout; clicking selects the cell.

## Files

- `index.html`, `app.js`, `styles.css` — the static viewer.
- `prepare_viewer_data.py` — reads the pipeline's RealWorld folder (the
  `NeurMOC_data.mat` export, the eight `Pred_RealWorld*.mat` combination
  reconstructions, `../moc_baseline.npz`, and the `Rapid_LPF.npz` record)
  and writes:
  - `data/neurmoc_meta.json` (~280 KB): axes, exact month labels, baseline
    mean state, per-combination anomaly means, trend statistics (point +
    FDR masks), product-axis labels, the RAPID 26.5°N anomaly series, and
    the binary descriptors.
  - `data/neurmoc_core.bin` (~2.6 MB): int16 at 0.005 Sv — the default
    combination's anomaly cube `pred[t,k,j]` followed by its total
    uncertainty; enough to render the page.
  - `data/neurmoc_combos.bin` (~9.2 MB): the seven other combinations
    `pred[c,t,k,j]` (index = obp·4 + ssh·2 + wind), streamed in the
    background after first paint. NaN cells encode as int16 min.
  - refreshed copies of `NeurMOC_data.mat` / `.nc` for the download links.
- `make_og_image.py` — renders `og_image.png` (the social-link preview
  card) from the meta file's trend map; rerun after regenerating data.

## Updating the data

Regenerate the pipeline products (stage 14 for all product combinations,
stage 15 for the budget, fig02 for the export — `run_trend_budget_all_inputs.py`
does the whole chain), then from this directory:

```powershell
py -3 .\prepare_viewer_data.py            # default: the m26r2 reference network
py -3 .\prepare_viewer_data.py --realworld <RealWorld folder>
```

The script validates that the default combination reproduces the
`NeurMOC_data` export before writing anything, then run
`py -3 make_og_image.py` to refresh the social card. Bump the `?v=` query
strings in `index.html` (stylesheet + script) when changing
`app.js`/`styles.css`, and the `META_PATH` stamp at the top of `app.js`
after regenerating data (it gates the metadata fetch); the binaries
themselves are cache-busted automatically by content hash.

## Launch locally

```powershell
py -3 -m http.server 8000     # from this directory, then open localhost:8000
```

or `powershell -ExecutionPolicy Bypass -File .\start_viewer.ps1`.

## Notes

- Array order is `[combo, time, density, latitude]`; density is σ₂ and
  increases downward in the plots.
- Month labels come from the pipeline's explicit `time_month` coordinates
  (the v1 float-derived labels shifted every December into January).
- Trend, its ±2σ CI, and both significance masks are read directly from
  the export (no recomputation in the browser). Every panel — the map
  hatching, the time-series label, and the interpretation chip — uses the
  FDR-controlled mask; cells whose per-point ±2σ CI excludes zero but fail
  FDR control are labeled as exactly that.
- The displayed monthly envelope uses the DEBIASED cross-model transfer
  term (the manuscript's zero-bias displayed-band convention, main-text
  Fig 4); the downloadable NeurMOC_data files keep the conservative
  full-bias variant, so the viewer band is narrower than the file's
  uncertainty field by design.
- The GRACE/GRACE-FO gap window is shaded in the time-series panel.
- Plot fonts auto-enlarge (and ticks thin out) when panels are displayed
  much narrower than their 1200 px drawing resolution, so phones stay
  readable.
