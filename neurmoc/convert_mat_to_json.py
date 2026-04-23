from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import scipy.io as sio


@dataclass(frozen=True)
class Config:
    mat_path: Path
    output_path: Path
    decimals: int


def round_nested(values: np.ndarray, decimals: int) -> list:
    rounded = np.round(np.asarray(values, dtype=np.float32), decimals=decimals)
    return rounded.tolist()


def decimal_year_to_label(value: float) -> str:
    year = int(np.floor(value))
    month = int(np.round((value - year) * 12))
    if month < 1:
        month = 1
    if month == 13:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def build_payload(cfg: Config) -> dict:
    raw = sio.loadmat(cfg.mat_path)

    expected = {
        "NeroMOC",
        "NeroMOC_uncertainty",
        "NeroMOC_time",
        "GRACE_Gap_TimeRang",
        "NeroMOC_latitude",
        "NeroMOC_density",
        "NeroMOC_trend_mean",
        "NeroMOC_trend_ci95",
        "NeroMOC_trend_significant",
    }
    missing = sorted(name for name in expected if name not in raw)
    if missing:
        raise ValueError(f"Missing required variables in {cfg.mat_path.name}: {missing}")

    pred = np.asarray(raw["NeroMOC"], dtype=np.float32)
    pred_std = np.asarray(raw["NeroMOC_uncertainty"], dtype=np.float32)
    time_years = np.ravel(np.asarray(raw["NeroMOC_time"], dtype=np.float32))
    gap_time_range = np.ravel(np.asarray(raw["GRACE_Gap_TimeRang"], dtype=np.float32))
    latitudes = np.ravel(np.asarray(raw["NeroMOC_latitude"], dtype=np.float32))
    densities = np.ravel(np.asarray(raw["NeroMOC_density"], dtype=np.float32))
    trend = np.asarray(raw["NeroMOC_trend_mean"], dtype=np.float32)
    trend_ci95 = np.asarray(raw["NeroMOC_trend_ci95"], dtype=np.float32)
    trend_significant = np.asarray(raw["NeroMOC_trend_significant"]).astype(bool)

    if pred.ndim != 3:
        raise ValueError(f"Expected NeroMOC to be 3D, got shape {pred.shape}.")
    if pred_std.shape != pred.shape:
        raise ValueError(f"NeroMOC_uncertainty shape {pred_std.shape} does not match NeroMOC shape {pred.shape}.")
    if pred.shape[0] != time_years.size:
        raise ValueError(f"NeroMOC_time length {time_years.size} does not match time dimension {pred.shape[0]}.")
    if pred.shape[1] != densities.size:
        raise ValueError(f"NeroMOC_density length {densities.size} does not match density dimension {pred.shape[1]}.")
    if pred.shape[2] != latitudes.size:
        raise ValueError(f"NeroMOC_latitude length {latitudes.size} does not match latitude dimension {pred.shape[2]}.")
    if trend.shape != pred.shape[1:]:
        raise ValueError(f"NeroMOC_trend_mean shape {trend.shape} does not match [density, latitude] {pred.shape[1:]}.")
    if trend_ci95.shape != (2, pred.shape[1], pred.shape[2]):
        raise ValueError(
            f"NeroMOC_trend_ci95 shape {trend_ci95.shape} does not match expected shape {(2, pred.shape[1], pred.shape[2])}."
        )
    if trend_significant.shape != trend.shape:
        raise ValueError(
            f"NeroMOC_trend_significant shape {trend_significant.shape} does not match NeroMOC_trend_mean shape {trend.shape}."
        )
    if gap_time_range.size != 2:
        raise ValueError(f"GRACE_Gap_TimeRang must contain 2 values, got {gap_time_range.size}.")

    mean_yz = np.mean(pred, axis=0, dtype=np.float32)
    time_labels = [decimal_year_to_label(float(value)) for value in time_years]

    return {
        "title": "NeurMOC interactive viewer",
        "description": "Meridional overturning circulation reconstruction in latitude-density space.",
        "units": "Sv",
        "dimensions": {
            "time": int(pred.shape[0]),
            "density": int(pred.shape[1]),
            "latitude": int(pred.shape[2]),
        },
        "time_labels": time_labels,
        "time_years": round_nested(time_years, 6),
        "gap_time_range": round_nested(gap_time_range, 6),
        "latitudes": round_nested(latitudes, cfg.decimals),
        "densities": round_nested(densities, cfg.decimals),
        "mean_yz": round_nested(mean_yz, cfg.decimals),
        "pred_yz": round_nested(pred, cfg.decimals),
        "pred_yz_std": round_nested(pred_std, cfg.decimals),
        "trend": {
            "slope_per_year": round_nested(trend, cfg.decimals),
            "ci95": round_nested(trend_ci95, cfg.decimals),
            "significant": trend_significant.tolist(),
        },
        "metadata": {
            "source_file": cfg.mat_path.name,
            "generated_on": date.today().isoformat(),
            "time_axis_assumption": f"Using NeroMOC_time directly, from {time_labels[0]} to {time_labels[-1]}.",
            "array_order_assumption": "[time, density, latitude]",
            "density_definition": "Density sigma_2 from NeroMOC_density",
            "trend_method": "Using exported NeroMOC_trend_mean, NeroMOC_trend_ci95, and NeroMOC_trend_significant directly.",
        },
    }


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description="Convert NeroMOC_data.mat to JSON for the NeurMOC viewer.")
    parser.add_argument("--mat", dest="mat_path", default="data/NeroMOC_data.mat", help="Path to input MAT file.")
    parser.add_argument("--out", dest="output_path", default="data/neromoc_data.json", help="Path to output JSON file.")
    parser.add_argument("--decimals", type=int, default=4, help="Number of decimals to store in JSON.")
    args = parser.parse_args()
    return Config(
        mat_path=Path(args.mat_path),
        output_path=Path(args.output_path),
        decimals=args.decimals,
    )


def main() -> None:
    cfg = parse_args()
    payload = build_payload(cfg)
    cfg.output_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.output_path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=True), encoding="utf-8")
    print(f"Wrote {cfg.output_path} with {payload['dimensions']}.")
    print(payload["metadata"]["time_axis_assumption"])


if __name__ == "__main__":
    main()
