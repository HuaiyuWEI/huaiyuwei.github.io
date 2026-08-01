"""Prepare the NeurMOC viewer data files (v3: product ensemble, split binaries, RAPID overlay).

Reads the m26r2 reference-network products from the pipeline's RealWorld
folder and emits the files consumed by app.js:

- ``data/neurmoc_meta.json``: axes, exact month labels, the 2004-2009
  model-baseline mean state, per-combination anomaly means, trend
  statistics (serial-correlation-aware, +-2 sigma, with the FDR mask),
  the GRACE-gap window, product-axis labels, the RAPID 26.5N observed
  anomaly series (for the time-series overlay), and the binary
  descriptors.
- two little-endian int16 binaries at SCALE Sv per count, split so the
  viewer renders as soon as the default combination arrives and streams
  the rest in the background:
  - ``data/neurmoc_core.bin``: the default combination's ANOMALY
    reconstruction ``pred[t,k,j]`` followed by its total uncertainty
    ``std[t,k,j]``, C order;
  - ``data/neurmoc_combos.bin``: the seven non-default combinations
    ``pred[c,t,k,j]`` for c = 1..7.
  The combination index is obp*4 + ssh*2 + wind over the option axes
  [GRACE JPL, GRACE CSR] x [DUACS, NASA-SSH] x [CCMP, ERA5]; index 0 is
  the default (JPL + DUACS + CCMP), whose trimmed series must match the
  NeurMOC_data export bit-for-bit (validated here).

All combinations are aligned on the default export's edge-trimmed month
axis using each file's explicit ``time_month`` labels (which also fixes
the v1 December-labeling bug: Dec of year Y is Y+1.0 in the project's
decimal-year convention, which the old float-derived labels shifted into
January).

Usage:
    python prepare_viewer_data.py            # defaults below
    python prepare_viewer_data.py --realworld <RealWorld folder>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import scipy.io as sio
from scipy.signal import butter, sosfiltfilt

SCALE = 0.005  # Sv per int16 count; int16 range covers +-163.8 Sv
EDGE_MONTHS = 12

#: default pipeline location of the reference network's real-world products
REALWORLD_DEFAULT = (
    r"E:\NeurMOC_2026_data\results\m26r2\ACCESS_hist+SSP585"
    r"\FullDepth_PCAinY64_ResNet_Neur192x96x48_5foldCV_Reg0.01Drop0.2"
    r"_swishActivation_LPF2Year\obp_mascon_V7+ssh_mascon_V7+uas_mascon_V7"
    r"\RealWorld"
)

#: the pipeline's low-pass-filtered RAPID 26.5N transport record
RAPID_DEFAULT = (
    r"E:\NeurMOC_2026_data\processed\observations\insitu_v1\rapid"
    r"\Rapid_LPF.npz"
)

#: product axes: (meta key, display name, [(option label, file-stem tag)]).
#: The first option of each axis is the pipeline default (empty tag);
#: stage 14 suffixes concatenate in obp -> ssh -> wind order.
PRODUCT_AXES = [
    ("obp", "Ocean bottom pressure", [("GRACE JPL", ""), ("GRACE CSR", "_obpCSR")]),
    ("ssh", "Sea surface height", [("DUACS", ""), ("NASA-SSH", "_sshNASASSH")]),
    ("wind", "Surface wind", [("CCMP", ""), ("ERA5", "_ERA5wind")]),
]


@dataclass(frozen=True)
class Config:
    realworld: Path
    rapid: Path
    meta_path: Path
    core_path: Path
    combos_path: Path


def round_nested(values: np.ndarray, decimals: int = 4) -> list:
    return np.round(np.asarray(values, dtype=np.float64), decimals).tolist()


NAN_COUNT = np.iinfo(np.int16).min      # sentinel for invalid (masked) cells


def quantize(values: np.ndarray) -> np.ndarray:
    """int16 counts; NaN cells (outside the valid latitude-density plane,
    e.g. outcropped densities) encode as NAN_COUNT and decode to NaN."""
    finite = np.isfinite(values)
    counts = np.round(np.where(finite, values, 0.0) / SCALE)
    if np.abs(counts[finite.nonzero()]).max() >= np.iinfo(np.int16).max:
        raise ValueError(f"Values exceed int16 range at scale {SCALE}.")
    out = counts.astype("<i2")
    out[~finite] = NAN_COUNT
    return out


def month_labels(raw) -> np.ndarray:
    """Normalized YYYY-MM labels from a .mat time_month char/str array."""
    return np.char.strip(np.asarray(raw).astype(str).ravel())


def lowpass_obs(series: np.ndarray) -> np.ndarray:
    """Mirror neurmoc.filtering.lowpass with LPF_OBS: 5th-order Butterworth,
    cutoff 1/24 cycles per month, zero-phase, 24-sample reflect padding."""
    sos = butter(5, 1.0 / 24.0, btype="low", output="sos", fs=1.0)
    padded = np.pad(np.asarray(series, dtype=float), 24, mode="reflect")
    return sosfiltfilt(sos, padded)[24:-24]


def load_rapid_series(rapid_path: Path) -> dict:
    """The observed RAPID 26.5N anomaly for the time-series overlay.

    Mirrors the pipeline's single RAPID protocol (neurmoc/rapid.py):
    subtract the Jan 2004 - Dec 2009 mean computed on the FULL record
    (decimal-year bounds; RAPID starts 2004-04, so the effective window
    is Apr 2004 - Dec 2009), THEN trim EDGE_MONTHS from each end. The
    stored series is already 2-year low-pass filtered like the
    reconstruction, so the two curves are directly comparable anomalies
    on the same reference period.

    The uncertainty band is the McCarthy et al. per-deployment-era
    observational error (0.9 Sv; 1.0 for 2005-2006; 1.3 for 2007-2008),
    low-pass filtered exactly like the transport so it has no step
    discontinuities - the fig02 convention (rapid.py
    load_rapid(with_uncertainty=True)).
    """
    with np.load(rapid_path) as fh:
        series = np.asarray(fh["RAPID_monthly_LPF"], dtype=np.float64)
        t_year = np.asarray(fh["t_year"], dtype=np.float64)
        months = np.char.strip(np.asarray(fh["time_month"]).astype(str))
    ref = (t_year > 2004.0 + 1e-6) & (t_year <= 2010.0 + 1e-6)
    anomaly = series - np.nanmean(series[ref])
    unc = np.full(t_year.size, 0.9)
    unc[(t_year > 2005) & (t_year <= 2006)] = 1.0
    unc[(t_year > 2007) & (t_year <= 2008)] = 1.3
    uncertainty = lowpass_obs(unc)
    sl = slice(EDGE_MONTHS, -EDGE_MONTHS)
    return {
        "latitude": 26.5,
        "months": months[sl].tolist(),
        "time_years": round_nested(t_year[sl], 6),
        "anomaly_sv": round_nested(anomaly[sl], 4),
        "uncertainty_sv": round_nested(uncertainty[sl], 4),
        "note": ("RAPID array MOC transport, 2-year low-pass filtered and "
                 "referenced to its own 2004-2009 mean (effective window "
                 "Apr 2004 - Dec 2009), 12-month edge trim; the project's "
                 "standard RAPID protocol (neurmoc/rapid.py). The band is "
                 "the filtered per-deployment-era observational error; the "
                 "viewer shifts the curve to the displayed reconstruction's "
                 "mean over the shared months (zero-bias convention)."),
    }


def load_combo(realworld: Path, tag: str, canonical: np.ndarray) -> np.ndarray:
    """One combination's anomaly cube [t,k,j] on the canonical month axis."""
    mat = sio.loadmat(realworld / f"Pred_RealWorld{tag}.mat",
                      variable_names=["pred_yz", "time_month"])
    pred = np.asarray(mat["pred_yz"], dtype=np.float32)
    months = month_labels(mat["time_month"])[EDGE_MONTHS:-EDGE_MONTHS]
    pred = pred[EDGE_MONTHS:-EDGE_MONTHS]
    idx = {m: i for i, m in enumerate(months)}
    missing = [m for m in canonical if m not in idx]
    if missing:
        raise ValueError(
            f"Pred_RealWorld{tag}: {len(missing)} canonical months missing "
            f"(first: {missing[0]}); rerun stage 14 for this combination")
    return pred[[idx[m] for m in canonical]]


