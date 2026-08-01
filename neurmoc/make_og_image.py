"""Render og_image.png (1200x630) for social-link previews.

Draws the real 2003-2024 trend map from data/neurmoc_meta.json under the
site title, in the manuscript's RdBu_r colormap, so shared links show the
actual result. Rerun after regenerating the viewer data:

    py -3 make_og_image.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "og_image.png"

BG = "#f3f9ff"
INK = "#1b2c3e"
MUTED = "#5c7186"
ACCENT = "#2f6f9f"
BASIN_BOUNDARY = -34.0

meta = json.loads((HERE / "data" / "neurmoc_meta.json").read_text("utf-8"))
trend = np.asarray(meta["trend"]["slope_per_year"], dtype=float)
trend[trend <= -900] = np.nan
lats = np.asarray(meta["latitudes"], dtype=float)
dens = np.asarray(meta["densities"], dtype=float)

fig = plt.figure(figsize=(12, 6.3), dpi=100)
fig.patch.set_facecolor(BG)

# colormap strip across the top (the hero's gradient bar)
bar = fig.add_axes([0, 0.985, 1, 0.015])
bar.imshow(np.linspace(-1, 1, 256)[None, :], cmap="RdBu_r", aspect="auto",
           vmin=-1, vmax=1)
bar.axis("off")

fig.text(0.055, 0.895, "NeurMOC", fontsize=44, fontweight="bold",
         family="serif", color=INK)
fig.text(0.055, 0.825,
         "Satellite-based monitoring of the ocean overturning circulation "
         "with deep learning",
         fontsize=17, color=ACCENT)
fig.text(0.055, 0.755,
         "Interactive viewer · monthly anomalies, Apr 2003 – Dec 2024 "
         "· every satellite product combination · measured error budget",
         fontsize=13, color=MUTED)

# the trend map, split into SMOC | AMOC like the viewer
split = int(np.searchsorted(lats, BASIN_BOUNDARY))
sections = [(slice(0, split), "SMOC"), (slice(split, None), "AMOC")]
widths = [split, lats.size - split]
x0, x1, gapw = 0.055, 0.97, 0.012
avail = (x1 - x0) - gapw
lefts = [x0, x0 + avail * widths[0] / sum(widths) + gapw]
for (sl, label), left, wfrac in zip(sections, lefts,
                                    [avail * w / sum(widths) for w in widths]):
    ax = fig.add_axes([left, 0.10, wfrac, 0.56])
    ax.set_facecolor("#e9ecef")
    ax.pcolormesh(lats[sl], np.arange(dens.size), trend[:, sl], cmap="RdBu_r",
                  vmin=-0.4, vmax=0.4, shading="nearest")
    ax.invert_yaxis()
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color(MUTED)
        spine.set_linewidth(0.8)
    ax.text(0.02, 0.94, label, transform=ax.transAxes, fontsize=15,
            fontweight="bold", color=INK, va="top")

fig.text(0.055, 0.03, "Overturning trend, 2003–2024 (Sv yr⁻¹, "
         "±0.4) · huaiyuwei.github.io/neurmoc", fontsize=12,
         color=MUTED)

fig.savefig(OUT, dpi=100, facecolor=BG)
print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")
