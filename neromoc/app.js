const DATA_PATH = "./data/neromoc_data.json?v=2026-04-13c";

const state = {
  data: null,
  timeIndex: 0,
  densityIndex: 0,
  latitudeIndex: 0,
  clim: 18,
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
  sourceFile: document.getElementById("source-file"),
  timeAssumption: document.getElementById("time-assumption"),
  selectedPoint: document.getElementById("selected-point"),
  selectedValue: document.getElementById("selected-value"),
  selectedStd: document.getElementById("selected-std"),
  selectedTrend: document.getElementById("selected-trend"),
};

const PLAYBACK_INTERVALS = {
  slow: 84,
  normal: 42,
  fast: 21,
};

const PLOT_TICK_FONT = "15px Segoe UI";
const PLOT_TITLE_FONT = "16px Segoe UI";
const PLOT_PANEL_FONT = "bold 18px Segoe UI";
const PLOT_COLORBAR_FONT = "14px Segoe UI";

const sectionCanvas = document.getElementById("section-canvas");
const snapshotCanvas = document.getElementById("snapshot-canvas");
const hovmollerCanvas = document.getElementById("hovmoller-canvas");
const trendCanvas = document.getElementById("trend-canvas");
const timeseriesSvg = document.getElementById("timeseries-svg");
const CANVASES = [sectionCanvas, snapshotCanvas, hovmollerCanvas, trendCanvas];
const BASIN_BOUNDARY = -34;

function formatLatitude(value) {
  const deg = Math.abs(value).toFixed(1).replace(".0", "");
  if (value < 0) {
    return `${deg}\u00B0S`;
  }
  if (value > 0) {
    return `${deg}\u00B0N`;
  }
  return "0\u00B0";
}

function formatDensity(value) {
  return `${value.toFixed(1)}`;
}

function sigmaText(value) {
  return `\u03C3\u2082 ${formatDensity(value)}`;
}

function hovmollerDensityTitle(value) {
  return `\u03C3\u2082 = ${formatDensity(value)} kg m\u207B\u00B3`;
}