def main(cfg: Config) -> None:
    rw = cfg.realworld
    export = sio.loadmat(rw / "NeurMOC_data.mat")
    pred0 = np.asarray(export["NeurMOC"], dtype=np.float32)          # [t,k,j]
    std_total = np.asarray(export["NeurMOC_uncertainty"], dtype=np.float32)
    time_years = np.ravel(export["NeurMOC_time"]).astype(float)
    gap_time_range = np.ravel(export["GRACE_Gap_TimeRange"]).astype(float)
    latitudes = np.ravel(export["NeurMOC_latitude"]).astype(float)
    densities = np.ravel(export["NeurMOC_density"]).astype(float)
    trend = np.asarray(export["NeurMOC_trend_mean"], dtype=np.float32)
    trend_ci95 = np.asarray(export["NeurMOC_trend_ci95"], dtype=np.float32)
    sig_point = np.asarray(export["NeurMOC_trend_significant"]).astype(float)
    sig_fdr = np.asarray(export["NeurMOC_trend_significant_fdr"]).astype(float)
    run_id = str(np.ravel(export["run_id"])[0])

    nt, nk, nj = pred0.shape

    # canonical month axis: the default combination's labels, edge-trimmed;
    # must line up 1:1 with the export's time axis
    default = sio.loadmat(rw / "Pred_RealWorld.mat",
                          variable_names=["time_month"])
    canonical = month_labels(default["time_month"])[EDGE_MONTHS:-EDGE_MONTHS]
    if canonical.size != nt:
        raise ValueError(
            f"default combination has {canonical.size} trimmed months, the "
            f"NeurMOC_data export {nt} - regenerate both from one stage-14 run")

    # trends/uncertainty may be NaN outside the valid plane; the viewer
    # treats the sentinel as missing
    NAN_SENTINEL = -999.0
    trend_j = np.where(np.isfinite(trend), trend, NAN_SENTINEL)
    ci_j = np.where(np.isfinite(trend_ci95), trend_ci95, NAN_SENTINEL)

    # the 2004-2009 ACCESS training baseline: the mean state the anomalies
    # refer to (stored [lat, lev] -> [lev, lat])
    with np.load(rw.parent / "moc_baseline.npz") as fh:
        baseline = np.asarray(fh["MOC_baseline_mean"], dtype=np.float32).T
    if baseline.shape != (nk, nj):
        raise ValueError(f"baseline shape {baseline.shape} != {(nk, nj)}")
    baseline_j = np.where(np.isfinite(baseline), baseline, NAN_SENTINEL)

    # every product combination on the canonical axis, in index order
    # obp*4 + ssh*2 + wind
    combos, combo_meta = [], []
    for oi, (obp_label, otag) in enumerate(PRODUCT_AXES[0][2]):
        for si, (ssh_label, stag) in enumerate(PRODUCT_AXES[1][2]):
            for wi, (wind_label, wtag) in enumerate(PRODUCT_AXES[2][2]):
                tag = f"{otag}{stag}{wtag}"
                cube = load_combo(rw, tag, canonical)
                combos.append(cube)
                combo_meta.append({
                    "index": oi * 4 + si * 2 + wi,
                    "obp": obp_label, "ssh": ssh_label, "wind": wind_label,
                    "tag": tag or "(default)",
                })
    stack = np.stack(combos)                                  # [8,t,k,j]

    # validation: combination 0 IS the exported reconstruction
    if not np.allclose(stack[0], pred0, atol=1e-5):
        raise ValueError("default combination does not reproduce the "
                         "NeurMOC_data export - stale files?")

    # ---- monthly envelope with the pipeline's unpriced-cell fill ---------
    # The transfer term (MRI cross-model RMSE) is undefined where MRI has
    # no MOC truth (the abyssal densities). Mirror the
    # 15_compute_trend_budget convention (2026-08-01): every unpriced cell
    # takes the transfer term of the nearest PRICED level above it in the
    # same latitude column; columns with no priced level keep zero. The
    # other two terms (per-month ensemble spread, satellite-product
    # spread) are the cell's own.
    #
    # One envelope everywhere (2026-08-01): the DEBIASED transfer variant
    # - the manuscript's zero-bias display convention (fig02 / main-text
    # Fig 4) - is used for the displayed band AND is what the NeurMOC_data
    # export itself now carries, so the viewer band and the downloadable
    # uncertainty field are the same quantity (validated below).
    scen = np.asarray(
        sio.loadmat(rw.parent / "TestR2_MRI_SSP245.mat",
                    variable_names=["rmse_debiased_yz"])["rmse_debiased_yz"],
        dtype=np.float64)
    epi_mat = sio.loadmat(rw / "Pred_RealWorld.mat",
                          variable_names=["pred_yz_std"])
    epi = np.asarray(epi_mat["pred_yz_std"],
                     dtype=np.float64)[EDGE_MONTHS:-EDGE_MONTHS]
    with np.load(rw / "trend_error_budget.npz") as fh:
        sate_month = np.asarray(fh["sigma_sate_month"], dtype=np.float64)

    unpriced = ~np.isfinite(scen)
    lev_of_priced = np.where(~unpriced, np.arange(nk)[:, None], -1)
    src = np.maximum.accumulate(lev_of_priced, axis=0)
    scen_fill = np.where(
        src >= 0,
        np.take_along_axis(np.nan_to_num(scen, nan=0.0),
                           np.maximum(src, 0), axis=0),
        0.0)
    std_filled = np.sqrt(scen_fill[None] ** 2 + epi ** 2
                         + sate_month[None] ** 2).astype(np.float32)

    # decomposition check: at priced cells the rebuilt envelope must equal
    # the export's (proves the export carries the same debiased three-term
    # combination the viewer displays)
    priced3 = np.broadcast_to(~unpriced[None], std_filled.shape)
    if not np.allclose(std_filled[priced3], std_total[priced3], atol=2e-4):
        raise ValueError("rebuilt envelope does not reproduce "
                         "NeurMOC_uncertainty at priced cells - the export "
                         "is not the debiased variant (rerun fig02's export "
                         "cell) or its formula changed")
    transfer_filled = unpriced & (src >= 0)
    print(f"envelope fill: {int(transfer_filled.sum())} unpriced cells take "
          f"the deepest priced level above them "
          f"({int((unpriced & (src < 0)).sum())} columns without any priced "
          "level keep a zero transfer term); envelope = debiased variant, "
          "identical in the viewer and the downloadable files")

    rapid = load_rapid_series(cfg.rapid)
    # canonical-axis index of every RAPID month (-1 = outside the record),
    # so the viewer can mean-match the two curves over the shared months
    canon_idx = {m: i for i, m in enumerate(canonical)}
    rapid["time_index"] = [canon_idx.get(m, -1) for m in rapid["months"]]
    if min(rapid["time_index"]) < 0:
        raise ValueError("RAPID months extend outside the canonical axis; "
                         "check the edge trims")

    # split binaries: the core (default combination + its envelope) makes
    # the page interactive; the other seven combinations stream after it
    core_blob = quantize(stack[0]).tobytes() + quantize(std_filled).tobytes()
    combos_blob = quantize(stack[1:]).tobytes()
    cfg.core_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.core_path.write_bytes(core_blob)
    cfg.combos_path.write_bytes(combos_blob)
    # the v2 single-file binary this split replaces
    (cfg.core_path.parent / "neurmoc_series.bin").unlink(missing_ok=True)

    meta = {
        "title": "NeurMOC interactive viewer",
        "description": ("Meridional overturning circulation anomaly "
                        "reconstruction in latitude-density space, per "
                        "satellite product combination."),
        "units": "Sv",
        "convention": {
            "quantity": "overturning-streamfunction ANOMALY",
            "reference_period": "2004-01 to 2009-12",
            "note": ("The reconstruction is the anomaly relative to the "
                     "Jan 2004 - Dec 2009 mean, matching the GRACE "
                     "convention; the mean-state panel adds the training "
                     "model's 2004-2009 baseline for orientation."),
            "uncertainty": ("1-sigma envelope: quadrature of the DEBIASED "
                            "cross-model transfer RMSE, the ensemble "
                            "spread, and the satellite-product spread - "
                            "the manuscript's zero-bias display "
                            "convention; identical in the viewer and the "
                            "downloadable NeurMOC_data files."),
        },
        "dimensions": {"combos": len(combos), "time": nt,
                       "density": nk, "latitude": nj},
        "time_labels": canonical.tolist(),
        "time_years": round_nested(time_years, 6),
        "gap_time_range": round_nested(gap_time_range, 6),
        "latitudes": round_nested(latitudes, 4),
        "densities": round_nested(densities, 4),
        "nan_sentinel": NAN_SENTINEL,
        "transfer_filled": transfer_filled.astype(int).tolist(),
        "baseline_yz": round_nested(baseline_j, 4),
        "combo_mean_yz": [round_nested(c.mean(axis=0), 4) for c in stack],
        "products": {
            "axes": [{"key": key, "name": name,
                      "options": [label for label, _ in options]}
                     for key, name, options in PRODUCT_AXES],
            "combo_index": "obp*4 + ssh*2 + wind",
            "combos": combo_meta,
            "note": ("Every combination is an independent stage-14 "
                     "reconstruction with the same trained network; the "
                     "uncertainty envelope and trend statistics belong to "
                     "the default combination and already include the "
                     "across-product spread as a budget term."),
        },
        "trend": {
            "slope_per_year": round_nested(trend_j, 5),
            "ci95": round_nested(ci_j, 5),
            "significant": (sig_point > 0.5).tolist(),
            "significant_fdr": (sig_fdr > 0.5).tolist(),
            "method": ("OLS slope; +-2 sigma from a moving-block bootstrap "
                       "(48-month blocks) combined in quadrature with the "
                       "ensemble, cross-model-transfer and satellite-"
                       "product trend-error terms; map mask controls the "
                       "false-discovery rate (Benjamini-Hochberg)"),
        },
        "rapid": rapid,
        "series_encoding": {
            "dtype": "int16-le",
            "scale_sv": SCALE,
            "nan_count": int(NAN_COUNT),
        },
        # content hashes bust the browser cache on EVERY data change
        # (a generation-date param would miss same-day regenerations)
        "series_core": {
            "file": cfg.core_path.name,
            "order": ["pred_default[t,k,j]", "std[t,k,j]"],
            "shape": [nt, nk, nj],
            "byte_length": len(core_blob),
            "version": hashlib.sha1(core_blob).hexdigest()[:10],
        },
        "series_combos": {
            "file": cfg.combos_path.name,
            "order": ["pred[c,t,k,j] for c = 1..7"],
            "shape": [len(combos) - 1, nt, nk, nj],
            "byte_length": len(combos_blob),
            "version": hashlib.sha1(combos_blob).hexdigest()[:10],
        },
        "metadata": {
            "source_folder": "m26r2 reference network RealWorld products",
            "network": ("PCAinY64 ResNet 192x96x48 swish "
                        "(configs/manuscript_2026r2.json)"),
            "run_id": run_id,
            "generated_on": date.today().isoformat(),
            "array_order": "[combo, time, density, latitude]",
            "density_definition": "sigma_2",
            "period": f"{canonical[0]} to {canonical[-1]}",
        },
    }
    cfg.meta_path.write_text(json.dumps(meta, separators=(",", ":")),
                             encoding="utf-8")

    # refresh the downloadable products alongside the viewer data
    for name in ("NeurMOC_data.mat", "NeurMOC_data.nc"):
        shutil.copy2(rw / name, cfg.core_path.parent / name)

    err = np.abs(np.round(stack / SCALE) * SCALE - stack).max()
    print(f"wrote {cfg.core_path} ({len(core_blob) / 1e6:.2f} MB), "
          f"{cfg.combos_path} ({len(combos_blob) / 1e6:.2f} MB) and "
          f"{cfg.meta_path} ({cfg.meta_path.stat().st_size / 1e3:.0f} KB)")
    print(f"combos x [t,k,j] = {stack.shape}; period {canonical[0]}..; "
          f"max quantization error {err:.4f} Sv; RAPID overlay "
          f"{rapid['months'][0]}..{rapid['months'][-1]}")


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--realworld", default=REALWORLD_DEFAULT)
    parser.add_argument("--rapid", default=RAPID_DEFAULT)
    parser.add_argument("--meta", default="data/neurmoc_meta.json")
    parser.add_argument("--core", default="data/neurmoc_core.bin")
    parser.add_argument("--combos", default="data/neurmoc_combos.bin")
    args = parser.parse_args()
    return Config(Path(args.realworld), Path(args.rapid), Path(args.meta),
                  Path(args.core), Path(args.combos))


if __name__ == "__main__":
    main(parse_args())
