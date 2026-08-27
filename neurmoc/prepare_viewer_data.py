"""Prepare the NeurMOC viewer data files (v3: product ensemble, split binaries, RAPID overlay).

Reads the m26r3 reference-network products from the pipeline's RealWorld
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
  - ``data/neurmoc_combos.bin``: the non-default combinations
    ``pred[c,t,k,j]`` for c = 1..N-1.
  The combination index is obp*4 + ssh*2 + wind over the option axes
  [GRACE JPL, GRACE CSR] x [DUACS, NASA-SSH] x [CCMP, ERA5] (8
  combinations; the GSFC mascons are tested in the manuscript but
  excluded from the observing-system ensemble); index 0 is
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
    r"E:\NeurMOC_2026_data\results\m26r3\ACCESS_hist+SSP585"
    r"\FullDepth_PCAinY64_ResNet_Neur192x96x48_5foldCV_Reg0.01Drop0.2"
    r"_swishActivation_LPF2Year\obp_mascon_V7+ssh_mascon_V7+uas_mascon_V7"
    r"\RealWorld"
)

#: the pipeline's low-pass-filtered RAPID 26.5N transport record
RAPID_DEFAULT = (
    r"E:\NeurMOC_2026_data\processed\observations\insitu_v2\rapid"
    r"\Rapid_LPF.npz"
)

#: product axes: (meta key, display name, [(option label, file-stem tag)]).
#: The first option of each axis is the pipeline default (empty tag);
#: stage 14 suffixes concatenate in obp -> ssh -> wind order.
PRODUCT_AXES = [
    ("obp", "Ocean bottom pressure", [("GRACE JPL", ""), ("GRACE CSR", "_obpCSR")]),
    ("ssh", "Sea surface height", [("DUACS", ""), ("NASA-SSH", "_sshNASASSH")]),
    ("wind", "Zonal surface wind", [("CCMP", ""), ("ERA5", "_ERA5wind")]),
]


@dataclass(frozen=True)
class Config:
    realworld: Path
    rapid: Path
    meta_path: Path
    core_path: Path
    combos_path: Path
    trends_path: Path


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


def mat_string(export: dict, key: str, default: str = "unknown") -> str:
    """One stripped scalar string from a SciPy-loaded MATLAB export."""
    if key not in export or np.asarray(export[key]).size == 0:
        return default
    return str(np.asarray(export[key]).reshape(-1)[0]).strip()


def mat_strings(export: dict, key: str) -> list[str]:
    """All non-empty stripped strings from one MATLAB export field."""
    if key not in export or np.asarray(export[key]).size == 0:
        return []
    return [value for value in
            (str(item).strip()
             for item in np.asarray(export[key]).astype(str).ravel())
            if value]


def mat_int(export: dict, key: str, default: int) -> int:
    """One scalar integer from a SciPy-loaded MATLAB export."""
    if key not in export or np.asarray(export[key]).size == 0:
        return default
    return int(np.asarray(export[key]).reshape(-1)[0])


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
    run_id = mat_string(export, "run_id")
    trained_on = mat_string(export, "trained_on")
    training_experiment = mat_string(export, "training_experiment")
    cmip_dataset_id = mat_string(export, "cmip_dataset_id")
    satellite_dataset_id = mat_string(export, "satellite_dataset_id")
    uncertainty_definition = mat_string(export, "uncertainty_definition")
    sigma_map_estimator = mat_string(export, "sigma_map_estimator")
    sigma_map_cases = mat_strings(export, "sigma_map_cases")
    sigma_map_monthly_estimator = mat_string(
        export, "sigma_map_monthly_estimator")
    sigma_map_monthly_centering = mat_string(
        export, "sigma_map_monthly_centering")
    sigma_map_monthly_dependence = mat_string(
        export, "sigma_map_monthly_dependence")
    sigma_map_monthly_n_branch_windows = mat_int(
        export, "sigma_map_monthly_n_branch_windows", 0)
    sigma_map_monthly_months_per_branch = mat_int(
        export, "sigma_map_monthly_months_per_branch", 0)
    sigma_map_monthly_expected_nobs = mat_int(
        export, "sigma_map_monthly_expected_nobs", 0)
    grace_noise_mode = mat_string(export, "grace_noise_mode")
    grace_noise_draws = mat_int(export, "grace_noise_draws", 0)
    grace_noise_granule = mat_string(export, "grace_noise_granule")
    trend_method = mat_string(export, "trend_method", "mbb")
    trend_block_months = mat_int(export, "trend_block_months", 48)
    trend_n_boot = mat_int(export, "trend_n_boot", 1000)
    trend_seed = mat_int(export, "trend_seed", 0)
    trend_serial_description = {
        "mbb": ("circular moving-block bootstrap "
                f"({trend_block_months}-month blocks)"),
        "hac": f"Newey-West HAC estimator ({trend_block_months}-month lag)",
        "ar1": "parametric AR(1) residual bootstrap",
    }.get(trend_method, trend_method)

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

    # The m26r3 export carries the exact baseline used by the product.
    # Keep the parent-file fallback so older exports remain readable.
    if "NeurMOC_baseline" in export and export["NeurMOC_baseline"].size:
        baseline = np.asarray(export["NeurMOC_baseline"], dtype=np.float32)
    else:
        with np.load(rw.parent / "moc_baseline.npz") as fh:
            baseline = np.asarray(fh["MOC_baseline_mean"],
                                  dtype=np.float32).T
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

    # ---- reconstruct the four-term monthly uncertainty envelope ----------
    # Stage 15 supplies the empirical monthly mapping-error magnitude and
    # the product-combination spread.  The latter is now explicitly
    # time-dependent [time, density, latitude], so its stored month axis must
    # match the reconstruction exactly. Stage 16 supplies the GRACE
    # measurement-noise term. The fourth term is the network-ensemble spread
    # saved by stage 14. Rebuild their quadrature sum independently and require
    # it to reproduce the exported envelope before writing website data.
    epi_mat = sio.loadmat(rw / "Pred_RealWorld.mat",
                          variable_names=["pred_yz_std"])
    epi = np.asarray(epi_mat["pred_yz_std"],
                     dtype=np.float64)[EDGE_MONTHS:-EDGE_MONTHS]
    with np.load(rw / "trend_error_budget.npz", allow_pickle=False) as fh:
        sigma_map_monthly = np.asarray(
            fh["sigma_map_monthly"], dtype=np.float64)
        sigma_map_monthly_cell = np.asarray(
            fh["sigma_map_monthly_cell"], dtype=np.float64)
        monthly_map_unpriced = np.asarray(
            fh["monthly_map_unpriced"], dtype=bool)
        sigma_map_monthly_nobs = np.asarray(
            fh["sigma_map_monthly_nobs"], dtype=np.int64)
        sate_month = np.asarray(fh["sigma_sate_month"], dtype=np.float64)
        sate_month_axis = np.asarray(fh["sate_month_axis"],
                                     dtype=np.int64)
        budget_map_estimator = str(
            np.asarray(fh["sigma_map_monthly_estimator"]).item()).strip()

    plane_shape = (nk, nj)
    cube_shape = (nt, nk, nj)
    for name, field in (
        ("network ensemble spread", epi),
        ("time-dependent product spread", sate_month),
    ):
        if field.shape != cube_shape:
            raise ValueError(f"{name} shape {field.shape} != {cube_shape}")
    for name, field in (
        ("monthly mapping spread", sigma_map_monthly),
        ("monthly mapping support", monthly_map_unpriced),
        ("monthly mapping nobs", sigma_map_monthly_nobs),
    ):
        if field.shape != plane_shape:
            raise ValueError(f"{name} shape {field.shape} != {plane_shape}")
    if budget_map_estimator != sigma_map_monthly_estimator:
        raise ValueError(
            "monthly mapping-error estimator differs between the stage-15 "
            "budget and NeurMOC_data export")
    sate_month_labels = sate_month_axis.astype(
        "datetime64[M]").astype(str)
    if not np.array_equal(sate_month_labels, canonical):
        raise ValueError(
            "time-dependent product-spread month axis does not match the "
            "reconstruction")

    grace_file = rw / "grace_noise_budget.npz"
    with np.load(grace_file, allow_pickle=False) as fh:
        #: time-resolved [t, k, j] - the granule uncertainty is per month
        #: and spikes across the GRACE/GRACE-FO gap, so fig02 stopped
        #: using the RMS-over-time sigma_grace_month; match it here or the
        #: envelope decomposition below will not reproduce the export
        grace_month = np.asarray(fh["sigma_grace_month_t"], dtype=np.float64)
        grace_trend = np.asarray(fh["sigma_grace"], dtype=np.float64)
        grace_month_axis = np.char.strip(
            np.asarray(fh["time_month"]).astype(str).ravel())
        budget_grace_mode = str(np.asarray(fh["central_mode"]).item()).strip()
        budget_grace_draws = int(np.asarray(fh["n_draws"]).item())
        budget_grace_granule = str(np.asarray(fh["granule"]).item()).strip()
        grace_sigma_source = str(np.asarray(fh["sigma_source"]).item()).strip()
        grace_complementary_to = str(
            np.asarray(fh["complementary_to"]).item()).strip()
    if grace_month.shape != (nt,) + plane_shape:
        raise ValueError(
            f"monthly GRACE noise shape {grace_month.shape} != "
            f"{(nt,) + plane_shape} - rerun 16_grace_noise_montecarlo.py "
            "for the time-resolved term")
    for name, field in (("monthly GRACE noise", grace_month),
                        ("trend GRACE noise", grace_trend)):
        if name == "trend GRACE noise" and field.shape != plane_shape:
            raise ValueError(f"{name} shape {field.shape} != {plane_shape}")
        if not np.isfinite(field).all() or np.any(field < 0):
            raise ValueError(f"{name} contains non-finite or negative values")
    if not np.array_equal(grace_month_axis, canonical):
        raise ValueError("GRACE-noise budget month axis does not match the "
                         "reconstruction")
    if (budget_grace_mode != grace_noise_mode
            or budget_grace_draws != grace_noise_draws
            or budget_grace_granule != grace_noise_granule):
        raise ValueError("GRACE-noise provenance differs between the stage-16 "
                         "budget and NeurMOC_data export")

    export_map_monthly = np.asarray(
        export["NeurMOC_mapping_uncertainty_monthly"], dtype=np.float64)
    export_map_unpriced = np.asarray(
        export["NeurMOC_mapping_uncertainty_monthly_unpriced"], dtype=bool)
    export_map_nobs = np.asarray(
        export["NeurMOC_mapping_uncertainty_monthly_nobs"], dtype=np.int64)
    export_sate_month = np.asarray(
        export["NeurMOC_satellite_uncertainty_monthly"], dtype=np.float64)
    export_grace_month = np.asarray(
        export["NeurMOC_grace_noise_uncertainty_monthly"], dtype=np.float64)
    export_grace_trend = np.asarray(
        export["NeurMOC_grace_noise_uncertainty_trend"], dtype=np.float64)
    for name, source, exported in (
        ("mapping spread", sigma_map_monthly, export_map_monthly),
        ("mapping support", monthly_map_unpriced, export_map_unpriced),
        ("mapping nobs", sigma_map_monthly_nobs, export_map_nobs),
        ("product spread", sate_month, export_sate_month),
        ("monthly GRACE noise", grace_month, export_grace_month),
        ("trend GRACE noise", grace_trend, export_grace_trend),
    ):
        if not np.allclose(source, exported, rtol=1e-10, atol=1e-12,
                           equal_nan=True):
            raise ValueError(f"{name} differs between its source budget and "
                             "NeurMOC_data export")

    if not all(np.isfinite(field).all() and np.all(field >= 0)
               for field in (sigma_map_monthly, epi, sate_month,
                             grace_month)):
        raise ValueError("monthly uncertainty terms must be finite and "
                         "non-negative")
    std_filled = np.sqrt(
        sigma_map_monthly[None, :, :] ** 2
        + epi ** 2
        + sate_month ** 2
        + grace_month ** 2
    ).astype(np.float32)

    # Cells lacking complete held-out-model support borrow the deepest
    # directly priced density level above them in the same latitude column.
    # Mark only cells for which such a source actually exists.
    lev_of_priced = np.where(~monthly_map_unpriced,
                             np.arange(nk)[:, None], -1)
    src = np.maximum.accumulate(lev_of_priced, axis=0)
    mapping_filled = monthly_map_unpriced & (src >= 0)
    if not np.allclose(
        sigma_map_monthly[mapping_filled],
        np.take_along_axis(sigma_map_monthly_cell,
                           np.maximum(src, 0), axis=0)[mapping_filled],
        rtol=1e-10, atol=1e-12,
    ):
        raise ValueError("filled monthly mapping-error cells do not match "
                         "their priced source level")

    # Full decomposition check: every source term and every cell must match.
    # The viewer writes the authoritative exported array after validation.
    if not np.allclose(std_filled, std_total, atol=2e-4, equal_nan=True):
        raise ValueError("rebuilt envelope does not reproduce "
                         "NeurMOC_uncertainty - the export and its source "
                         "budget are inconsistent")
    print(f"mapping fill: {int(mapping_filled.sum())} unpriced cells take "
          f"the deepest priced level above them "
          f"({int((monthly_map_unpriced & (src < 0)).sum())} cells without "
          "any priced level in their column keep a zero mapping term)")
    print("monthly envelope: mapping + network ensemble + time-dependent "
          "product spread + GRACE measurement noise; identical in the "
          "viewer and downloadable files")

    rapid = load_rapid_series(cfg.rapid)
    # canonical-axis index of every RAPID month (-1 = outside the record),
    # so the viewer can mean-match the two curves over the shared months
    canon_idx = {m: i for i, m in enumerate(canonical)}
    rapid["time_index"] = [canon_idx.get(m, -1) for m in rapid["months"]]
    if min(rapid["time_index"]) < 0:
        raise ValueError("RAPID months extend outside the canonical axis; "
                         "check the edge trims")

    # split binaries: the core (default combination + its envelope) makes
    # the page interactive; the other combinations stream after it
    core_blob = quantize(stack[0]).tobytes() + quantize(std_total).tobytes()
    combos_blob = quantize(stack[1:]).tobytes()
    cfg.core_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.core_path.write_bytes(core_blob)
    cfg.combos_path.write_bytes(combos_blob)

    # ---- per-combination trend statistics (stage 18) --------------------
    # The viewer lets a visitor switch input products, so its map,
    # hatching and per-cell trend readouts must follow that choice. Stage
    # 17 re-runs the project's trend estimator on each combination with
    # the published budget terms held fixed (sigma_sate included), so only
    # the slope and the bootstrap serial term move. Combination 0 is
    # validated against the export both there and again here.
    trend_stats_file = rw / "combination_trend_stats.npz"
    if not trend_stats_file.is_file():
        raise SystemExit(
            f"{trend_stats_file.name} missing - run "
            "scripts/18_combination_trends.py for this network")
    with np.load(trend_stats_file, allow_pickle=False) as fh:
        ct_slope = np.asarray(fh["slope_per_year"], dtype=np.float32)
        ct_interval = np.asarray(fh["slope_interval_2sigma"], dtype=np.float32)
        ct_sig = np.asarray(fh["significant"]).astype(bool)
        ct_sig_fdr = np.asarray(fh["significant_fdr"]).astype(bool)
        ct_testable = np.asarray(fh["testable"]).astype(bool)
        ct_tags = [str(t) for t in np.asarray(fh["combo_tags"])]
        ct_run_id = str(np.asarray(fh["run_id"]).item())
        ct_months = np.asarray(fh["time_month_int"], dtype=np.int64)
        ct_trimmed = np.asarray(fh["months_trimmed"], dtype=int).tolist()
        ct_n_boot = int(np.asarray(fh["n_boot"]).item())
        ct_block = int(np.asarray(fh["block_months"]).item())
        ct_sate_included = bool(np.asarray(fh["sigma_sate_included"]).item())
    if ct_slope.shape != (len(combos), nk, nj):
        raise SystemExit(
            f"combination_trend_stats has shape {ct_slope.shape}; expected "
            f"{(len(combos), nk, nj)} - rerun stage 18 for this network")
    if ct_run_id != run_id:
        raise SystemExit(
            f"combination_trend_stats is from run {ct_run_id} but the export "
            f"is {run_id} - rerun stage 18")
    if ct_months.size != nt:
        raise SystemExit(
            f"combination_trend_stats covers {ct_months.size} months, the "
            f"export {nt} - rerun stage 18 against this reconstruction")
    # combination 0 IS the exported trend (stage 18 asserts the masks too)
    _finite = np.isfinite(trend) & np.isfinite(ct_slope[0])
    if not np.allclose(ct_slope[0][_finite], trend[_finite], atol=1e-6):
        raise SystemExit(
            "combination 0 of combination_trend_stats does not reproduce "
            "NeurMOC_trend_mean - stale files?")
    # half-width of the +-2 sigma interval; symmetric by construction, so
    # "slope +- half" restates the interval the significance rule uses.
    # The stored interval is [combo, bound, k, j] - index the BOUND axis,
    # not the combination axis
    if ct_interval.shape != (len(combos), 2, nk, nj):
        raise SystemExit(
            f"slope_interval_2sigma has shape {ct_interval.shape}; expected "
            f"{(len(combos), 2, nk, nj)} - rerun stage 18")
    ct_half = np.abs(ct_interval[:, 1] - ct_interval[:, 0]) / 2.0
    if ct_half.shape != ct_slope.shape:
        raise SystemExit(
            f"interval half-width shape {ct_half.shape} != slope shape "
            f"{ct_slope.shape}")
    # the half-width IS the per-point rule: |slope| > half <=> significant
    _chk = np.isfinite(ct_slope) & ct_testable
    if not np.array_equal(np.abs(ct_slope[_chk]) > ct_half[_chk],
                          ct_sig[_chk]):
        raise SystemExit(
            "the +-2 sigma interval and the per-point mask disagree - the "
            "significance rule and the exported interval have drifted")
    # cells outside the tested domain are reported as insignificant, the
    # same convention the export's NaN masks decode to in the viewer
    ct_sig = ct_sig & ct_testable
    ct_sig_fdr = ct_sig_fdr & ct_testable
    trends_blob = (
        ct_slope.astype("<f4").tobytes()
        + ct_half.astype("<f4").tobytes()
        + ct_sig.astype(np.uint8).tobytes()
        + ct_sig_fdr.astype(np.uint8).tobytes()
    )
    cfg.trends_path.write_bytes(trends_blob)
    # the v2 single-file binary this split replaces
    (cfg.core_path.parent / "neurmoc_series.bin").unlink(missing_ok=True)

    meta = {
        "title": "NeurMOC interactive viewer",
        "description": ("Meridional overturning circulation anomaly "
                        "reconstruction in latitude-density space, per "
                        "production input-product combination."),
        "units": "Sv",
        "convention": {
            "quantity": "overturning-streamfunction ANOMALY",
            "reference_period": "2004-01 to 2009-12",
            "note": ("The reconstruction is the anomaly relative to the "
                     "Jan 2004 - Dec 2009 mean, matching the GRACE "
                     "convention; the mean-state panel adds the training "
                     "model's 2004-2009 baseline for orientation."),
            "uncertainty": uncertainty_definition,
        },
        "dimensions": {"combos": len(combos), "time": nt,
                       "density": nk, "latitude": nj},
        "time_labels": canonical.tolist(),
        "time_years": round_nested(time_years, 6),
        "gap_time_range": round_nested(gap_time_range, 6),
        "gap_months": month_labels(export["GRACE_Gap_Months"]).tolist()
                      if "GRACE_Gap_Months" in export else [],
        "latitudes": round_nested(latitudes, 4),
        "densities": round_nested(densities, 4),
        "nan_sentinel": NAN_SENTINEL,
        "mapping_filled": mapping_filled.astype(int).tolist(),
        "baseline_yz": round_nested(baseline_j, 4),
        "combo_mean_yz": [round_nested(c.mean(axis=0), 4) for c in stack],
        "products": {
            "axes": [{"key": key, "name": name,
                      "options": [label for label, _ in options]}
                     for key, name, options in PRODUCT_AXES],
            "combo_index": "obp*4 + ssh*2 + wind",
            "combos": combo_meta,
            "note": ("Every combination is a separately generated stage-14 "
                     "reconstruction with the same trained network; the "
                     "uncertainty envelope and trend statistics belong to "
                     "the default combination and already include the "
                     "across-product spread as a budget term. Its monthly "
                     "contribution is evaluated separately at every month."),
        },
        "uncertainty_budget": {
            "combination": ("terms combined in quadrature; independence "
                            "among terms is not demonstrated"),
            "monthly": {
                "units": "Sv",
                "terms": [
                    {
                        "key": "mapping_error",
                        "label": "held-out-model mapping-error spread",
                        "time_dependent": False,
                        "estimator": sigma_map_monthly_estimator,
                        "centering": sigma_map_monthly_centering,
                        "cases": sigma_map_cases,
                        "branch_windows": sigma_map_monthly_n_branch_windows,
                        "months_per_branch":
                            sigma_map_monthly_months_per_branch,
                        "samples_per_priced_cell":
                            sigma_map_monthly_expected_nobs,
                        "dependence_note": sigma_map_monthly_dependence,
                    },
                    {
                        "key": "network_ensemble",
                        "label": "network-ensemble spread",
                        "time_dependent": True,
                    },
                    {
                        "key": "input_product_choice",
                        "label": "input-product-combination spread",
                        "time_dependent": True,
                        "month_axis": f"{canonical[0]} to {canonical[-1]}",
                    },
                    {
                        "key": "grace_measurement_noise",
                        "label": "propagated GRACE measurement noise",
                        "time_dependent": False,
                        "summary": "RMS monthly spread over the record",
                        "mode": grace_noise_mode,
                        "draws": grace_noise_draws,
                    },
                ],
            },
            "trend": {
                "units": "Sv yr-1",
                "terms": [
                    "serially correlated residual variability",
                    "network-ensemble member trend spread",
                    "held-out-model mapping-error trend spread",
                    "input-product-combination trend spread",
                    "propagated GRACE measurement-noise trend spread",
                ],
            },
            "grace_noise": {
                "file": "grace_noise_budget.npz",
                "mode": grace_noise_mode,
                "draws": grace_noise_draws,
                "granule": grace_noise_granule,
                "source": grace_sigma_source,
                "relationship_to_product_spread": grace_complementary_to,
            },
        },
        "trend": {
            "slope_per_year": round_nested(trend_j, 5),
            "ci95": round_nested(ci_j, 5),
            "significant": (sig_point > 0.5).tolist(),
            "significant_fdr": (sig_fdr > 0.5).tolist(),
            "method": (f"OLS slope; +-2 sigma where sigma combines serial "
                       f"residual uncertainty from a "
                       f"{trend_serial_description}, "
                       "measured ensemble-member trend spread, mapping-error "
                       "spread measured in cross-model transfer windows, and "
                       "observation/reanalysis input-product trend spread, "
                       "and propagated GRACE measurement-noise trend spread; "
                       "the map mask applies "
                       "Benjamini-Hochberg false-discovery-rate control and "
                       "is intersected with the +-2 sigma rule"),
            "settings": {
                "method": trend_method,
                "block_months": trend_block_months,
                "n_boot": trend_n_boot,
                "seed": trend_seed,
            },
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
            "order": ["pred[c,t,k,j] for c = 1..N-1"],
            "shape": [len(combos) - 1, nt, nk, nj],
            "byte_length": len(combos_blob),
            "version": hashlib.sha1(combos_blob).hexdigest()[:10],
        },
        "trend_combos": {
            "file": cfg.trends_path.name,
            "order": ["slope[c,k,j] float32-le",
                      "half_width_2sigma[c,k,j] float32-le",
                      "significant[c,k,j] uint8",
                      "significant_fdr[c,k,j] uint8"],
            "shape": [len(combos), nk, nj],
            "byte_length": len(trends_blob),
            "version": hashlib.sha1(trends_blob).hexdigest()[:10],
            "combo_tags": ct_tags,
            "months_trimmed_to_default_window": ct_trimmed,
            "sigma_sate_included": ct_sate_included,
            "note": ("Per-combination trend statistics from stage 18: the "
                     "same estimator and the same published budget terms as "
                     "the manuscript, re-run on each combination's "
                     "reconstruction over the DEFAULT combination's window. "
                     "Only the OLS slope and the moving-block-bootstrap "
                     "serial term depend on the combination; the "
                     "mapping-error, ensemble, input-product and GRACE "
                     "terms are properties of the network and observing "
                     "system and are held fixed. Combination 0 reproduces "
                     "the NeurMOC_data export exactly. Slopes are NaN "
                     f"outside the valid plane. MBB {ct_block}-month "
                     f"blocks, {ct_n_boot} draws."),
        },
        "metadata": {
            "source_folder": f"{run_id} reference-network RealWorld products",
            "network": training_experiment,
            "trained_on": trained_on,
            "scientific_profile": f"configs/manuscript_2026{run_id[3:]}.json"
                                  if run_id.startswith("m26r") else "unknown",
            "run_id": run_id,
            "cmip_dataset_id": cmip_dataset_id,
            "satellite_dataset_id": satellite_dataset_id,
            "insitu_dataset_id": next(
                (part for part in cfg.rapid.parts
                 if part.lower().startswith("insitu_")), "unknown"),
            "rapid_source": "/".join(cfg.rapid.parts[-3:]),
            "sigma_map_estimator": sigma_map_estimator,
            "sigma_map_cases": sigma_map_cases,
            "sigma_map_monthly_estimator": sigma_map_monthly_estimator,
            "sigma_map_monthly_n_branch_windows":
                sigma_map_monthly_n_branch_windows,
            "sigma_map_monthly_months_per_branch":
                sigma_map_monthly_months_per_branch,
            "sigma_map_monthly_expected_nobs":
                sigma_map_monthly_expected_nobs,
            "product_spread_monthly_time_dependent": True,
            "grace_noise_mode": grace_noise_mode,
            "grace_noise_draws": grace_noise_draws,
            "grace_noise_granule": grace_noise_granule,
            "uncertainty_definition": uncertainty_definition,
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
          f"{cfg.combos_path} ({len(combos_blob) / 1e6:.2f} MB), "
          f"{cfg.trends_path} ({len(trends_blob) / 1e3:.0f} KB) and "
          f"{cfg.meta_path} ({cfg.meta_path.stat().st_size / 1e3:.0f} KB)")
    _fdr_frac = [float((ct_sig_fdr[c] & ct_testable[c]).sum()
                       / max(ct_testable[c].sum(), 1))
                 for c in range(len(combos))]
    print("per-combination FDR-significant fraction: "
          + ", ".join(f"{tag}={f:.1%}" for tag, f in zip(ct_tags, _fdr_frac)))
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
    parser.add_argument("--trends", default="data/neurmoc_trends.bin")
    args = parser.parse_args()
    return Config(Path(args.realworld), Path(args.rapid), Path(args.meta),
                  Path(args.core), Path(args.combos), Path(args.trends))


if __name__ == "__main__":
    main(parse_args())
