const META_PATH = "./data/neurmoc_meta.json?v=2026-07-31a";
const DATA_DIR = "./data/";

const state = {
  data: null,
  combo: { obp: 0, ssh: 0, wind: 0 },   // option index per product axis
  climAnom: 4,                          // snapshot + Hovmoller (anomalies)
  timeIndex: 0,
  densityIndex: 0,
  latitudeIndex: 0,
  clim: 20,                             // mean-state panel (full field)
  trendClim: 0.4,
  playbackSpeed: "normal",
  playing: false,
  timer: null,
};

const controls = {
  timeSlider: document.getElementById("time-slider"),
  densitySelect: document.getElementById("density-select"),
  climSlider: document.getElementById("clim-slider"),
  timeLabel: document.getElementById("time-label"),
  climLabel: document.getElementById("clim-label"),
  playButton: document.getElementById("play-button"),
  speedControl: document.getElementById("speed-control"),
  productBar: document.getElementById("product-bar"),
  productComboLabel: document.getElementById("product-combo-label"),
  presetRow: document.getElementById("preset-row"),
  copyBibtex: document.getElementById("copy-bibtex"),
  selectedLatitude: document.getElementById("selected-latitude"),
  selectedDensity: document.getElementById("selected-density"),
  selectedValue: document.getElementById("selected-value"),
  selectedStd: document.getElementById("selected-std"),
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingBarFill: document.getElementById("loading-bar-fill"),
  loadingStatus: document.getElementById("loading-status"),
  tooltip: document.getElementById("plot-tooltip"),
};

const PLAYBACK_INTERVALS = {
  slow: 84,
  normal: 42,
  fast: 21,
};

const sectionCanvas = document.getElementById("section-canvas");
const snapshotCanvas = document.getElementById("snapshot-canvas");
const hovmollerCanvas = document.getElementById("hovmoller-canvas");
const trendCanvas = document.getElementById("trend-canvas");
const timeseriesSvg = document.getElementById("timeseries-svg");
const BASIN_BOUNDARY = -34;

/* ---------------- formatting helpers ---------------- */

function formatLatitude(value) {
  const deg = Math.abs(value).toFixed(1).replace(".0", "");
  if (value < 0) {
    return `${deg}°S`;
  }
  if (value > 0) {
    return `${deg}°N`;
  }
  return "0°";
}

function formatDensity(value) {
  return `${value.toFixed(1)}`;
}

function hovmollerDensityTitle(value) {
  return `σ₂ = ${formatDensity(value)} kg m⁻³`;
}

function roundValue(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function formatColorbarTick(value, digits = 0) {
  return Number(value).toFixed(digits);
}

function buildYearAxisTicks(timeYears) {
  const years = timeYears.map((value) => Number(value));
  const startYear = Math.ceil(years[0]);
  const endYear = Math.floor(years[years.length - 1]);
  const firstMajor = Math.ceil(years[0] / 4) * 4;
  const majorYears = [];
  for (let year = firstMajor; year <= endYear; year += 4) {
    majorYears.push(year);
  }
  const majorSet = new Set(majorYears);
  const minorYears = [];
  for (let year = startYear; year <= endYear; year += 1) {
    if (!majorSet.has(year)) {
      minorYears.push(year);
    }
  }

  function nearestIndex(target) {
    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    years.forEach((value, idx) => {
      const diff = Math.abs(value - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = idx;
      }
    });
    return bestIndex;
  }

  const majorTicks = [];
  const majorIndexSet = new Set();
  majorYears.forEach((year) => {
    const index = nearestIndex(year);
    if (!majorIndexSet.has(index)) {
      majorIndexSet.add(index);
      majorTicks.push({ index, label: String(year) });
    }
  });

  const minorTickIndices = [];
  const minorIndexSet = new Set();
  minorYears.forEach((year) => {
    const index = nearestIndex(year);
    if (!majorIndexSet.has(index) && !minorIndexSet.has(index)) {
      minorIndexSet.add(index);
      minorTickIndices.push(index);
    }
  });

  return { majorTicks, minorTickIndices };
}

/* ---------------- data access (flat typed arrays) ---------------- */

function comboIndex() {
  return state.combo.obp * 4 + state.combo.ssh * 2 + state.combo.wind;
}

function comboLabel() {
  const axes = state.data.products.axes;
  return [axes[0].options[state.combo.obp], axes[1].options[state.combo.ssh],
          axes[2].options[state.combo.wind]].join(" + ");
}

function predAt(t, k, j) {
  const { nt, nk, nj } = state.data.dims;
  return state.data.pred[((comboIndex() * nt + t) * nk + k) * nj + j];
}

const meanStateCache = new Map();

function meanStateYZ() {
  // 2004-2009 model baseline + the selected combination's anomaly mean
  const c = comboIndex();
  if (!meanStateCache.has(c)) {
    const base = state.data.baseline_yz;
    const anom = state.data.combo_mean_yz[c];
    meanStateCache.set(c, base.map((row, k) => row.map(
      (value, j) => (value <= -900 ? NaN : value + anom[k][j]))));
  }
  return meanStateCache.get(c);
}

function stdAt(t, k, j) {
  const { nk, nj } = state.data.dims;
  return state.data.std[(t * nk + k) * nj + j];
}

function sliceKJ(t) {
  const { nk, nj } = state.data.dims;
  const out = [];
  for (let k = 0; k < nk; k += 1) {
    const row = new Array(nj);
    for (let j = 0; j < nj; j += 1) {
      row[j] = predAt(t, k, j);
    }
    out.push(row);
  }
  return out;
}

function sliceTJ(k) {
  const { nt, nj } = state.data.dims;
  const out = [];
  for (let t = 0; t < nt; t += 1) {
    const row = new Array(nj);
    for (let j = 0; j < nj; j += 1) {
      row[j] = predAt(t, k, j);
    }
    out.push(row);
  }
  return out;
}

/* ---------------- canvas plumbing ---------------- */

function setupCanvasResolution(canvas) {
  const logicalWidth = Number(canvas.dataset.logicalWidth || canvas.getAttribute("width"));
  const logicalHeight = Number(canvas.dataset.logicalHeight || canvas.getAttribute("height"));
  const dpr = window.devicePixelRatio || 1;
  canvas.dataset.logicalWidth = String(logicalWidth);
  canvas.dataset.logicalHeight = String(logicalHeight);
  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);
  canvas.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // when the canvas is displayed much smaller than its logical size (narrow
  // screens), scale fonts/margins up so text stays readable after CSS
  // downscaling; the 0.68 comfort factor keeps desktop layouts unchanged
  const cssWidth = canvas.clientWidth || logicalWidth;
  const fs = Math.min(2.4, Math.max(1, 0.68 * (logicalWidth / Math.max(cssWidth, 1))));
  return { ctx, width: logicalWidth, height: logicalHeight, fs };
}

