# NeurMOC Interactive Viewer

Browser-based viewer for the NeurMOC reconstruction (published at
https://huaiyuwei.github.io/neurmoc/). Vanilla HTML/CSS/JS, no build step.

Updated 2026-08-04 to the m26r3 reference network (PCAinY64 ResNet
192x96x48 swish): the reconstruction is now the overturning **anomaly**
relative to 2004–2009 (GRACE convention), the trend statistics use the
serial-correlation-aware budget with a propagated GRACE measurement-noise
term, the monthly input-product spread is time-dependent, and the viewer
carries **all eight production input combinations** so visitors can switch
inputs.

## What it shows

- An input-product selector (GRACE JPL/CSR × DUACS/NASA-SSH ×
  CCMP/ERA5): each of the eight production combinations is a separately
  generated stage-14 reconstruction by the same trained network. ERA5 is a
  reanalysis sensitivity input; all anomaly-series panels follow the selection.
  A "difference vs. default" toggle switches the anomaly heatmaps to
  selected − default.
- The RAPID moored-array anomaly overlaid on the 26.5°N time series
  (same 2004–2009 reference-period convention and 2-year filter — the project's standard
  RAPID protocol), plus a chip that reads the local trend against the
  mean-state sign (a positive trend on a negative cell = weakening).
- Light/dark theme (floating toggle, persisted) and shareable URLs: the
  selected products, cell, month, color limit, diff mode, and significance
  test live in the URL hash ("Copy link to this view"); `s=p` selects the
  ±2σ-only test, and its absence means the FDR default.
- Mean overturning state (the 2004–2009 ACCESS training-model baseline),
  split into SMOC and AMOC sectors. This orientation panel is independent
  of the selected input-product reconstruction.
- Local anomaly time series with the total uncertainty envelope and the
  linear trend at the clicked cell, plus location presets (RAPID 26.5°N,
  AMOC 40°N/equator/30°S, and Southern Ocean mid-depth/abyssal cells).
  The envelope and trend belong to the default combination. The envelope
  combines held-out-model mapping-error spread, network-ensemble spread,
  time-dependent across-product spread, and propagated GRACE measurement
  noise; the across-product and GRACE terms also enter the trend budget in
  trend space.
- 2003–2024 trend map: OLS slope with ±2σ from the moving-block bootstrap
  combined with measured ensemble-member trend spread, mapping-error spread
  measured in the cross-model test, input-product trend spread, and propagated
  GRACE measurement-noise trend spread; thin diagonal hatching (the fig02
  style) marks cells not significant under the selected test. A
  "Significance" control in that panel switches between the FDR-controlled
  gate (default, the manuscript's map convention) and the ±2σ test alone
  (the manuscript's single-cell convention); the choice drives the hatching,
  the time-series label and trend-line color, the interpretation chip, and
  the trend tooltip together, so the panels never disagree.
- Latitude–time Hovmöller diagram at a selected density level.
- Month-by-month snapshot with animation.

Hovering over any heatmap shows a value readout; clicking selects the cell.

## Files

- `index.html`, `app.js`, `styles.css` — the static viewer.
- `prepare_viewer_data.py` — reads the pipeline's RealWorld folder (the
  `NeurMOC_data.mat` export, the eight `Pred_RealWorld*.mat` combination
  reconstructions, `trend_error_budget.npz`, `grace_noise_budget.npz`, and the
  m26r3 `insitu_v2/Rapid_LPF.npz` record)
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

Regenerate the pipeline products with `scripts/run_stages_12_15_RealWorld.py`
(it runs stage 14 for every required product combination and stage 15 for the
mapping/product budget), run `scripts/16_grace_noise_montecarlo.py` to create
the GRACE measurement-noise budget, and then run
`scripts/fig02_real_world_test.py` to refresh the export. The driver
deliberately does not run stage 16 or figure scripts. From this directory:

```powershell
py -3 .\prepare_viewer_data.py
py -3 .\prepare_viewer_data.py --realworld <RealWorld folder>
```

The script validates that the default combination reproduces the
`NeurMOC_data` export, that the time-dependent product-spread month axis is an
exact match, and that the exported uncertainty reproduces its four source
terms before writing anything. Then run
`py -3 .\make_og_image.py` to refresh the social card. Bump the `?v=` query
strings in `index.html` (stylesheet + script) when changing
`app.js`/`styles.css`, and the `META_PATH` stamp at the top of `app.js`
after regenerating data (it gates the metadata fetch); the binaries
themselves are cache-busted automatically by content hash.

## Launch locally

```powershell
py -3 -m http.server 8000     # from this directory, then open localhost:8000
```

or `powershell -ExecutionPolicy Bypass -File .\start_viewer.ps1`. Add
`-RefreshData` only when you intentionally want to regenerate the viewer files
from the m26r3 pipeline defaults before serving them.

## Notes

- Array order is `[combo, time, density, latitude]`; density is σ₂ and
  increases downward in the plots.
- Month labels come from the pipeline's explicit `time_month` coordinates
  (the v1 float-derived labels shifted every December into January).
- Trend, its ±2σ CI, and both significance masks are read directly from
  the export (no recomputation in the browser); the trend panel's
  "Significance" control chooses which mask every panel displays (all of
  them read `sigField()` in app.js, so they can never diverge). Under the
  FDR default, cells whose per-point ±2σ CI excludes zero but fail FDR
  control are labeled as exactly that; FDR-significant cells are a strict
  subset of per-point ones, so switching to ±2σ only ever adds significant
  area.
- The monthly mapping-error term is the grand-centered sample standard
  deviation of held-out-model errors pooled across 15 MRI scenario-branch
  windows (3915 serially correlated branch-month values per fully supported
  cell), not the legacy debiased single-scenario transfer RMSE. The monthly
  input-product term is evaluated separately at every month.
- A 500-draw Monte Carlo experiment propagates JPL mascon measurement
  uncertainty through the reconstruction. Its record-RMS monthly spread and
  trend spread enter the public budget. This is complementary to the JPL/CSR
  product swap, which measures sensitivity to processing choices. The GRACE
  term excludes GIA, geocenter, and C20–C30 correction errors and therefore is
  not a complete estimate of every GRACE-related error source.
- The GRACE/GRACE-FO gap window is shaded in the time-series panel.
- In the local time-series panel, the reconstruction curve and uncertainty
  shading are blue when the default-product trend weakens the local 2004–2009
  mean overturning and red when it strengthens it. Thus, a positive trend is
  blue on a negative mean-state cell and red on a positive one. Near-zero
  mean-state cells use neutral gray. Nonsignificant dashed trends remain gray.
- The generated metadata records the exact pipeline run, dataset IDs, network,
  trend settings, uncertainty convention, and data hashes. The current release
  is `m26r3` (`access_hist_ssp585_v4`, `satellite_2026m05_v2`,
  `insitu_v2`).
- The MAT/NetCDF downloads contain the default JPL + DUACS + CCMP product.
  The compact viewer binaries contain all eight production combinations.
- The linked v1 preprint provides the original scientific context; the current
  `m26r3` reconstruction and revised uncertainty/trend workflow postdate it.
- Plot fonts auto-enlarge (and ticks thin out) when panels are displayed
  much narrower than their 1200 px drawing resolution, so phones stay
  readable.
