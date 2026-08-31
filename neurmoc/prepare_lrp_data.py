"""Prepare the NeurMOC viewer's LRP attribution data.

Reads the stage-20 full-plane sweep (``RelevanceAllCells.npz``) and emits
the files the viewer's attribution panel consumes:

- ``data/neurmoc_lrp.json``: the descriptor - mascon boxes, latitude-band
  grouping for the profile panel, chunk manifest with content hashes, the
  list of cells that have no attribution, and provenance.
- ``data/lrp/neurmoc_lrp_d<kk>.bin``: one chunk per density level, each
  holding all 140 latitudes at that level. A visitor clicking a cell
  downloads ~1.4 MB once and then moves along that density row for free.
  Shipping all 2520 cells in one file would be ~25 MB up front.

WHAT EACH CHUNK HOLDS (little-endian, C order, 140 cells)

    header[cell, 3]      float32   map_scale, map_clim99, accounting_scale
    maps[cell, 3, 1292]  int16     mean |relevance| per mascon, 0..32767
    accounting[cell, 4, 261] int16 signed relevance summed per covariate,
                                   then the internal-bias term

    Decode: ``maps * map_scale`` and ``accounting * accounting_scale``,
    both in Sv. ``map_clim99`` is the 99th percentile of the cell's three
    maps, which is the upper colour limit the manuscript figure uses
    (``AUTO_CLIM_PERCENTILE`` in Plot_LRP_manuscript.m). Quantization is
    against each cell's own maximum, so no value is clipped; a cell with
    no attribution encodes as NAN_COUNT throughout.

WHY THE ACCOUNTING IS DEMEANED
    The manuscript panel demeans every displayed curve (``ZERO_BIAS``).
    The exact LRP identity is

        prediction = SUM_c covariate_sum_c + internal_bias
                     + stabilizer_remainder + output_offset

    The offset is constant in time per network member, so demeaning
    removes it, and the stabilizer remainder is zero under LRP-0 with
    epsilon = 0 - measured at 2e-15 Sv, i.e. summation round-off, and
    asserted below against that floor. What is left is exactly what
    this file stores, and it sums to the demeaned reconstruction the
    viewer already plots. Demeaning is over the DISPLAYED window, so the
    viewer must demean its own target series over the same months.

ONE COMBINATION ONLY
    LRP relevance depends on the input values, so it is a property of one
    input combination. This export covers the DEFAULT combination
    (GRACE JPL + DUACS + CCMP) only; the panel must say so and must not
    appear to track the viewer's product selection.

Usage:
    python prepare_lrp_data.py
    python prepare_lrp_data.py --sweep <RelevanceAllCells.npz>
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import scipy.io as sio

#: quantization headroom: values map onto 0..COUNT_MAX against the cell max
COUNT_MAX = 32767
NAN_COUNT = np.iinfo(np.int16).min

#: the manuscript figure's upper colour limit (Plot_LRP_manuscript.m)
CLIM_PERCENTILE = 99

#: stage 20's sweep, and the mascon geometry whose basin_id == 1 subset is
#: the network's 1292-element input domain
SWEEP_DEFAULT = (
    r"E:\NeurMOC_2026_data\results\m26r5\ACCESS_hist+SSP585"
    r"\FullDepth_PCAinY64_ResNet_Neur192x96x48_5foldCV_Reg0.01Drop0.2"
    r"_swishActivation_LPF2Year\obp_mascon_V7+ssh_mascon_V7+uas_mascon_V7"
    r"\RealWorld\LRP\all_cells\lrp0_z_rule\RelevanceAllCells.npz"
)
GEOMETRY_DEFAULT = r"E:\NeurMOC_2026_data\reference\grids\Mascon_AtlSO.npz"
#: the stage-17 single-cell products, used to validate this export
PRODUCT_ROOT_DEFAULT = (
    r"E:\NeurMOC_2026_data\results\m26r5\ACCESS_hist+SSP585"
    r"\FullDepth_PCAinY64_ResNet_Neur192x96x48_5foldCV_Reg0.01Drop0.2"
    r"_swishActivation_LPF2Year\obp_mascon_V7+ssh_mascon_V7+uas_mascon_V7"
    r"\RealWorld\LRP"
)

#: display labels for the network's three covariate blocks, in feature order
COVARIATE_LABELS = [
    ("obp", "Ocean bottom pressure", "GRACE JPL"),
    ("ssh", "Sea surface height", "DUACS"),
    ("wind", "Zonal surface wind", "CCMP"),
]

#: the accounting identity must close this tightly against the stage-17
#: products, which store float32 member series
ACCOUNTING_TOLERANCE_SV = 1e-4
#: LRP-0 leaves no stabilizer remainder; this is the summation-round-off
#: floor below which the measured term is treated as the zero it is
STABILIZER_ROUNDOFF_SV = 1e-9
#: summing n_term int16 terms costs about half a step each; allow that
#: much per term before calling the decoded identity broken
IDENTITY_STEP_TOLERANCE = 1.0


@dataclass(frozen=True)
class Config:
    sweep: Path
    geometry: Path
    product_root: Path
    meta_path: Path
    out_json: Path
    out_dir: Path


def round_list(values, decimals: int = 4) -> list:
    return np.round(np.asarray(values, dtype=np.float64), decimals).tolist()


def load_geometry(path: Path) -> dict:
    """The 1292 mascons the network reads: basin_id == 1, in file order."""
    raw = np.load(path, allow_pickle=False)
    need = ["Basin_id", "lon_mascon_bound1", "lon_mascon_bound2",
            "lat_mascon_bound1", "lat_mascon_bound2", "flag_across_180",
            "lon_mascon_center", "lat_mascon_center"]
    missing = [k for k in need if k not in raw]
    if missing:
        raise KeyError(f"{path}: missing mascon geometry fields {missing}")
    select = np.asarray(raw["Basin_id"]).squeeze() == 1
    out = {k: np.asarray(raw[k]).squeeze()[select] for k in need[1:]}
    out["n"] = int(select.sum())
    return out


def latitude_bands(geometry: dict) -> dict:
    """Group mascons into their native latitude bands.

    The profile panel sums relevance within a band and divides by the
    number of mascons in it - a plain count, never an area weight, because
    relevance is additive across input cells. This mirrors the accumarray
    in Plot_LRP_manuscript.m so the viewer's profile is the same curve.
    """
    lower = np.asarray(geometry["lat_mascon_bound1"], dtype=float)
    upper = np.asarray(geometry["lat_mascon_bound2"], dtype=float)
    pairs = np.stack([lower, upper], axis=1)
    unique, index = np.unique(pairs, axis=0, return_inverse=True)
    centers = unique.mean(axis=1)
    stated = np.asarray(geometry["lat_mascon_center"], dtype=float)
    if np.max(np.abs(stated - centers[index])) > 1e-8:
        raise ValueError("mascon centres are inconsistent with their bounds")
    counts = np.bincount(index, minlength=centers.size)
    return {"latitude": centers, "index": index.astype(np.int16),
            "count": counts.astype(np.int32)}


def stage17_products(root: Path) -> list[tuple[str, int, Path]]:
    found = []
    if not root.is_dir():
        return found
    for directory in sorted(root.iterdir()):
        stored = directory / "lrp0_z_rule" / "Relevance.mat"
        if not stored.is_file():
            continue
        ref = sio.loadmat(stored,
                          variable_names=["target_valid_output_index_python"])
        index = int(np.asarray(ref["target_valid_output_index_python"]).ravel()[0])
        found.append((directory.name, index, stored))
    return found


def main(cfg: Config) -> None:
    sweep = np.load(cfg.sweep, allow_pickle=False)
    meta = json.loads(cfg.meta_path.read_text(encoding="utf-8"))

    latitudes = np.asarray(meta["latitudes"], dtype=float)
    densities = np.asarray(meta["densities"], dtype=float)
    n_lat, n_den = latitudes.size, densities.size

    # ---- the sweep must be on the viewer's own plane --------------------
    if not np.allclose(latitudes, np.asarray(sweep["moc_latitude_grid"], float)):
        raise ValueError("sweep latitudes differ from the viewer's axis")
    if not np.allclose(densities, np.asarray(sweep["moc_sigma2_grid"], float)):
        raise ValueError("sweep densities differ from the viewer's axis")
    relevance = np.asarray(sweep["relevance_abs_mean"], dtype=np.float64)
    n_cells, n_cov, n_mascon = relevance.shape
    if n_cells != n_lat * n_den:
        raise ValueError(
            f"sweep has {n_cells} cells; the viewer's plane has "
            f"{n_den} x {n_lat} = {n_lat * n_den}")
    # cell index == density * n_lat + latitude, the viewer's [k, j] C order
    if not np.array_equal(np.asarray(sweep["flat_grid_index"]),
                          np.arange(n_cells)):
        raise ValueError(
            "sweep cells are not the plane in C order; the chunk layout "
            "below assumes cell = density * n_latitude + latitude")

    # ---- time: trim the sweep's window to the viewer's -------------------
    sweep_months = np.char.strip(np.asarray(sweep["time_month"]).astype(str).ravel())
    view_months = np.asarray(meta["time_labels"], dtype=str)
    position = {label: i for i, label in enumerate(sweep_months)}
    missing = [m for m in view_months if m not in position]
    if missing:
        raise ValueError(
            f"{len(missing)} viewer months are absent from the LRP window "
            f"(first {missing[:3]}); the panels cannot be aligned")
    keep = np.array([position[m] for m in view_months], dtype=int)
    n_time = keep.size

    # ---- accounting: demeaned over the displayed window ------------------
    covariate = np.asarray(sweep["covariate_signed_mean"], dtype=np.float64)[:, keep, :]
    bias = np.asarray(sweep["internal_bias_mean"], dtype=np.float64)[:, keep]
    stabilizer = np.asarray(sweep["stabilizer_mean"], dtype=np.float64)[:, keep]
    learnable = np.asarray(sweep["learnable"], dtype=bool)

    # LRP-0 with epsilon = 0 leaves no stabilizer remainder, so this term is
    # zero up to summation round-off (measured at 2e-15 Sv, 1e-16 relative).
    # Anything larger would be a real accounting term that has to be
    # exported rather than documented away.
    stabilizer_worst = float(np.max(np.abs(stabilizer[learnable])))
    if stabilizer_worst > STABILIZER_ROUNDOFF_SV:
        raise ValueError(
            f"the stabilizer remainder reaches {stabilizer_worst:.3e} Sv, "
            f"above the {STABILIZER_ROUNDOFF_SV:.0e} Sv round-off floor; it "
            "is a real accounting term and must be exported, not documented "
            "away")

    # [cell, term, time] with terms = the three covariates then the bias
    accounting = np.concatenate(
        [np.transpose(covariate, (0, 2, 1)), bias[:, None, :]], axis=1)
    accounting -= accounting.mean(axis=2, keepdims=True)
    n_term = accounting.shape[1]

    # ---- per-cell scales -------------------------------------------------
    flat = relevance.reshape(n_cells, -1)
    map_max = np.nanmax(np.where(np.isfinite(flat), flat, -np.inf), axis=1)
    map_max = np.where(learnable & (map_max > 0), map_max, 1.0)
    clim99 = np.zeros(n_cells)
    if learnable.any():
        clim99[learnable] = np.percentile(flat[learnable], CLIM_PERCENTILE, axis=1)
    acct_max = np.max(np.abs(np.where(np.isfinite(accounting), accounting, 0.0)),
                      axis=(1, 2))
    acct_max = np.where(learnable & (acct_max > 0), acct_max, 1.0)

    map_scale = map_max / COUNT_MAX
    acct_scale = acct_max / COUNT_MAX

    # ---- quantize --------------------------------------------------------
    maps_q = np.full((n_cells, n_cov, n_mascon), NAN_COUNT, dtype="<i2")
    acct_q = np.full((n_cells, n_term, n_time), NAN_COUNT, dtype="<i2")
    good = learnable & np.isfinite(flat).all(axis=1)
    maps_q[good] = np.round(
        relevance[good] / map_scale[good, None, None]).astype("<i2")
    acct_q[good] = np.round(
        accounting[good] / acct_scale[good, None, None]).astype("<i2")
    if maps_q[good].min() < 0 or maps_q[good].max() > COUNT_MAX:
        raise ValueError("quantized relevance left the 0..COUNT_MAX range")

    # round-trip: quantization must be a display detail, not a data change
    worst_round_trip = 0.0
    if good.any():
        back = maps_q[good].astype(np.float64) * map_scale[good, None, None]
        worst_round_trip = float(
            np.max(np.abs(back - relevance[good]) / map_max[good, None, None]))
        if worst_round_trip > 2.0 / COUNT_MAX:
            raise ValueError(
                f"relevance round-trips to {worst_round_trip:.2e} of the cell "
                "maximum, worse than one quantization step")

    # ---- geometry and profile bands --------------------------------------
    geometry = load_geometry(cfg.geometry)
    if geometry["n"] != n_mascon:
        raise ValueError(
            f"geometry has {geometry['n']} basin_id == 1 mascons; the sweep "
            f"explains {n_mascon}")
    bands = latitude_bands(geometry)

    # ---- validate against the stage-17 single-cell products --------------
    checked, worst_map, worst_identity, worst_identity_steps = 0, 0.0, 0.0, 0.0
    for name, index, path in stage17_products(cfg.product_root):
        if index >= n_cells or not learnable[index]:
            continue
        stored = sio.loadmat(path, variable_names=[
            "relevance_abs_mean", "target_prediction_members", "target_sign"])
        expected = np.asarray(stored["relevance_abs_mean"], dtype=np.float64)
        if expected.ndim == 3:
            expected = expected.mean(axis=0)
        decoded = maps_q[index].astype(np.float64) * map_scale[index]
        scale = float(np.max(np.abs(expected))) or 1.0
        worst_map = max(worst_map, float(np.max(np.abs(decoded - expected))) / scale)

        # the demeaned identity: the exported terms must sum to the
        # demeaned reconstruction this cell's LRP forward pass produced.
        # Check it twice - once on the real values, which isolates a
        # genuine accounting error, and once on the decoded int16, where
        # summing n_term terms costs a few quantization steps by
        # construction and would otherwise mask that error.
        sign = float(np.ravel(stored["target_sign"])[0])
        prediction = np.asarray(stored["target_prediction_members"],
                                dtype=np.float64).mean(axis=0).ravel()[keep]
        prediction = prediction - prediction.mean()
        exact = accounting[index].sum(axis=0) * sign
        worst_identity = max(worst_identity,
                             float(np.max(np.abs(exact - prediction))))
        decoded_sum = (acct_q[index].astype(np.float64)
                       * acct_scale[index]).sum(axis=0) * sign
        steps = float(np.max(np.abs(decoded_sum - prediction))) / acct_scale[index]
        worst_identity_steps = max(worst_identity_steps, steps)
        checked += 1
    if not checked:
        raise SystemExit("no stage-17 product validated this export")
    if worst_identity > ACCOUNTING_TOLERANCE_SV:
        raise SystemExit(
            f"the demeaned accounting identity closes only to "
            f"{worst_identity:.3e} Sv, above the "
            f"{ACCOUNTING_TOLERANCE_SV:.0e} Sv tolerance")
    if worst_identity_steps > IDENTITY_STEP_TOLERANCE * n_term:
        raise SystemExit(
            f"the decoded identity is off by {worst_identity_steps:.1f} "
            f"quantization steps, more than the {IDENTITY_STEP_TOLERANCE} per "
            f"term that summing {n_term} int16 terms can explain")
    print(f"validated against {checked} stage-17 products:")
    print(f"  maps      worst relative difference {worst_map:.2e}")
    print(f"  accounting identity closes to       {worst_identity:.2e} Sv")
    print(f"  same after int16 decode             {worst_identity_steps:.1f} quantization steps")
    print(f"  quantization round-trip             {worst_round_trip:.2e} of cell max")

    # ---- write one chunk per density level -------------------------------
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    header = np.stack([map_scale, clim99, acct_scale], axis=1).astype("<f4")
    chunks = []
    for k in range(n_den):
        rows = slice(k * n_lat, (k + 1) * n_lat)
        blob = (header[rows].tobytes() + maps_q[rows].tobytes()
                + acct_q[rows].tobytes())
        path = cfg.out_dir / f"neurmoc_lrp_d{k:02d}.bin"
        path.write_bytes(blob)
        chunks.append({
            "file": f"{cfg.out_dir.name}/{path.name}",
            "density": float(densities[k]),
            "byte_length": len(blob),
            "version": hashlib.sha1(blob).hexdigest()[:10],
        })
    total_bytes = sum(c["byte_length"] for c in chunks)

    unlearnable = np.flatnonzero(~learnable).astype(int).tolist()
    descriptor = {
        "title": "NeurMOC layer-wise relevance propagation",
        "method": str(sweep["lrp_method"]),
        "units": "Sv per mascon",
        "combination": {
            "label": "GRACE JPL + DUACS + CCMP",
            "note": ("Relevance depends on the input values, so it is a "
                     "property of one input combination. These maps are for "
                     "the DEFAULT combination only and do not change with "
                     "the product selection."),
        },
        "covariates": [
            {"key": key, "label": label, "product": product}
            for key, label, product in COVARIATE_LABELS
        ],
        "dimensions": {
            "cells": int(n_cells), "latitude": int(n_lat),
            "density": int(n_den), "mascons": int(n_mascon),
            "covariates": int(n_cov), "time": int(n_time),
            "terms": int(n_term),
        },
        "cell_index": "density * n_latitude + latitude",
        "mascons": {
            "lon_bound1": round_list(geometry["lon_mascon_bound1"], 3),
            "lon_bound2": round_list(geometry["lon_mascon_bound2"], 3),
            "lat_bound1": round_list(geometry["lat_mascon_bound1"], 3),
            "lat_bound2": round_list(geometry["lat_mascon_bound2"], 3),
            "across_180": np.asarray(
                geometry["flag_across_180"]).astype(bool).tolist(),
            "note": ("Axis-aligned boxes in degrees east/north. A box flagged "
                     "across_180 wraps the date line and must be drawn as two "
                     "rectangles."),
        },
        "latitude_bands": {
            "latitude": round_list(bands["latitude"], 3),
            "mascon_band_index": bands["index"].astype(int).tolist(),
            "mascon_count": bands["count"].astype(int).tolist(),
            "note": ("Profile panel: sum each covariate's relevance within a "
                     "band, then divide by mascon_count. A plain count, never "
                     "an area weight - relevance is additive across inputs."),
        },
        "encoding": {
            "dtype": "int16-le",
            "count_max": COUNT_MAX,
            "nan_count": int(NAN_COUNT),
            "clim_percentile": CLIM_PERCENTILE,
            "chunk_order": [
                f"header[{n_lat},3] float32-le: map_scale, map_clim99, accounting_scale",
                f"maps[{n_lat},{n_cov},{n_mascon}] int16-le, multiply by map_scale",
                f"accounting[{n_lat},{n_term},{n_time}] int16-le, "
                "multiply by accounting_scale",
            ],
            "terms": [key for key, _, _ in COVARIATE_LABELS] + ["internal_bias"],
            "accounting_is_demeaned": True,
            "accounting_note": (
                "Terms are demeaned over the displayed window; the target "
                "series must be demeaned over the same months before "
                "overlaying. They then sum to the demeaned reconstruction: "
                "the constant output offset drops out and the stabilizer "
                "remainder is identically zero under LRP-0."),
            "stabilizer_identically_zero": True,
            "stabilizer_worst_sv": stabilizer_worst,
        },
        "chunks": chunks,
        "unlearnable_cells": unlearnable,
        "unlearnable_note": (
            "These cells had no target variance in training, so the network "
            "never learned them and they carry no attribution. They encode as "
            "nan_count throughout."),
        "validation": {
            "stage17_products": int(checked),
            "maps_worst_relative": float(worst_map),
            "accounting_identity_sv": float(worst_identity),
            "accounting_identity_steps": float(worst_identity_steps),
            "quantization_round_trip": float(worst_round_trip),
            "sweep_validation_worst_relative": float(
                sweep["validation_worst_relative"]),
        },
        "metadata": {
            "generated": date.today().isoformat(),
            "source": str(cfg.sweep),
            "geometry": str(cfg.geometry),
            "run_id": str(sweep["run_id"]),
            "training_experiment": str(sweep["training_experiment"]),
            "members": int(sweep["n_members"]),
        },
    }
    cfg.out_json.write_text(json.dumps(descriptor), encoding="utf-8")

    print(f"\nwrote {cfg.out_json.name} "
          f"({cfg.out_json.stat().st_size / 1e3:.0f} kB)")
    print(f"wrote {len(chunks)} chunks in {cfg.out_dir.name}/ "
          f"({total_bytes / 1e6:.1f} MB total, "
          f"{chunks[0]['byte_length'] / 1e6:.2f} MB each)")
    print(f"cells without attribution: {len(unlearnable)} of {n_cells}")


def parse_args() -> Config:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sweep", type=Path, default=Path(SWEEP_DEFAULT))
    parser.add_argument("--geometry", type=Path, default=Path(GEOMETRY_DEFAULT))
    parser.add_argument("--products", type=Path, default=Path(PRODUCT_ROOT_DEFAULT))
    parser.add_argument("--meta", type=Path,
                        default=here / "data" / "neurmoc_meta.json")
    parser.add_argument("--out-json", type=Path,
                        default=here / "data" / "neurmoc_lrp.json")
    parser.add_argument("--out-dir", type=Path, default=here / "data" / "lrp")
    args = parser.parse_args()
    return Config(sweep=args.sweep, geometry=args.geometry,
                  product_root=args.products, meta_path=args.meta,
                  out_json=args.out_json, out_dir=args.out_dir)


if __name__ == "__main__":
    main(parse_args())