function roundValue(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function formatColorbarTick(value, digits = 0) {
  return Number(value).toFixed(digits);
}

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
  return { ctx, width: logicalWidth, height: logicalHeight };
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

function valueToColor(value, clim) {
  const clamped = Math.max(-clim, Math.min(clim, value));
  const t = (clamped + clim) / (2 * clim);
  const anchors = [
    { t: 0.0, rgb: [33, 74, 135] },
    { t: 0.18, rgb: [89, 141, 196] },
    { t: 0.5, rgb: [250, 247, 239] },
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

function meanOverTime(cube) {
  const nt = cube.length;
  const nk = cube[0].length;
  const nj = cube[0][0].length;
  const out = Array.from({ length: nk }, () => Array.from({ length: nj }, () => 0));
  for (let t = 0; t < nt; t += 1) {
    for (let k = 0; k < nk; k += 1) {
      for (let j = 0; j < nj; j += 1) {
        out[k][j] += cube[t][k][j] / nt;
      }
    }
  }
  return out;
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

function drawHeatmap(canvas, values, xLabels, yLabels, options) {
  const { ctx, width, height } = setupCanvasResolution(canvas);
  const margins = { left: 84, right: 74, top: 26, bottom: 48 };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const nx = xLabels.length;
  const ny = yLabels.length;
  const cellW = plotWidth / nx;
  const cellH = plotHeight / ny;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);

  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const rowIndex = options.flipY ? ny - 1 - j : j;
      ctx.fillStyle = valueToColor(values[rowIndex][i], options.clim);
      ctx.fillRect(margins.left + i * cellW, margins.top + j * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }

  if (options.stippleMask) {
    ctx.fillStyle = "rgba(30, 30, 30, 0.45)";
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const rowIndex = options.flipY ? ny - 1 - j : j;
        if (options.stippleMask[rowIndex][i] && ((i + j) % 2 === 0)) {
          ctx.beginPath();
          ctx.arc(margins.left + (i + 0.5) * cellW, margins.top + (j + 0.5) * cellH, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.strokeStyle = "rgba(31,36,48,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(margins.left, margins.top, plotWidth, plotHeight);

  ctx.fillStyle = "#5a534d";
  ctx.font = PLOT_TICK_FONT;
  ctx.textAlign = "center";
  const xticks = options.xTickIndices ?? [0, Math.floor(nx / 4), Math.floor(nx / 2), Math.floor((3 * nx) / 4), nx - 1];
  xticks.forEach((idx) => {
    const x = margins.left + (idx + 0.5) * cellW;
    const label = options.xTickFormatter ? options.xTickFormatter(xLabels[idx]) : String(xLabels[idx]);
    ctx.beginPath();
    ctx.moveTo(x, margins.top + plotHeight);
    ctx.lineTo(x, margins.top + plotHeight + 6);
    ctx.stroke();
    ctx.fillText(label, x, height - 18);
  });

  ctx.textAlign = "right";
  const yticks = options.yTickIndices ?? [0, Math.floor(ny / 2), ny - 1];
  yticks.forEach((idx) => {
    const plotIdx = options.flipY ? ny - 1 - idx : idx;
    const y = margins.top + (plotIdx + 0.5) * cellH + 4;
    const label = options.yTickFormatter ? options.yTickFormatter(yLabels[idx]) : String(yLabels[idx]);
    ctx.beginPath();
    ctx.moveTo(margins.left - 6, margins.top + (plotIdx + 0.5) * cellH);
    ctx.lineTo(margins.left, margins.top + (plotIdx + 0.5) * cellH);
    ctx.stroke();
    ctx.fillText(label, margins.left - 10, y);
  });

  ctx.save();
  ctx.translate(22, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.xTitle, margins.left + plotWidth / 2, height - 2);
  ctx.fillText(options.title, margins.left + plotWidth / 2, 14);

  const cbX = width - 44;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, 14, 1);
  }
  ctx.strokeRect(cbX, cbY, 14, cbH);
  ctx.textAlign = "left";
  ctx.font = PLOT_COLORBAR_FONT;
  const tickDigits = options.colorbarTickDigits ?? 0;
  ctx.fillText(formatColorbarTick(options.clim, tickDigits), cbX + 18, cbY + 10);
  ctx.fillText(formatColorbarTick(0, tickDigits), cbX + 18, cbY + cbH / 2 + 4);
  ctx.fillText(formatColorbarTick(-options.clim, tickDigits), cbX + 18, cbY + cbH - 2);
  if (options.colorbarTitle) {
    ctx.fillText(options.colorbarTitle, cbX - 2, cbY - 8);
  }

  if (Number.isInteger(options.highlightX) && Number.isInteger(options.highlightY)) {
    const hx = margins.left + (options.highlightX + 0.5) * cellW;
    const hyIndex = options.flipY ? ny - 1 - options.highlightY : options.highlightY;
    const hy = margins.top + (hyIndex + 0.5) * cellH;
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  return { margins, plotWidth, plotHeight, cellW, cellH, nx, ny };
}

function drawDualBasinHeatmap(canvas, values, latitudes, densities, options) {
  const { ctx, width, height } = setupCanvasResolution(canvas);
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 92, right: 76, top: 24, bottom: 54 };
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
  ctx.fillStyle = "#fffdfa";
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
      ctx.lineWidth = 1.1;
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

  ctx.strokeStyle = "rgba(31,36,48,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = "#20242d";
  ctx.font = PLOT_PANEL_FONT;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28);

  ctx.fillStyle = "#5a534d";
  ctx.font = PLOT_TICK_FONT;
  ctx.textAlign = "center";
  const leftTicks = options.leftTickIndices ?? [0, Math.floor(split.leftIndices.length / 2), split.leftIndices.length - 1];
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
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22);
  });
  const rightTicks = options.rightTickIndices ?? [0, Math.floor(split.rightIndices.length / 2), split.rightIndices.length - 1];
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
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22);
  });

  ctx.textAlign = "right";
  const yTicks = options.yTickIndices ?? [0, 4, 8, 12, 16, ny - 1];
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
  ctx.translate(24, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14);

  const cbX = width - 44;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, 14, 1);
  }
  ctx.strokeRect(cbX, cbY, 14, cbH);
  ctx.textAlign = "left";
  ctx.font = PLOT_COLORBAR_FONT;
  const tickDigits = options.colorbarTickDigits ?? 0;
  ctx.fillText(formatColorbarTick(options.clim, tickDigits), cbX + 18, cbY + 10);
  ctx.fillText(formatColorbarTick(0, tickDigits), cbX + 18, cbY + cbH / 2 + 4);
  ctx.fillText(formatColorbarTick(-options.clim, tickDigits), cbX + 18, cbY + cbH - 2);
  if (options.colorbarTitle) {
    ctx.fillText(options.colorbarTitle, cbX - 4, cbY - 8);
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
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
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

function drawDualBasinHovmoller(canvas, values, latitudes, timeLabels, options) {
  const { ctx, width, height } = setupCanvasResolution(canvas);
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 92, right: 76, top: 24, bottom: 54 };
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
  ctx.fillStyle = "#fffdfa";
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

  ctx.strokeStyle = "rgba(31,36,48,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = "#20242d";
  ctx.font = PLOT_PANEL_FONT;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28);

  ctx.fillStyle = "#5a534d";
  ctx.font = PLOT_TICK_FONT;
  ctx.textAlign = "center";
  const leftTicks = options.leftTickIndices ?? [0, Math.floor(split.leftIndices.length / 2), split.leftIndices.length - 1];
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
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22);
  });
  const rightTicks = options.rightTickIndices ?? [0, Math.floor(split.rightIndices.length / 2), split.rightIndices.length - 1];
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
    ctx.fillText(formatLatitude(latitudes[globalIdx]), x, height - 22);
  });

  ctx.textAlign = "right";
  const yTicks = options.yTickIndices ?? [0, Math.floor(ny / 2), ny - 1];
  yTicks.forEach((idx) => {
    if (idx < 0 || idx >= ny) {
      return;
    }
    const plotIdx = options.flipY ? ny - 1 - idx : idx;
    const y = margins.top + (plotIdx + 0.5) * cellH + 4;
    const label = options.yTickFormatter ? options.yTickFormatter(timeLabels[idx]) : String(timeLabels[idx]);
    ctx.beginPath();
    ctx.moveTo(margins.left - 6, margins.top + (plotIdx + 0.5) * cellH);
    ctx.lineTo(margins.left, margins.top + (plotIdx + 0.5) * cellH);
    ctx.stroke();
    ctx.fillText(label, margins.left - 10, y);
  });

  ctx.save();
  ctx.translate(24, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = PLOT_TITLE_FONT;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14);

  const cbX = width - 44;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, 14, 1);
  }
  ctx.strokeRect(cbX, cbY, 14, cbH);
  ctx.textAlign = "left";
  ctx.font = PLOT_COLORBAR_FONT;
  const tickDigits = options.colorbarTickDigits ?? 0;
  ctx.fillText(formatColorbarTick(options.clim, tickDigits), cbX + 18, cbY + 10);
  ctx.fillText(formatColorbarTick(0, tickDigits), cbX + 18, cbY + cbH / 2 + 4);
  ctx.fillText(formatColorbarTick(-options.clim, tickDigits), cbX + 18, cbY + cbH - 2);
  if (options.colorbarTitle) {
    ctx.fillText(options.colorbarTitle, cbX - 2, cbY - 8);
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
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
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

function drawTimeSeries() {
  const d = state.data;
  const values = d.pred_yz.map((slice) => slice[state.densityIndex][state.latitudeIndex]);
  const stdValues = d.pred_yz_std
    ? d.pred_yz_std.map((slice) => slice[state.densityIndex][state.latitudeIndex])
    : values.map(() => 0);
  const xYears = d.time_years;
  const slope = d.trend.slope_per_year[state.densityIndex][state.latitudeIndex];
  const ci = d.trend.ci95.map((bound) => bound[state.densityIndex][state.latitudeIndex]);
  const xMean = xYears.reduce((sum, value) => sum + value, 0) / xYears.length;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const intercept = yMean - slope * xMean;
  const trendValues = xYears.map((x) => slope * x + intercept);

  const width = 900;
  const height = 320;
  const margins = { left: 60, right: 24, top: 24, bottom: 40 };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const ymin = Math.min(...values.map((v, i) => v - stdValues[i]), ...trendValues);
  const ymax = Math.max(...values.map((v, i) => v + stdValues[i]), ...trendValues);
  const yrange = ymax - ymin || 1;
  const xs = values.map((_, i) => margins.left + (i / (values.length - 1)) * plotWidth);
  const ys = values.map((v) => margins.top + ((ymax - v) / yrange) * plotHeight);
  const trendYs = trendValues.map((v) => margins.top + ((ymax - v) / yrange) * plotHeight);
  const upper = values.map((v, i) => margins.top + ((ymax - (v + stdValues[i])) / yrange) * plotHeight);
  const lower = values.map((v, i) => margins.top + ((ymax - (v - stdValues[i])) / yrange) * plotHeight);

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
  const yTicks = [ymin, (ymin + ymax) / 2, ymax];
  const significant = d.trend.significant[state.densityIndex][state.latitudeIndex];
  const gapStart = d.gap_time_range ? d.gap_time_range[0] : null;
  const gapEnd = d.gap_time_range ? d.gap_time_range[1] : null;
  const gapX1 = gapStart !== null ? margins.left + ((gapStart - xYears[0]) / (xYears[xYears.length - 1] - xYears[0])) * plotWidth : null;
  const gapX2 = gapEnd !== null ? margins.left + ((gapEnd - xYears[0]) / (xYears[xYears.length - 1] - xYears[0])) * plotWidth : null;
  const xminYear = Math.floor(xYears[0]);
  const xmaxYear = Math.ceil(xYears[xYears.length - 1]);
  const majorYears = [];
  const firstMajor = Math.ceil(xYears[0] / 4) * 4;
  for (let year = firstMajor; year <= Math.floor(xYears[xYears.length - 1]); year += 4) {
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

  timeseriesSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fffdfa"></rect>
    <rect x="${margins.left}" y="${margins.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="rgba(31,36,48,0.35)"></rect>
    ${gapX1 !== null && gapX2 !== null ? `<rect x="${gapX1}" y="${margins.top}" width="${Math.max(0, gapX2 - gapX1)}" height="${plotHeight}" fill="rgba(0, 255, 255, 0.12)"></rect>` : ""}
    ${crossesZero ? `<line x1="${margins.left}" y1="${zeroY}" x2="${width - margins.right}" y2="${zeroY}" stroke="rgba(31,36,48,0.55)" stroke-width="1"></line>` : ""}
    ${yTicks
      .map((tick) => {
        const y = margins.top + ((ymax - tick) / yrange) * plotHeight;
        return `<g>
          <line x1="${margins.left}" y1="${y}" x2="${width - margins.right}" y2="${y}" stroke="rgba(31,36,48,0.12)"></line>
          <line x1="${margins.left - 6}" y1="${y}" x2="${margins.left}" y2="${y}" stroke="rgba(31,36,48,0.35)"></line>
          <text x="${margins.left - 8}" y="${y + 5}" text-anchor="end" font-size="14" fill="#5a534d">${tick.toFixed(2)}</text>
        </g>`;
      })
      .join("")}
    ${minorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 4}" stroke="rgba(31,36,48,0.35)"></line>
        </g>`;
      })
      .join("")}
    ${majorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 8}" stroke="rgba(31,36,48,0.45)"></line>
          <text x="${x}" y="${height - 12}" text-anchor="middle" font-size="14" fill="#5a534d">${year}</text>
        </g>`;
      })
      .join("")}
    <path d="${areaPath}" fill="rgba(157,77,47,0.18)"></path>
    <path d="${linePath}" fill="none" stroke="#8f2d1b" stroke-width="3"></path>
    <path d="${trendPath}" fill="none" stroke="${significant ? "#0f6a8b" : "#7f8b92"}" stroke-width="2.5" stroke-dasharray="9 6"></path>
    <line x1="${currentX}" y1="${margins.top}" x2="${currentX}" y2="${height - margins.bottom}" stroke="#162238" stroke-width="1.5" stroke-dasharray="6 4"></line>
    <text x="${width / 2}" y="18" text-anchor="middle" font-size="16" fill="#5a534d">Overturning strength (Sv)</text>
    <text x="${width / 2}" y="${height - 2}" text-anchor="middle" font-size="15" fill="#5a534d">Time</text>
    <text x="20" y="${height / 2}" text-anchor="middle" font-size="15" fill="#5a534d" transform="rotate(-90 20 ${height / 2})">Sv</text>
    <text x="${width - 20}" y="18" text-anchor="end" font-size="14" fill="${significant ? "#0f6a8b" : "#7f8b92"}">
      ${significant ? `Trend = [${roundValue(ci[0])}, ${roundValue(ci[1])}] Sv yr\u207B\u00B9` : "Trend not significant at p < 0.05"}
    </text>
  `;
}

function render() {
  const d = state.data;
  const selectedValue = d.pred_yz[state.timeIndex][state.densityIndex][state.latitudeIndex];
  const selectedStd = d.pred_yz_std ? d.pred_yz_std[state.timeIndex][state.densityIndex][state.latitudeIndex] : null;
  const slope = d.trend.slope_per_year[state.densityIndex][state.latitudeIndex];
  const ci = d.trend.ci95.map((bound) => bound[state.densityIndex][state.latitudeIndex]);
  const significant = d.trend.significant[state.densityIndex][state.latitudeIndex];
  const meanValue = (d.mean_yz ?? meanOverTime(d.pred_yz))[state.densityIndex][state.latitudeIndex];

  controls.timeLabel.textContent = d.time_labels[state.timeIndex];
  controls.climLabel.textContent = `${state.clim} Sv`;
  controls.selectedPoint.textContent = `${formatLatitude(d.latitudes[state.latitudeIndex])}, \u03C3\u2082 = ${formatDensity(d.densities[state.densityIndex])} kg m\u207B\u00B3`;
  controls.selectedValue.textContent = `${meanValue.toFixed(2)} Sv`;
  controls.selectedStd.textContent = selectedStd !== null ? `${selectedStd.toFixed(2)} Sv` : "Unavailable";
  controls.selectedTrend.textContent = significant
    ? `[${roundValue(ci[0])}, ${roundValue(ci[1])}] Sv yr\u207B\u00B9`
    : `${slope.toFixed(3)} Sv yr\u207B\u00B9 (not significant)`;

  drawDualBasinHeatmap(snapshotCanvas, d.pred_yz[state.timeIndex], d.latitudes, d.densities, {
    clim: state.clim,
    colorbarTickDigits: 0,
    yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
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

  const meanValues = d.mean_yz ?? meanOverTime(d.pred_yz);
  drawDualBasinHeatmap(sectionCanvas, meanValues, d.latitudes, d.densities, {
    clim: state.clim,
    colorbarTickDigits: 0,
    yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
    title: "Time mean",
    colorbarTitle: "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: [0, 4, 8, 12, 16],
  });

  drawDualBasinHovmoller(hovmollerCanvas, d.pred_yz.map((timeSlice) => timeSlice[state.densityIndex]), d.latitudes, d.time_labels, {
    clim: state.clim,
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
    yTickIndices: [0, Math.floor(d.time_labels.length / 2), d.time_labels.length - 1],
    yTickFormatter: (label) => label,
  });

  drawDualBasinHeatmap(trendCanvas, d.trend.slope_per_year, d.latitudes, d.densities, {
    clim: state.trendClim,
    colorbarTickDigits: 1,
    yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
    title: "Linear trend",
    colorbarTitle: "Sv yr\u207B\u00B9",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    stippleMask: d.trend.significant.map((row) => row.map((value) => !value)),
    leftTickIndices: [4, 14, 24, 34],
    rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
    yTickIndices: [0, 4, 8, 12, 16],
  });

  drawTimeSeries();
}

function updateSelectionFromDualBasin(geom, x, y) {
  const densityIdx = Math.floor((y - geom.margins.top) / geom.cellH);
  if (!(densityIdx >= 0 && densityIdx < geom.ny)) {
    return false;
  }
  if (x >= geom.leftX0 && x <= geom.leftX0 + geom.leftWidth) {
    const localX = Math.floor((x - geom.leftX0) / geom.leftCellW);
    if (localX >= 0 && localX < geom.split.leftIndices.length) {
      state.latitudeIndex = geom.split.leftIndices[localX];
      state.densityIndex = densityIdx;
      return true;
    }
  } else if (x >= geom.rightX0 && x <= geom.rightX0 + geom.rightWidth) {
    const localX = Math.floor((x - geom.rightX0) / geom.rightCellW);
    if (localX >= 0 && localX < geom.split.rightIndices.length) {
      state.latitudeIndex = geom.split.rightIndices[localX];
      state.densityIndex = densityIdx;
      return true;
    }
  }
  return false;
}

function bindCanvasInteractions() {
  snapshotCanvas.addEventListener("click", (event) => {
    const d = state.data;
    const geom = drawDualBasinHeatmap(snapshotCanvas, d.pred_yz[state.timeIndex], d.latitudes, d.densities, {
      clim: state.clim,
      yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
      title: d.time_labels[state.timeIndex],
      leftTitle: "SMOC",
      rightTitle: "AMOC",
    });
    const { x, y } = getCanvasPointer(snapshotCanvas, event);
    if (updateSelectionFromDualBasin(geom, x, y)) {
      controls.densitySelect.value = String(state.densityIndex);
      render();
    }
  });

  sectionCanvas.addEventListener("click", (event) => {
    const d = state.data;
    const geom = drawDualBasinHeatmap(sectionCanvas, d.mean_yz ?? meanOverTime(d.pred_yz), d.latitudes, d.densities, {
      clim: state.clim,
      yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
      title: "Time mean",
      leftTitle: "SMOC",
      rightTitle: "AMOC",
    });
    const { x, y } = getCanvasPointer(sectionCanvas, event);
    if (updateSelectionFromDualBasin(geom, x, y)) {
      controls.densitySelect.value = String(state.densityIndex);
      render();
    }
  });

  trendCanvas.addEventListener("click", (event) => {
    const d = state.data;
    const geom = drawDualBasinHeatmap(trendCanvas, d.trend.slope_per_year, d.latitudes, d.densities, {
      clim: state.trendClim,
      yTitle: "Density \u03C3\u2082 (kg/m\u00B3)",
      title: "Linear trend",
      leftTitle: "SMOC",
      rightTitle: "AMOC",
    });
    const { x, y } = getCanvasPointer(trendCanvas, event);
    if (updateSelectionFromDualBasin(geom, x, y)) {
      controls.densitySelect.value = String(state.densityIndex);
      render();
    }
  });

  hovmollerCanvas.addEventListener("click", (event) => {
    const d = state.data;
    const geom = drawDualBasinHovmoller(hovmollerCanvas, d.pred_yz.map((timeSlice) => timeSlice[state.densityIndex]), d.latitudes, d.time_labels, {
      clim: state.clim,
      colorbarTickDigits: 0,
      flipY: true,
      yTitle: "Time",
      title: hovmollerDensityTitle(d.densities[state.densityIndex]),
      leftTitle: "SMOC",
      rightTitle: "AMOC",
      leftTickIndices: [4, 14, 24, 34],
      rightTickIndices: [4, 14, 24, 34, 44, 54, 64, 74, 84, 94],
      yTickIndices: [0, Math.floor(d.time_labels.length / 2), d.time_labels.length - 1],
      yTickFormatter: (label) => label,
    });
    const { x, y } = getCanvasPointer(hovmollerCanvas, event);
    const plotY = Math.floor((y - geom.margins.top) / geom.cellH);
    if (!(plotY >= 0 && plotY < geom.ny)) {
      return;
    }
    const timeIdx = geom.ny - 1 - plotY;
    let latIdx = -1;
    if (x >= geom.leftX0 && x <= geom.leftX0 + geom.leftWidth) {
      const localX = Math.floor((x - geom.leftX0) / geom.leftCellW);
      if (localX >= 0 && localX < geom.split.leftIndices.length) {
        latIdx = geom.split.leftIndices[localX];
      }
    } else if (x >= geom.rightX0 && x <= geom.rightX0 + geom.rightWidth) {
      const localX = Math.floor((x - geom.rightX0) / geom.rightCellW);
      if (localX >= 0 && localX < geom.split.rightIndices.length) {
        latIdx = geom.split.rightIndices[localX];
      }
    }
    if (latIdx >= 0) {
      state.latitudeIndex = latIdx;
      state.timeIndex = timeIdx;
      controls.timeSlider.value = String(state.timeIndex);
      render();
    }
  });
}

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
    state.clim = Number(event.target.value);
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
}

async function init() {
  const response = await fetch("./data/neromoc_data.json?v=2026-04-16g");
  state.data = await response.json();
  state.timeIndex = state.data.time_labels.length - 1;
  state.densityIndex = Math.floor(state.data.densities.length / 2);
  state.latitudeIndex = Math.floor(state.data.latitudes.length / 2);

  controls.sourceFile.innerHTML = `<a class="meta-link" href="./data/${state.data.metadata.source_file}" download="${state.data.metadata.source_file}">${state.data.metadata.source_file}</a>`;
  controls.timeAssumption.innerHTML = 'For more information, refer to the manuscript <strong>"Machine learning-enabled satellite monitoring of ocean overturning circulation"</strong> by Huaiyu Wei, Andrew L. Stewart, Andrei Medvedev, Georgy E. Manucharyan, Kaushik Srinivasan, Aviv Solodoch, and Andrew McC. Hogg.';
  controls.timeSlider.max = String(state.data.time_labels.length - 1);
  controls.timeSlider.value = String(state.timeIndex);

  state.data.densities.forEach((density, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = hovmollerDensityTitle(density);
    controls.densitySelect.appendChild(option);
  });
  controls.densitySelect.value = String(state.densityIndex);

  bindControls();
  bindCanvasInteractions();
  window.addEventListener("resize", render);
  render();
}

init().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><section class="panel"><h1>Viewer failed to load</h1><p>${error.message}</p><p>Start the viewer through a local server so the browser can fetch <code>data/neromoc_data.json</code>.</p></section></main>`;
});


