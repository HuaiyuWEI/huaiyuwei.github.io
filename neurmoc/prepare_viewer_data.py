"""Prepare the NeurMOC viewer data files from NeroMOC_data.mat.

Emits two files consumed by app.js:

- ``data/neurmoc_meta.json``  (~100 KB): axes, labels, time-mean field,
  trend statistics, GRACE-gap window, and the binary-series descriptor.
- ``data/neurmoc_series.bin`` (~2.5 MB): the monthly reconstruction and its
  uncertainty as little-endian int16, quantized at SCALE Sv (0.005 by
  default - far below plotting precision), stored as
  ``pred[t,k,j]`` followed by ``std[t,k,j]`` in C order.

This replaces the original single-JSON export (23.7 MB of full-precision
floats), which took several seconds to download and parse in the browser.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import scipy.io as sio

SCALE = 0.005  # Sv per int16 count; int16 range covers +-163.8 Sv


@dataclass(frozen=True)
class Config:
    mat_path: Path
    meta_path: Path
    bin_path: Path


def round_nested(values: np.ndarray, decimals: int = 4) -> list:
    return np.round(np.asarray(values, dtype=np.float64), decimals).tolist()


def decimal_year_to_label(value: float) -> str:
    year = int(np.floor(value))
    month = int(np.round((value - year) * 12))
    if month < 1:
        month = 1
    if month == 13:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def quantize(values: np.ndarray) -> np.ndarray:
    if not np.isfinite(values).all():
        raise ValueError("Series contains non-finite values; cannot quantize.")
    counts = np.round(values / SCALE)
    if np.abs(counts).max() >= np.iinfo(np.int16).max:
        raise ValueError(f"Values exceed int16 range at scale {SCALE}.")
    return counts.astype("<i2")


def main(cfg: Config) -> None:
    raw = sio.loadmat(cfg.mat_path)

    pred = np.asarray(raw["NeroMOC"], dtype=np.float32)            # [t, k, j]
    pred_std = np.asarray(raw["NeroMOC_uncertainty"], dtype=np.float32)
    time_years = np.ravel(raw["NeroMOC_time"]).astype(float)
    gap_time_range = np.ravel(raw["GRACE_Gap_TimeRang"]).astype(float)
    latitudes = np.ravel(raw["NeroMOC_latitude"]).astype(float)
    densities = np.ravel(raw["NeroMOC_density"]).astype(float)
    trend = np.asarray(raw["NeroMOC_trend_mean"], dtype=np.float32)
    trend_ci95 = np.asarray(raw["NeroMOC_trend_ci95"], dtype=np.float32)
    trend_significant = np.asarray(raw["NeroMOC_trend_significant"]).astype(bool)

    nt, nk, nj = pred.shape
    if pred_std.shape != pred.shape:
        raise ValueError(f"uncertainty shape {pred_std.shape} != {pred.shape}")
    if (time_years.size, densities.size, latitudes.size) != (nt, nk, nj):
        raise ValueError("axis lengths do not match the NeroMOC cube")
    if trend.shape != (nk, nj) or trend_ci95.shape != (2, nk, nj):
        raise ValueError("trend arrays do not match [density, latitude]")

    blob = quantize(pred).tobytes() + quantize(pred_std).tobytes()
    cfg.bin_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.bin_path.write_bytes(blob)

    time_labels = [decimal_year_to_label(v) for v in time_years]
    meta = {
        "title": "NeurMOC interactive viewer",
        "description": "Meridional overturning circulation reconstruction in latitude-density space.",
        "units": "Sv",
        "dimensions": {"time": nt, "density": nk, "latitude": nj},
        "time_labels": time_labels,
        "time_years": round_nested(time_years, 6),
        "gap_time_range": round_nested(gap_time_range, 6),
        "latitudes": round_nested(latitudes, 4),
        "densities": round_nested(densities, 4),
        "mean_yz": round_nested(pred.mean(axis=0), 4),
        "trend": {
            "slope_per_year": round_nested(trend, 5),
            "ci95": round_nested(trend_ci95, 5),
            "significant": trend_significant.tolist(),
        },
        "series_bin": {
            "file": cfg.bin_path.name,
            "dtype": "int16-le",
            "scale_sv": SCALE,
            "order": ["pred", "std"],
            "shape": [nt, nk, nj],
            "byte_length": len(blob),
        },
        "metadata": {
            "source_file": cfg.mat_path.name,
            "generated_on": date.today().isoformat(),
            "array_order": "[time, density, latitude]",
            "density_definition": "sigma_2 from NeroMOC_density",
            "period": f"{time_labels[0]} to {time_labels[-1]}",
        },
    }
    cfg.meta_path.write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")

    err = np.abs(np.round(pred / SCALE) * SCALE - pred).max()
    print(f"wrote {cfg.bin_path} ({len(blob) / 1e6:.2f} MB) "
          f"and {cfg.meta_path} ({cfg.meta_path.stat().st_size / 1e3:.0f} KB)")
    print(f"dims [t,k,j] = {pred.shape}; max quantization error {err:.4f} Sv")


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mat", default="data/NeroMOC_data.mat")
    parser.add_argument("--meta", default="data/neurmoc_meta.json")
    parser.add_argument("--bin", default="data/neurmoc_series.bin")
    args = parser.parse_args()
    return Config(Path(args.mat), Path(args.meta), Path(args.bin))


if __name__ == "__main__":
    main(parse_args())