function getCanvasLogicalSize(canvas) {
  return {
    width: Number(canvas.dataset.logicalWidth || canvas.getAttribute("width")),
    height: Number(canvas.dataset.logicalHeight || canvas.getAttribute("height")),
  };
}

function getCanvasPointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const logical = getCanvasLogicalSize(canvas);
  return {
    x: ((event.clientX - rect.left) / rect.width) * logical.width,
    y: ((event.clientY - rect.top) / rect.height) * logical.height,
  };
}

function plotFonts(fs) {
  return {
    tick: `${Math.round(17 * fs)}px Segoe UI`,
    title: `${Math.round(19 * fs)}px Segoe UI`,
    panel: `bold ${Math.round(21 * fs)}px Segoe UI`,
    colorbar: `${Math.round(16 * fs)}px Segoe UI`,
  };
}

function thinTicks(indices, fs) {
  const step = fs > 2 ? 3 : fs > 1.6 ? 2 : 1;
  if (step === 1) {
    return indices;
  }
  return indices.filter((_, i) => i % step === 0);
}

function valueToColor(value, clim) {
  if (!Number.isFinite(value)) {
    return "rgb(233, 236, 239)";        // masked cell (outside valid plane)
  }
  const clamped = Math.max(-clim, Math.min(clim, value));
  const t = (clamped + clim) / (2 * clim);
  // RdBu-style diverging ramp (matches the manuscript figures) with a
  // neutral midpoint so zero reads as "no signal", not as a warm hue
  const anchors = [
    { t: 0.0, rgb: [33, 74, 135] },
    { t: 0.18, rgb: [89, 141, 196] },
    { t: 0.5, rgb: [247, 248, 250] },
    { t: 0.82, rgb: [214, 113, 80] },
    { t: 1.0, rgb: [132, 34, 25] },
  ];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (t >= a.t && t <= b.t) {
      const local = (t - a.t) / (b.t - a.t);
      const rgb = a.rgb.map((channel, idx) => Math.round(channel + local * (b.rgb[idx] - channel)));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  return "rgb(0,0,0)";
}

function restartPlayback() {
  window.clearInterval(state.timer);
  if (!state.playing) {
    state.timer = null;
    controls.playButton.textContent = "Play";
    return;
  }
  controls.playButton.textContent = "Pause";
  state.timer = window.setInterval(() => {
    state.timeIndex = (state.timeIndex + 1) % state.data.time_labels.length;
    controls.timeSlider.value = String(state.timeIndex);
    render();
  }, PLAYBACK_INTERVALS[state.playbackSpeed]);
}

function buildPath(xs, ys) {
  return xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
}

function xToSvg(x, xmin, xmax, margins, plotWidth) {
  return margins.left + ((x - xmin) / (xmax - xmin)) * plotWidth;
}

function getBasinSplitInfo(latitudes) {
  const rightStart = latitudes.findIndex((value) => value >= BASIN_BOUNDARY);
  return {
    leftIndices: latitudes.map((_, idx) => idx).filter((idx) => idx < rightStart),
    rightIndices: latitudes.map((_, idx) => idx).filter((idx) => idx >= rightStart),
  };
}

/* ---------------- dual-basin heatmap ---------------- */

function drawDualBasinHeatmap(canvas, values, latitudes, densities, options) {
  const { ctx, width, height, fs } = setupCanvasResolution(canvas);
  const fonts = plotFonts(fs);
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 92 * fs, right: 76 * fs, top: 26 * fs, bottom: 54 * fs };
  const gap = 18;
  const plotHeight = height - margins.top - margins.bottom;
  const ny = densities.length;
  const cellH = plotHeight / ny;
  const totalLatCount = split.leftIndices.length + split.rightIndices.length;
  const availableWidth = width - margins.left - margins.right - gap;
  const leftWidth = availableWidth * (split.leftIndices.length / totalLatCount);
  const rightWidth = availableWidth * (split.rightIndices.length / totalLatCount);
  const leftCellW = leftWidth / split.leftIndices.length;
  const rightCellW = rightWidth / split.rightIndices.length;
  const leftX0 = margins.left;
  const rightX0 = margins.left + leftWidth + gap;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  function drawHalf(indices, x0, cellW) {
    for (let j = 0; j < ny; j += 1) {
      for (let localX = 0; localX < indices.length; localX += 1) {
        const globalX = indices[localX];
        ctx.fillStyle = valueToColor(values[j][globalX], options.clim);
        ctx.fillRect(x0 + localX * cellW, margins.top + j * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
    if (options.stippleMask) {
      ctx.strokeStyle = "rgba(20, 20, 20, 0.8)";
      ctx.lineWidth = 1.1 * fs;
      for (let j = 0; j < ny; j += 1) {
        for (let localX = 0; localX < indices.length; localX += 1) {
          const globalX = indices[localX];
          if (options.stippleMask[j][globalX] && ((localX + j) % 2 === 0)) {
            const cx = x0 + (localX + 0.5) * cellW;
            const cy = margins.top + (j + 0.5) * cellH;
            const arm = Math.max(2.3, Math.min(cellW, cellH) * 0.16);
            ctx.beginPath();
            ctx.moveTo(cx - arm, cy - arm);
            ctx.lineTo(cx + arm, cy + arm);
            ctx.moveTo(cx - arm, cy + arm);
            ctx.lineTo(cx + arm, cy - arm);
            ctx.stroke();
          }
        }
      }
    }
  }

  drawHalf(split.leftIndices, leftX0, leftCellW);
  drawHalf(split.rightIndices, rightX0, rightCellW);

  ctx.strokeStyle = "rgba(27,44,62,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = "#1b2c3e";
  ctx.font = fonts.panel;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28 * fs);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28 * fs);

  ctx.fillStyle = "#5c7186";
  ctx.font = fonts.tick;
  ctx.textAlign = "center";
  const leftTicks = thinTicks(options.leftTickIndices ?? [0, Math.floor(split.leftIndices.length / 2), split.leftIndices.length - 1], fs);
  leftTicks.forEach((localIdx) => {
    if (localIdx < 0 || localIdx >= split.leftIndices.length) {
      return;
    }
    const globalIdx = split.leftIndices[localIdx];
    const x = leftX0 + (localIdx + 0.5) * leftCellW;
    ctx.beginPath();
    ctx.moveTo(x, margins.top + plotHeight);
    ctx.lineTo(x, margins.top + plotHeight + 6);
    ctx.stroke();
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22 * fs);
  });
  const rightTicks = thinTicks(options.rightTickIndices ?? [0, Math.floor(split.rightIndices.length / 2), split.rightIndices.length - 1], fs);
  rightTicks.forEach((localIdx) => {
    if (localIdx < 0 || localIdx >= split.rightIndices.length) {
      return;
    }
    const globalIdx = split.rightIndices[localIdx];
    const x = rightX0 + (localIdx + 0.5) * rightCellW;
    ctx.beginPath();
    ctx.moveTo(x, margins.top + plotHeight);
    ctx.lineTo(x, margins.top + plotHeight + 6);
    ctx.stroke();
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22 * fs);
  });

  ctx.textAlign = "right";
  const yTicks = thinTicks(options.yTickIndices ?? [0, 4, 8, 12, 16, ny - 1], fs);
  yTicks.forEach((idx) => {
    if (idx < 0 || idx >= ny) {
      return;
    }
    const y = margins.top + (idx + 0.5) * cellH + 4;
    ctx.beginPath();
    ctx.moveTo(margins.left - 6, margins.top + (idx + 0.5) * cellH);
    ctx.lineTo(margins.left, margins.top + (idx + 0.5) * cellH);
    ctx.stroke();
    ctx.fillText(formatDensity(densities[idx]), margins.left - 10, y);
  });

  ctx.save();
  ctx.translate(28 * fs * 0.8, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14 * fs);

  const cbW = 14 * fs;
  const cbX = width - margins.right + 30 * fs;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, cbW, 1);
  }
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.textAlign = "left";
  ctx.font = fonts.colorbar;
  const tickDigits = options.colorbarTickDigits ?? 0;
  const colorbarTicks = [options.clim, options.clim / 2, 0, -options.clim / 2, -options.clim];
  colorbarTicks.forEach((tickValue, idx) => {
    const y = cbY + (idx / (colorbarTicks.length - 1)) * cbH;
    const baselineOffset = idx === 0 ? 10 : idx === colorbarTicks.length - 1 ? -2 : 4;
    ctx.fillText(formatColorbarTick(tickValue, tickDigits), cbX + cbW + 4, y + baselineOffset);
  });
  if (options.colorbarTitle) {
    ctx.textAlign = "center";
    ctx.fillText(options.colorbarTitle, cbX + cbW / 2, cbY - 6);
  }

  if (Number.isInteger(options.highlightX) && Number.isInteger(options.highlightY)) {
    const isLeft = options.highlightX < split.rightIndices[0];
    const indices = isLeft ? split.leftIndices : split.rightIndices;
    const x0 = isLeft ? leftX0 : rightX0;
    const cellW = isLeft ? leftCellW : rightCellW;
    const localX = indices.indexOf(options.highlightX);
    if (localX >= 0) {
      const hx = x0 + (localX + 0.5) * cellW;
      const hy = margins.top + (options.highlightY + 0.5) * cellH;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3.6 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 1.6 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return {
    margins,
    split,
    plotHeight,
    cellH,
    leftX0,
    leftWidth,
    leftCellW,
    rightX0,
    rightWidth,
    rightCellW,
    ny,
  };
}

/* ---------------- dual-basin Hovmoller ---------------- */

function drawDualBasinHovmoller(canvas, values, latitudes, timeLabels, options) {
  const { ctx, width, height, fs } = setupCanvasResolution(canvas);
  const fonts = plotFonts(fs);
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 128 * fs, right: 76 * fs, top: 26 * fs, bottom: 54 * fs };
  const gap = 18;
  const ny = timeLabels.length;
  const plotHeight = height - margins.top - margins.bottom;
  const cellH = plotHeight / ny;
  const totalLatCount = split.leftIndices.length + split.rightIndices.length;
  const availableWidth = width - margins.left - margins.right - gap;
  const leftWidth = availableWidth * (split.leftIndices.length / totalLatCount);
  const rightWidth = availableWidth * (split.rightIndices.length / totalLatCount);
  const leftCellW = leftWidth / split.leftIndices.length;
  const rightCellW = rightWidth / split.rightIndices.length;
  const leftX0 = margins.left;
  const rightX0 = margins.left + leftWidth + gap;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  function drawHalf(indices, x0, cellW) {
    for (let j = 0; j < ny; j += 1) {
      const rowIndex = options.flipY ? ny - 1 - j : j;
      for (let localX = 0; localX < indices.length; localX += 1) {
        const globalX = indices[localX];
        ctx.fillStyle = valueToColor(values[rowIndex][globalX], options.clim);
        ctx.fillRect(x0 + localX * cellW, margins.top + j * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
  }

  drawHalf(split.leftIndices, leftX0, leftCellW);
  drawHalf(split.rightIndices, rightX0, rightCellW);

  ctx.strokeStyle = "rgba(27,44,62,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = "#1b2c3e";
  ctx.font = fonts.panel;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28 * fs);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28 * fs);

  ctx.fillStyle = "#5c7186";
  ctx.font = fonts.tick;
  ctx.textAlign = "center";
  const leftTicks = thinTicks(options.leftTickIndices ?? [0, Math.floor(split.leftIndices.length / 2), split.leftIndices.length - 1], fs);
  leftTicks.forEach((localIdx) => {
    if (localIdx < 0 || localIdx >= split.leftIndices.length) {
      return;
    }
    const globalIdx = split.leftIndices[localIdx];
    const x = leftX0 + (localIdx + 0.5) * leftCellW;
    ctx.beginPath();
    ctx.moveTo(x, margins.top + plotHeight);
    ctx.lineTo(x, margins.top + plotHeight + 6);
    ctx.stroke();
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22 * fs);
  });
  const rightTicks = thinTicks(options.rightTickIndices ?? [0, Math.floor(split.rightIndices.length / 2), split.rightIndices.length - 1], fs);
  rightTicks.forEach((localIdx) => {
    if (localIdx < 0 || localIdx >= split.rightIndices.length) {
      return;
    }
    const globalIdx = split.rightIndices[localIdx];
    const x = rightX0 + (localIdx + 0.5) * rightCellW;
    ctx.beginPath();
    ctx.moveTo(x, margins.top + plotHeight);
    ctx.lineTo(x, margins.top + plotHeight + 6);
    ctx.stroke();
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22 * fs);
  });

  ctx.textAlign = "right";
  const minorTickIndices = fs > 1.6 ? [] : (options.yMinorTickIndices ?? []);
  minorTickIndices.forEach((idx) => {
    if (idx < 0 || idx >= ny) {
      return;
    }
    const plotIdx = options.flipY ? ny - 1 - idx : idx;
    const y = margins.top + (plotIdx + 0.5) * cellH;
    ctx.beginPath();
    ctx.moveTo(margins.left - 4, y);
    ctx.lineTo(margins.left, y);
    ctx.stroke();
  });

  const yTicks = thinTicks(options.yTickIndices ?? [0, Math.floor(ny / 2), ny - 1], fs);
  yTicks.forEach((tick) => {
    const idx = typeof tick === "object" ? tick.index : tick;
    if (idx < 0 || idx >= ny) {
      return;
    }
    const plotIdx = options.flipY ? ny - 1 - idx : idx;
    const y = margins.top + (plotIdx + 0.5) * cellH + 4;
    const label =
      typeof tick === "object"
        ? tick.label
        : options.yTickFormatter
          ? options.yTickFormatter(timeLabels[idx])
          : String(timeLabels[idx]);
    ctx.beginPath();
    ctx.moveTo(margins.left - 8, margins.top + (plotIdx + 0.5) * cellH);
    ctx.lineTo(margins.left, margins.top + (plotIdx + 0.5) * cellH);
    ctx.stroke();
    ctx.fillText(label, margins.left - 10, y);
  });

  ctx.save();
  ctx.translate(30 * fs * 0.8, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14 * fs);

  const cbW = 14 * fs;
  const cbX = width - margins.right + 30 * fs;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, cbW, 1);
  }
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.textAlign = "left";
  ctx.font = fonts.colorbar;
  const tickDigits = options.colorbarTickDigits ?? 0;
  const colorbarTicks = [options.clim, options.clim / 2, 0, -options.clim / 2, -options.clim];
  colorbarTicks.forEach((tickValue, idx) => {
    const y = cbY + (idx / (colorbarTicks.length - 1)) * cbH;
    const baselineOffset = idx === 0 ? 10 : idx === colorbarTicks.length - 1 ? -2 : 4;
    ctx.fillText(formatColorbarTick(tickValue, tickDigits), cbX + cbW + 4, y + baselineOffset);
  });
  if (options.colorbarTitle) {
    ctx.textAlign = "center";
    ctx.fillText(options.colorbarTitle, cbX + cbW / 2, cbY - 6);
  }

  if (Number.isInteger(options.highlightX) && Number.isInteger(options.highlightY)) {
    const isLeft = options.highlightX < split.rightIndices[0];
    const indices = isLeft ? split.leftIndices : split.rightIndices;
    const x0 = isLeft ? leftX0 : rightX0;
    const cellW = isLeft ? leftCellW : rightCellW;
    const localX = indices.indexOf(options.highlightX);
    if (localX >= 0) {
      const hx = x0 + (localX + 0.5) * cellW;
      const hyIndex = options.flipY ? ny - 1 - options.highlightY : options.highlightY;
      const hy = margins.top + (hyIndex + 0.5) * cellH;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3.6 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 1.5 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return {
    margins,
    split,
    plotHeight,
    cellH,
    leftX0,
    leftWidth,
    leftCellW,
    rightX0,
    rightWidth,
    rightCellW,
    ny,
  };
}

/* ---------------- time series (SVG) ---------------- */

function drawTimeSeries() {
  const d = state.data;
  const nt = d.dims.nt;
  const values = [];
  const stdValues = [];
  for (let t = 0; t < nt; t += 1) {
    values.push(predAt(t, state.densityIndex, state.latitudeIndex));
    stdValues.push(stdAt(t, state.densityIndex, state.latitudeIndex));
  }
  if (!Number.isFinite(values[0])) {
    // masked cell (outside the valid latitude-density plane)
    timeseriesSvg.innerHTML = `
      <rect x="0" y="0" width="900" height="320" fill="#ffffff"></rect>
      <text x="450" y="165" text-anchor="middle" font-size="20" fill="#7b8a99">
        No data at this cell — pick a cell inside the colored region.
      </text>`;
    return;
  }
  // the transfer-error field is undefined at some cells (notably abyssal
  // levels): draw the line without a band there instead of failing on NaN
  const hasStd = stdValues.some(Number.isFinite);
  const safeStd = stdValues.map((value) => (Number.isFinite(value) ? value : 0));
  const xYears = d.time_years;
  const rawSlope = d.trend.slope_per_year[state.densityIndex][state.latitudeIndex];
  const trendDefined = rawSlope > -900;
  const slope = trendDefined ? rawSlope : 0;
  const ci = d.trend.ci95.map((bound) => bound[state.densityIndex][state.latitudeIndex]);
  const xMean = xYears.reduce((sum, value) => sum + value, 0) / xYears.length;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const intercept = yMean - slope * xMean;
  const trendValues = xYears.map((x) => slope * x + intercept);

  const width = 900;
  const height = 320;
  const cssWidth = timeseriesSvg.clientWidth || width;
  const fs = Math.min(2.2, Math.max(1, 0.68 * (width / Math.max(cssWidth, 1))));
  const margins = { left: 82 * fs, right: 24, top: 24 * fs, bottom: 40 * fs };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const yMinRaw = Math.min(...values.map((v, i) => v - safeStd[i]), ...trendValues);
  const yMaxRaw = Math.max(...values.map((v, i) => v + safeStd[i]), ...trendValues);
  let ymin = Math.floor(yMinRaw);
  let ymax = Math.ceil(yMaxRaw);
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const yrange = ymax - ymin || 1;
  const xs = values.map((_, i) => margins.left + (i / (values.length - 1)) * plotWidth);
  const ys = values.map((v) => margins.top + ((ymax - v) / yrange) * plotHeight);
  const trendYs = trendValues.map((v) => margins.top + ((ymax - v) / yrange) * plotHeight);
  const upper = values.map((v, i) => margins.top + ((ymax - (v + safeStd[i])) / yrange) * plotHeight);
  const lower = values.map((v, i) => margins.top + ((ymax - (v - safeStd[i])) / yrange) * plotHeight);

  const areaPath =
    buildPath(xs, upper) +
    " " +
    xs
      .slice()
      .reverse()
      .map((x, idx) => `L ${x.toFixed(2)} ${lower[lower.length - 1 - idx].toFixed(2)}`)
      .join(" ") +
    " Z";

  const linePath = buildPath(xs, ys);
  const trendPath = buildPath(xs, trendYs);
  const currentX = xs[state.timeIndex];
  const yTickStep = Math.max(1, Math.ceil(((ymax - ymin) / 8) * (fs > 1.6 ? 2 : 1)));
  const yTicks = [];
  for (let tick = ymin; tick <= ymax; tick += yTickStep) {
    yTicks.push(tick);
  }
  const significant = trendDefined
    && d.trend.significant[state.densityIndex][state.latitudeIndex];
  const comboNote = comboIndex() === 0 ? "" : " · trend: default products";
  const gapStart = d.gap_time_range ? d.gap_time_range[0] : null;
  const gapEnd = d.gap_time_range ? d.gap_time_range[1] : null;
  const gapX1 = gapStart !== null ? margins.left + ((gapStart - xYears[0]) / (xYears[xYears.length - 1] - xYears[0])) * plotWidth : null;
  const gapX2 = gapEnd !== null ? margins.left + ((gapEnd - xYears[0]) / (xYears[xYears.length - 1] - xYears[0])) * plotWidth : null;
  const xminYear = Math.floor(xYears[0]);
  const xmaxYear = Math.ceil(xYears[xYears.length - 1]);
  const majorStep = fs > 1.6 ? 8 : 4;
  const majorYears = [];
  const firstMajor = Math.ceil(xYears[0] / majorStep) * majorStep;
  for (let year = firstMajor; year <= Math.floor(xYears[xYears.length - 1]); year += majorStep) {
    majorYears.push(year);
  }
  const minorYears = [];
  for (let year = xminYear; year <= xmaxYear; year += 1) {
    if (!majorYears.includes(year)) {
      minorYears.push(year);
    }
  }
  const crossesZero = ymin < 0 && ymax > 0;
  const zeroY = crossesZero ? margins.top + ((ymax - 0) / yrange) * plotHeight : null;
  const fTick = Math.round(16 * fs);
  const fTitle = Math.round(18 * fs);

  timeseriesSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
    <rect x="${margins.left}" y="${margins.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="rgba(27,44,62,0.35)"></rect>
    ${gapX1 !== null && gapX2 !== null ? `<rect x="${gapX1}" y="${margins.top}" width="${Math.max(0, gapX2 - gapX1)}" height="${plotHeight}" fill="rgba(100, 116, 139, 0.12)"></rect>` : ""}
    ${gapX1 !== null && gapX2 !== null && gapX2 - gapX1 > 34 * fs ? `<text x="${(gapX1 + gapX2) / 2}" y="${margins.top + plotHeight / 2}" text-anchor="middle" font-size="${Math.round(13 * fs)}" fill="#7b8a99" transform="rotate(-90 ${(gapX1 + gapX2) / 2} ${margins.top + plotHeight / 2})">GRACE gap</text>` : ""}
    ${crossesZero ? `<line x1="${margins.left}" y1="${zeroY}" x2="${width - margins.right}" y2="${zeroY}" stroke="rgba(27,44,62,0.55)" stroke-width="1"></line>` : ""}
    ${yTicks
      .map((tick) => {
        const y = margins.top + ((ymax - tick) / yrange) * plotHeight;
        return `<g>
          <line x1="${margins.left}" y1="${y}" x2="${width - margins.right}" y2="${y}" stroke="rgba(27,44,62,0.12)"></line>
          <line x1="${margins.left - 6}" y1="${y}" x2="${margins.left}" y2="${y}" stroke="rgba(27,44,62,0.35)"></line>
          <text x="${margins.left - 10}" y="${y + 5}" text-anchor="end" font-size="${fTick}" fill="#5c7186">${tick}</text>
        </g>`;
      })
      .join("")}
    ${minorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 4}" stroke="rgba(27,44,62,0.35)"></line>
        </g>`;
      })
      .join("")}
    ${majorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 8}" stroke="rgba(27,44,62,0.45)"></line>
          <text x="${x}" y="${height - margins.bottom + 8 + fTick}" text-anchor="middle" font-size="${fTick}" fill="#5c7186">${year}</text>
        </g>`;
      })
      .join("")}
    ${hasStd ? `<path d="${areaPath}" fill="rgba(143,45,27,0.15)"></path>` : ""}
    <path d="${linePath}" fill="none" stroke="#8f2d1b" stroke-width="3"></path>
    ${trendDefined ? `<path d="${trendPath}" fill="none" stroke="${significant ? "#0d6fa4" : "#7f8b92"}" stroke-width="2.5" stroke-dasharray="9 6"></path>` : ""}
    <line x1="${currentX}" y1="${margins.top}" x2="${currentX}" y2="${height - margins.bottom}" stroke="#162238" stroke-width="1.5" stroke-dasharray="6 4"></line>
    <text x="${24 * fs}" y="${margins.top + plotHeight / 2}" text-anchor="middle" font-size="${fTitle}" fill="#5c7186" transform="rotate(-90 ${24 * fs} ${margins.top + plotHeight / 2})">Ψ anomaly (Sv)</text>
    <text x="${width - 20}" y="${fTitle}" text-anchor="end" font-size="${fTick}" fill="${significant ? "#0d6fa4" : "#7f8b92"}">
      ${significant ? `Trend = [${roundValue(ci[0])}, ${roundValue(ci[1])}] Sv yr⁻¹` : "Trend not significant (±2σ)"}${comboNote}
    </text>
    ${hasStd ? "" : `<text x="${margins.left + 8}" y="${fTitle}" font-size="${fTick}" fill="#7b8a99">Uncertainty unavailable at this cell</text>`}
  `;
}

/* ---------------- hover tooltips ---------------- */

const hoverRegistry = new Map();

function registerHover(canvas, geom, kind) {
  hoverRegistry.set(canvas, { geom, kind });
}

function locateDualBasin(geom, x, y) {
  const rowIdx = Math.floor((y - geom.margins.top) / geom.cellH);
  if (!(rowIdx >= 0 && rowIdx < geom.ny)) {
    return null;
  }
  if (x >= geom.leftX0 && x <= geom.leftX0 + geom.leftWidth) {
    const localX = Math.floor((x - geom.leftX0) / geom.leftCellW);
    if (localX >= 0 && localX < geom.split.leftIndices.length) {
      return { latIdx: geom.split.leftIndices[localX], rowIdx };
    }
  } else if (x >= geom.rightX0 && x <= geom.rightX0 + geom.rightWidth) {
    const localX = Math.floor((x - geom.rightX0) / geom.rightCellW);
    if (localX >= 0 && localX < geom.split.rightIndices.length) {
      return { latIdx: geom.split.rightIndices[localX], rowIdx };
    }
  }
  return null;
}

function hoverText(kind, latIdx, rowIdx) {
  const d = state.data;
  const latText = formatLatitude(d.latitudes[latIdx]);
  if (kind === "hovmoller") {
    const timeIdx = d.dims.nt - 1 - rowIdx;
    const value = predAt(timeIdx, state.densityIndex, latIdx);
    return `${latText} · ${d.time_labels[timeIdx]}<br><strong>${Number.isFinite(value) ? `${value.toFixed(2)} Sv` : "no data"}</strong>`;
  }
  const sigmaText = `σ₂ ${formatDensity(d.densities[rowIdx])}`;
  if (kind === "trend") {
    const slope = d.trend.slope_per_year[rowIdx][latIdx];
    if (slope <= -900) {
      return `${latText} · ${sigmaText}<br><strong>no data</strong>`;
    }
    const sig = d.trend.significant_fdr[rowIdx][latIdx];
    return `${latText} · ${sigmaText}<br><strong>${slope.toFixed(3)} Sv yr⁻¹</strong>${sig ? "" : " (not significant)"}`;
  }
  if (kind === "snapshot") {
    const value = predAt(state.timeIndex, rowIdx, latIdx);
    return `${latText} · ${sigmaText} · ${d.time_labels[state.timeIndex]}<br><strong>${Number.isFinite(value) ? `${value.toFixed(2)} Sv` : "no data"}</strong>`;
  }
  const value = meanStateYZ()[rowIdx][latIdx];
  if (!Number.isFinite(value)) {
    return `${latText} · ${sigmaText}<br><strong>no data</strong>`;
  }
  return `${latText} · ${sigmaText}<br><strong>${value.toFixed(2)} Sv</strong> (mean state)`;
}

function bindHover(canvas) {
  canvas.addEventListener("mousemove", (event) => {
    const entry = hoverRegistry.get(canvas);
    if (!entry || !state.data) {
      return;
    }
    const { x, y } = getCanvasPointer(canvas, event);
    const hit = locateDualBasin(entry.geom, x, y);
    if (!hit) {
      controls.tooltip.hidden = true;
      return;
    }
    controls.tooltip.innerHTML = hoverText(entry.kind, hit.latIdx, hit.rowIdx);
    controls.tooltip.hidden = false;
    const pad = 14;
    const tw = controls.tooltip.offsetWidth;
    let left = event.clientX;
    if (left + tw + pad * 2 > window.innerWidth) {
      left = event.clientX - tw - pad * 2;
    }
    controls.tooltip.style.left = `${left}px`;
    controls.tooltip.style.top = `${event.clientY}px`;
  });
  canvas.addEventListener("mouseleave", () => {
    controls.tooltip.hidden = true;
  });
}

/* ---------------- render ---------------- */

function render() {
  const d = state.data;
  const hovmollerYearTicks = buildYearAxisTicks(d.time_years);
  const selectedStd = stdAt(state.timeIndex, state.densityIndex, state.latitudeIndex);
  const meanState = meanStateYZ();
  const meanValue = d.combo_mean_yz[comboIndex()][state.densityIndex][state.latitudeIndex];

  controls.timeLabel.textContent = d.time_labels[state.timeIndex];
  controls.climLabel.textContent = `±${state.climAnom} Sv`;
  controls.selectedLatitude.textContent = formatLatitude(d.latitudes[state.latitudeIndex]);
  controls.selectedDensity.textContent = `σ₂ = ${formatDensity(d.densities[state.densityIndex])} kg m⁻³`;
  controls.selectedValue.textContent = Number.isFinite(meanValue)
    ? `${meanValue.toFixed(2)} Sv` : "no data";
  controls.selectedStd.textContent = Number.isFinite(selectedStd)
    ? `${selectedStd.toFixed(2)} Sv` : "no data";

  const snapshotGeom = drawDualBasinHeatmap(snapshotCanvas, sliceKJ(state.timeIndex), d.latitudes, d.densities, {
    clim: state.climAnom,
    colorbarTickDigits: 0,
    yTitle: "Density σ₂ (kg/m³)",
    title: d.time_labels[state.timeIndex],
    colorbarTitle: "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(snapshotCanvas, snapshotGeom, "snapshot");

  const sectionGeom = drawDualBasinHeatmap(sectionCanvas, meanState, d.latitudes, d.densities, {
    clim: state.clim,
    colorbarTickDigits: 0,
    yTitle: "Density σ₂ (kg/m³)",
    title: "Mean state",
    colorbarTitle: "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(sectionCanvas, sectionGeom, "mean");

  const hovmollerGeom = drawDualBasinHovmoller(hovmollerCanvas, sliceTJ(state.densityIndex), d.latitudes, d.time_labels, {
    clim: state.climAnom,
    colorbarTickDigits: 0,
    flipY: true,
    yTitle: "Time",
    title: hovmollerDensityTitle(d.densities[state.densityIndex]),
    colorbarTitle: "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.timeIndex,
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: hovmollerYearTicks.majorTicks,
    yMinorTickIndices: hovmollerYearTicks.minorTickIndices,
  });
  registerHover(hovmollerCanvas, hovmollerGeom, "hovmoller");

  const trendGeom = drawDualBasinHeatmap(trendCanvas, d.trend.slope_per_year, d.latitudes, d.densities, {
    clim: state.trendClim,
    colorbarTickDigits: 1,
    yTitle: "Density σ₂ (kg/m³)",
    title: "Linear trend",
    colorbarTitle: "Sv yr⁻¹",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    stippleMask: d.trend.significant_fdr.map((row) => row.map((value) => !value)),
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(trendCanvas, trendGeom, "trend");

  drawTimeSeries();
}

/* ---------------- interactions ---------------- */

function updateSelectionFromDualBasin(geom, x, y) {
  const hit = locateDualBasin(geom, x, y);
  if (!hit) {
    return false;
  }
  state.latitudeIndex = hit.latIdx;
  state.densityIndex = hit.rowIdx;
  return true;
}

function bindCanvasInteractions() {
  [snapshotCanvas, sectionCanvas, trendCanvas].forEach((canvas) => {
    canvas.addEventListener("click", (event) => {
      const entry = hoverRegistry.get(canvas);
      if (!entry) {
        return;
      }
      const { x, y } = getCanvasPointer(canvas, event);
      if (updateSelectionFromDualBasin(entry.geom, x, y)) {
        controls.densitySelect.value = String(state.densityIndex);
        render();
      }
    });
    bindHover(canvas);
  });

  hovmollerCanvas.addEventListener("click", (event) => {
    const entry = hoverRegistry.get(hovmollerCanvas);
    if (!entry) {
      return;
    }
    const { x, y } = getCanvasPointer(hovmollerCanvas, event);
    const hit = locateDualBasin(entry.geom, x, y);
    if (!hit) {
      return;
    }
    state.latitudeIndex = hit.latIdx;
    state.timeIndex = entry.geom.ny - 1 - hit.rowIdx;
    controls.timeSlider.value = String(state.timeIndex);
    render();
  });
  bindHover(hovmollerCanvas);
}

function nearestLatIndex(target) {
  const lats = state.data.latitudes;
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  lats.forEach((value, idx) => {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = idx;
    }
  });
  return best;
}

function coreDensityIndex(latIdx, mode) {
  const mean = meanStateYZ();
  let best = 0;
  let bestValue = mode === "max" ? -Infinity : Infinity;
  mean.forEach((row, k) => {
    const value = row[latIdx];
    if ((mode === "max" && value > bestValue) || (mode === "min" && value < bestValue)) {
      bestValue = value;
      best = k;
    }
  });
  return best;
}

const PRESETS = {
  rapid: () => {
    const latIdx = nearestLatIndex(26.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "max") };
  },
  spna: () => {
    const latIdx = nearestLatIndex(45.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "max") };
  },
  abyssal: () => {
    const latIdx = nearestLatIndex(-60.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "min") };
  },
};

function bindControls() {
  controls.timeSlider.addEventListener("input", (event) => {
    state.timeIndex = Number(event.target.value);
    render();
  });

  controls.densitySelect.addEventListener("change", (event) => {
    state.densityIndex = Number(event.target.value);
    render();
  });

  controls.climSlider.addEventListener("input", (event) => {
    state.climAnom = Number(event.target.value);
    render();
  });

  controls.playButton.addEventListener("click", () => {
    state.playing = !state.playing;
    restartPlayback();
  });

  controls.speedControl.addEventListener("click", (event) => {
    const button = event.target.closest(".speed-option");
    if (!button) {
      return;
    }
    state.playbackSpeed = button.dataset.speed || "normal";
    controls.speedControl.querySelectorAll(".speed-option").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    if (state.playing) {
      restartPlayback();
    }
  });

  controls.productBar.addEventListener("click", (event) => {
    const button = event.target.closest(".product-option");
    if (!button || !state.data) {
      return;
    }
    const axis = button.dataset.axis;
    state.combo[axis] = Number(button.dataset.option);
    controls.productBar
      .querySelectorAll(`.product-option[data-axis="${axis}"]`)
      .forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
    controls.productComboLabel.textContent = comboLabel();
    render();
  });

  controls.presetRow.addEventListener("click", (event) => {
    const button = event.target.closest(".preset-option");
    if (!button || !state.data) {
      return;
    }
    const preset = PRESETS[button.dataset.preset];
    if (!preset) {
      return;
    }
    const { latIdx, densityIdx } = preset();
    state.latitudeIndex = latIdx;
    state.densityIndex = densityIdx;
    controls.densitySelect.value = String(densityIdx);
    render();
  });

  if (controls.copyBibtex) {
    controls.copyBibtex.addEventListener("click", async () => {
      const text = document.getElementById("bibtex-source").textContent;
      try {
        await navigator.clipboard.writeText(text);
        controls.copyBibtex.textContent = "Copied!";
      } catch (error) {
        controls.copyBibtex.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        controls.copyBibtex.textContent = "Copy BibTeX";
      }, 1600);
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!state.data) {
      return;
    }
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 120);
  });
}

/* ---------------- loading ---------------- */

function setLoadingProgress(fraction, message) {
  controls.loadingBarFill.style.width = `${Math.round(fraction * 100)}%`;
  if (message) {
    controls.loadingStatus.textContent = message;
  }
}

async function fetchWithProgress(url, expectedBytes, onProgress) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  // Content-Length can be the *compressed* transfer size when the CDN
  // gzips the response, while the stream yields decompressed bytes - so
  // size the buffer from the metadata's decoded byte count and use the
  // header only as a fallback.
  const total = expectedBytes || Number(response.headers.get("Content-Length")) || 0;
  if (!response.body || !total) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (received + value.length > buffer.length) {
      const grown = new Uint8Array(Math.max(buffer.length * 2, received + value.length));
      grown.set(buffer.subarray(0, received));
      buffer = grown;
    }
    buffer.set(value, received);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  return buffer.subarray(0, received);
}

async function loadData() {
  setLoadingProgress(0.03, "Fetching metadata…");
  const metaResponse = await fetch(META_PATH);
  if (!metaResponse.ok) {
    throw new Error(`HTTP ${metaResponse.status} while fetching metadata`);
  }
  const meta = await metaResponse.json();
  const [nCombos, nt, nk, nj] = meta.series_bin.shape;
  const scale = meta.series_bin.scale_sv;

  setLoadingProgress(0.06, "Downloading the reconstruction…");
  const bytes = await fetchWithProgress(
    `${DATA_DIR}${meta.series_bin.file}?v=${meta.metadata.generated_on}`,
    meta.series_bin.byte_length,
    (fraction) => setLoadingProgress(0.06 + 0.9 * fraction, "Downloading the reconstruction…"),
  );
  if (bytes.byteLength !== meta.series_bin.byte_length) {
    throw new Error(`Series file has ${bytes.byteLength} bytes; expected ${meta.series_bin.byte_length}.`);
  }

  setLoadingProgress(0.97, "Decoding…");
  const counts = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const nanCount = meta.series_bin.nan_count;
  const n = nCombos * nt * nk * nj;
  const nStd = nt * nk * nj;
  const pred = new Float32Array(n);
  const std = new Float32Array(nStd);
  for (let i = 0; i < n; i += 1) {
    pred[i] = counts[i] === nanCount ? NaN : counts[i] * scale;
  }
  for (let i = 0; i < nStd; i += 1) {
    std[i] = counts[n + i] === nanCount ? NaN : counts[n + i] * scale;
  }

  meta.dims = { nCombos, nt, nk, nj };
  meta.pred = pred;
  meta.std = std;
  return meta;
}

async function init() {
  state.data = await loadData();
  state.timeIndex = state.data.time_labels.length - 1;
  const rapid = PRESETS.rapid();
  state.latitudeIndex = rapid.latIdx;
  state.densityIndex = rapid.densityIdx;

  controls.timeSlider.max = String(state.data.time_labels.length - 1);
  controls.timeSlider.value = String(state.timeIndex);

  state.data.densities.forEach((density, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = hovmollerDensityTitle(density);
    controls.densitySelect.appendChild(option);
  });
  controls.densitySelect.value = String(state.densityIndex);

  state.data.products.axes.forEach((axis) => {
    const group = document.createElement("div");
    group.className = "product-group";
    const caption = document.createElement("span");
    caption.className = "product-caption";
    caption.textContent = axis.name;
    group.appendChild(caption);
    const buttons = document.createElement("div");
    buttons.className = "product-buttons";
    axis.options.forEach((label, optionIdx) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "product-option" + (optionIdx === 0 ? " is-active" : "");
      button.dataset.axis = axis.key;
      button.dataset.option = String(optionIdx);
      button.textContent = label;
      buttons.appendChild(button);
    });
    group.appendChild(buttons);
    controls.productBar.appendChild(group);
  });
  controls.productComboLabel.textContent = comboLabel();

  bindControls();
  bindCanvasInteractions();
  render();

  setLoadingProgress(1, "Done");
  controls.loadingOverlay.classList.add("is-hidden");
  window.setTimeout(() => {
    controls.loadingOverlay.remove();
  }, 450);
}

init().catch((error) => {
  controls.loadingStatus.textContent = `Failed to load: ${error.message}`;
  controls.loadingBarFill.style.background = "#c0533f";
  console.error(error);
});
