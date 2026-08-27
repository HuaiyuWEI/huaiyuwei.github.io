/* NeurMOC viewer (v3): themed (light/dark) canvas rendering, progressive
   data loading (default combination first, the others streamed in the
   background), product-difference view, RAPID 26.5N overlay, mean-state
   trend interpretation, and shareable URL state. */

const META_PATH = "./data/neurmoc_meta.json?v=2026-08-06d";
const DATA_DIR = "./data/";

const state = {
  data: null,
  combosReady: false,
  pendingCombo: null,                   // combo requested by URL before the stream arrived
  combo: { obp: 0, ssh: 0, wind: 0 },   // option index per product axis
  diff: false,                          // heatmaps show selected - default
  climAnom: 4,                          // snapshot + Hovmoller (anomalies)
  timeIndex: 0,
  densityIndex: 0,
  latitudeIndex: 0,
  clim: 20,                             // mean-state panel (full field)
  trendClim: 0.4,
  sigBasis: "point",                    // "point" | "fdr" (see sigField)
  playbackSpeed: "normal",
  playing: false,
  timer: null,
};

let DEFAULT_VIEW = { j: 0, k: 0, t: 0 };

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
  productNote: document.getElementById("product-note"),
  diffToggle: document.getElementById("diff-toggle"),
  shareView: document.getElementById("share-view"),
  themeToggle: document.getElementById("theme-toggle"),
  presetRow: document.getElementById("preset-row"),
  copyBibtex: document.getElementById("copy-bibtex"),
  trendReading: document.getElementById("trend-reading"),
  sigControl: document.getElementById("sig-control"),
  selectedLatitude: document.getElementById("selected-latitude"),
  selectedDensity: document.getElementById("selected-density"),
  selectedBaseline: document.getElementById("selected-baseline"),
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

/* ---------------- theme ---------------- */

const THEME_KEY = "neurmoc-theme";

// plot colors per theme; the CSS custom properties style the page chrome,
// these style everything drawn INSIDE the canvases/SVG
const PLOT_COLORS = {
  light: {
    bg: "#ffffff",
    ink: "#1b2c3e",
    muted: "#5c7186",
    frame: "rgba(27, 44, 62, 0.42)",
    grid: "rgba(27, 44, 62, 0.12)",
    zero: "rgba(27, 44, 62, 0.55)",
    mask: "rgb(233, 236, 239)",
    hatch: "rgba(60, 60, 60, 0.65)",
    hlOuter: "rgba(255, 255, 255, 0.9)",
    hlInner: "#111111",
    gap: "rgba(100, 116, 139, 0.12)",
    gapText: "#7b8a99",
    recon: "#8f2d1b",
    band: "rgba(143, 45, 27, 0.15)",
    declining: "#2166ac",
    decliningBand: "rgba(33, 102, 172, 0.16)",
    increasing: "#b2182b",
    increasingBand: "rgba(178, 24, 43, 0.15)",
    neutralBand: "rgba(127, 139, 146, 0.14)",
    defaultLine: "#9aa8b5",
    rapid: "#39424c",
    rapidBand: "rgba(57, 66, 76, 0.13)",
    trendNot: "#7f8b92",
    cursor: "#162238",
  },
  dark: {
    bg: "#0f1a2b",
    ink: "#e6eef7",
    muted: "#9fb2c6",
    frame: "rgba(230, 238, 247, 0.35)",
    grid: "rgba(230, 238, 247, 0.10)",
    zero: "rgba(230, 238, 247, 0.5)",
    mask: "#223043",
    hatch: "rgba(235, 241, 247, 0.55)",
    hlOuter: "rgba(15, 26, 43, 0.9)",
    hlInner: "#f2f6fa",
    gap: "rgba(148, 163, 184, 0.16)",
    gapText: "#93a6ba",
    recon: "#e0684b",
    band: "rgba(224, 104, 75, 0.20)",
    declining: "#6db3e8",
    decliningBand: "rgba(109, 179, 232, 0.20)",
    increasing: "#ff8d70",
    increasingBand: "rgba(255, 141, 112, 0.20)",
    neutralBand: "rgba(139, 152, 165, 0.18)",
    defaultLine: "#7b8b9c",
    rapid: "#c3d0dd",
    rapidBand: "rgba(195, 208, 221, 0.16)",
    trendNot: "#8b98a5",
    cursor: "#dbe6f2",
  },
};

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function pc() {
  return PLOT_COLORS[currentTheme()];
}

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (controls.themeToggle) {
    controls.themeToggle.setAttribute(
      "aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* private mode - theme just won't persist */
    }
  }
  if (state.data) {
    render();
    renderHeroSpark();
  }
}

// the inline <head> script sets data-theme before first paint; this is the
// fallback if it did not run
if (!document.documentElement.dataset.theme) {
  applyTheme(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light", false);
}

/* ---------------- formatting helpers ---------------- */

const FONT_STACK = '"Inter", "Segoe UI", sans-serif';

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

function formatSigned(value, digits = 1) {
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;
}

// Trend values run from ~0.001 to ~0.5 Sv/yr, so 2 decimals collapses the
// small ones to "0.00" (and to a "-0.00" that reads as a bug). Match the
// trend tooltip's 3 decimals and normalize negative zero away.
function formatTrend(value, digits = 3) {
  const text = Number(value).toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
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
  return predAtCombo(comboIndex(), t, k, j);
}

function predAtCombo(c, t, k, j) {
  const { nt, nk, nj } = state.data.dims;
  return state.data.pred[((c * nt + t) * nk + k) * nj + j];
}

function diffActive() {
  return state.diff && state.combosReady && comboIndex() !== 0;
}

function displayValueAt(t, k, j) {
  const v = predAt(t, k, j);
  if (!diffActive()) {
    return v;
  }
  const v0 = predAtCombo(0, t, k, j);
  return Number.isFinite(v) && Number.isFinite(v0) ? v - v0 : NaN;
}

let meanStateMemo = null;

// Below this magnitude, the sign of the local mean overturning is too weak
// to give a meaningful strengthening/weakening interpretation.
const MEAN_STATE_DIRECTION_EPSILON_SV = 0.5;

function relativeTrendDirection(meanState, slope) {
  if (!Number.isFinite(meanState) || !Number.isFinite(slope)
      || Math.abs(meanState) < MEAN_STATE_DIRECTION_EPSILON_SV || slope === 0) {
    return "neutral";
  }
  // A trend with the same sign as the mean state increases the magnitude of
  // that overturning cell. Thus, for a negative mean state, a positive trend
  // is declining/weakening and a negative trend is increasing/strengthening.
  return meanState * slope > 0 ? "increasing" : "declining";
}

function meanStateYZ() {
  // the 2004-2009 mean state (training-model baseline) alone - the
  // orientation panel; product-independent by construction
  if (!meanStateMemo) {
    meanStateMemo = state.data.baseline_yz.map((row) => row.map(
      (value) => (value <= -900 ? NaN : value)));
  }
  return meanStateMemo;
}

// Which significance test drives every display: the map's hatching, the
// time-series label and trend-line color, the interpretation chip, and the
// trend tooltip. "point" (default) is the +-2 sigma test alone - does this
// cell's own interval exclude zero? - the convention the manuscript keeps
// for single cells chosen in advance (fig02's cell panels). "fdr" adds the
// map-level Benjamini-Hochberg gate intersected with that rule, the
// multiplicity correction for a field scanned as a whole (fig02's map).
// FDR is a strict subset of per-point, so it only ever REMOVES significant
// cells.
function sigField() {
  return state.sigBasis === "point"
    ? state.data.trend.significant : state.data.trend.significant_fdr;
}

/* ------- per-combination trend statistics (stage 18) ------- */

// The trend map, its hatching and every per-cell trend readout follow the
// selected input combination: stage 18 re-runs the project's estimator on
// each combination with the published budget terms held fixed, so only the
// slope and the bootstrap serial term move. Until that binary arrives (it
// streams with the combination cubes) the exported default stands in - and
// the default IS combination 0, so the fallback is never wrong, only
// less specific.
let trendFieldMemo = null;

function trendBase(c) {
  const { nk, nj } = state.data.dims;
  return c * nk * nj;
}

function trendSlopeAtCombo(c, k, j) {
  const pack = state.data.trendPack;
  const { nj } = state.data.dims;
  if (pack) {
    return pack.slope[trendBase(c) + k * nj + j];
  }
  // fallback before the per-combination file arrives: the exported
  // default trend stands in for every combination
  const raw = state.data.trend.slope_per_year[k][j];
  return raw > -900 ? raw : NaN;
}

function trendSlopeAt(k, j) {
  return trendSlopeAtCombo(comboIndex(), k, j);
}

function trendHalfAt(k, j) {
  const pack = state.data.trendPack;
  const { nj } = state.data.dims;
  if (pack) {
    return pack.half[trendBase(comboIndex()) + k * nj + j];
  }
  const lo = state.data.trend.ci95[0][k][j];
  const hi = state.data.trend.ci95[1][k][j];
  return lo > -900 && hi > -900 ? Math.abs(hi - lo) / 2 : NaN;
}

function trendSigAt(k, j, basis) {
  const useFdr = (basis || state.sigBasis) === "fdr";
  const pack = state.data.trendPack;
  const { nj } = state.data.dims;
  if (pack) {
    const arr = useFdr ? pack.sigFdr : pack.sig;
    return arr[trendBase(comboIndex()) + k * nj + j] === 1;
  }
  const field = useFdr ? state.data.trend.significant_fdr
    : state.data.trend.significant;
  return Boolean(field[k][j]);
}

// the heatmap and its hatch mask want nested arrays; rebuild them only
// when the combination, the significance basis, or the data source changes
function ensureTrendFields() {
  const key = `${comboIndex()}|${state.sigBasis}|${state.data.trendPack ? 1 : 0}`;
  if (trendFieldMemo && trendFieldMemo.key === key) {
    return trendFieldMemo;
  }
  const { nk, nj } = state.data.dims;
  const slope = [];
  const hatch = [];
  for (let k = 0; k < nk; k += 1) {
    const srow = new Array(nj);
    const hrow = new Array(nj);
    for (let j = 0; j < nj; j += 1) {
      srow[j] = trendSlopeAt(k, j);
      hrow[j] = !trendSigAt(k, j);
    }
    slope.push(srow);
    hatch.push(hrow);
  }
  trendFieldMemo = { key, slope, hatch };
  return trendFieldMemo;
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
      row[j] = displayValueAt(t, k, j);
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
      row[j] = displayValueAt(t, k, j);
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
    tick: `${Math.round(16.5 * fs)}px ${FONT_STACK}`,
    title: `${Math.round(18.5 * fs)}px ${FONT_STACK}`,
    panel: `600 ${Math.round(20 * fs)}px ${FONT_STACK}`,
    colorbar: `${Math.round(15.5 * fs)}px ${FONT_STACK}`,
  };
}

function thinTicks(indices, fs) {
  const step = fs > 2 ? 3 : fs > 1.6 ? 2 : 1;
  if (step === 1) {
    return indices;
  }
  return indices.filter((_, i) => i % step === 0);
}

// latitude ticks at INTEGER degrees: the cells are centered on half
// degrees, so integers sit on cell edges - place ticks by value, not by
// cell index
function drawIntegerLatTicks(ctx, latitudes, indices, x0, cellW, axisY, labelY, fs) {
  const first = latitudes[indices[0]];
  const spacing = indices.length > 1
    ? latitudes[indices[1]] - latitudes[indices[0]] : 1;
  const lo = first - spacing / 2;
  const hi = latitudes[indices[indices.length - 1]] + spacing / 2;
  let values = [];
  for (let lat = Math.ceil(lo / 10) * 10; lat <= hi + 1e-6; lat += 10) {
    values.push(lat);
  }
  values = thinTicks(values, fs);
  values.forEach((lat) => {
    const local = (lat - first) / spacing + 0.5;   // in cell units
    if (local < -1e-6 || local > indices.length + 1e-6) {
      return;
    }
    const x = x0 + local * cellW;
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 6);
    ctx.stroke();
    ctx.fillText(formatLatitude(lat), x, labelY);
  });
}

// matplotlib/ColorBrewer RdBu_r anchors - the manuscript's diverging map
// (neurmoc CMAP_DIVERGING), low = blue, mid = neutral, high = red
const RDBU_R = [
  [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222],
  [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130],
  [214, 96, 77], [178, 24, 43], [103, 0, 31],
];

function valueToColor(value, clim) {
  if (!Number.isFinite(value)) {
    return pc().mask;                   // masked cell (outside valid plane)
  }
  const clamped = Math.max(-clim, Math.min(clim, value));
  const t = (clamped + clim) / (2 * clim);
  const x = t * (RDBU_R.length - 1);
  const i = Math.min(RDBU_R.length - 2, Math.floor(x));
  const local = x - i;
  const a = RDBU_R[i];
  const b = RDBU_R[i + 1];
  const r = Math.round(a[0] + local * (b[0] - a[0]));
  const g = Math.round(a[1] + local * (b[1] - a[1]));
  const bl = Math.round(a[2] + local * (b[2] - a[2]));
  return `rgb(${r}, ${g}, ${bl})`;
}

function restartPlayback() {
  window.clearInterval(state.timer);
  if (!state.playing) {
    state.timer = null;
    controls.playButton.textContent = "Play";
    scheduleUrlUpdate();
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

/* ---------------- shareable URL state ---------------- */

function buildHash() {
  const parts = new URLSearchParams();
  const combo = state.pendingCombo !== null ? state.pendingCombo : comboIndex();
  if (combo !== 0) {
    parts.set("c", String(combo));
  }
  if (state.latitudeIndex !== DEFAULT_VIEW.j) {
    parts.set("j", String(state.latitudeIndex));
  }
  if (state.densityIndex !== DEFAULT_VIEW.k) {
    parts.set("k", String(state.densityIndex));
  }
  if (state.timeIndex !== DEFAULT_VIEW.t) {
    parts.set("t", String(state.timeIndex));
  }
  if (state.climAnom !== 4) {
    parts.set("a", String(state.climAnom));
  }
  if (state.diff) {
    parts.set("d", "1");
  }
  if (state.sigBasis === "fdr") {
    parts.set("s", "f");
  }
  return parts.toString();
}

let urlTimer = null;

function scheduleUrlUpdate() {
  if (!state.data || state.playing) {
    return;
  }
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const hash = buildHash();
    history.replaceState(null, "",
      hash ? `#${hash}` : window.location.pathname + window.location.search);
  }, 250);
}

function applyHashState() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const { nt, nk, nj } = state.data.dims;
  const intParam = (key, lo, hi) => {
    const raw = params.get(key);
    if (raw === null || !/^\d+$/.test(raw)) {
      return null;
    }
    const value = Number(raw);
    return value >= lo && value <= hi ? value : null;
  };
  const j = intParam("j", 0, nj - 1);
  const k = intParam("k", 0, nk - 1);
  const t = intParam("t", 0, nt - 1);
  const a = intParam("a", 1, 12);
  const c = intParam("c", 0, state.data.dims.nCombos - 1);
  if (j !== null) state.latitudeIndex = j;
  if (k !== null) state.densityIndex = k;
  if (t !== null) state.timeIndex = t;
  if (a !== null) state.climAnom = a;
  // "f" selects the FDR gate; anything else (including the legacy "p"
  // that marked the old FDR-default era's per-point choice) is the
  // +-2 sigma default
  state.sigBasis = params.get("s") === "f" ? "fdr" : "point";
  // diff only means something against a non-default combination
  const nonDefault = c !== null && c !== 0;
  state.diff = params.get("d") === "1" && nonDefault;
  if (nonDefault) {
    // the non-default combinations stream in later; remember the request
    state.pendingCombo = c;
  }
}

const HASH_STATE_KEYS = ["c", "j", "k", "t", "a", "d", "s"];

// editing the hash by hand, or following a shared link while the page is
// already open, should apply like a fresh load; plain anchors (#cite) are
// left alone
function applyHashToUi() {
  state.latitudeIndex = DEFAULT_VIEW.j;
  state.densityIndex = DEFAULT_VIEW.k;
  state.timeIndex = DEFAULT_VIEW.t;
  state.climAnom = 4;
  state.diff = false;
  state.sigBasis = "point";
  state.pendingCombo = null;
  applyHashState();
  controls.timeSlider.value = String(state.timeIndex);
  controls.climSlider.value = String(state.climAnom);
  controls.densitySelect.value = String(state.densityIndex);
  if (controls.diffToggle) {
    controls.diffToggle.checked = state.diff;
  }
  syncSigControl();
  if (state.combosReady) {
    const requested = state.pendingCombo !== null ? state.pendingCombo : 0;
    applyComboIndex(requested);
    state.pendingCombo = null;
  } else if (state.pendingCombo === null) {
    applyComboIndex(0);
  }
  updateDiffAvailability();
  render();
}

window.addEventListener("hashchange", () => {
  if (!state.data) {
    return;
  }
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  if (hash && !HASH_STATE_KEYS.some((key) => params.has(key))) {
    return;                             // an in-page anchor, not viewer state
  }
  applyHashToUi();
});

/* ---------------- dual-basin heatmap ---------------- */

function drawDualBasinHeatmap(canvas, values, latitudes, densities, options) {
  const { ctx, width, height, fs } = setupCanvasResolution(canvas);
  const fonts = plotFonts(fs);
  const theme = pc();
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 84 * fs, right: 70 * fs, top: 26 * fs, bottom: 48 * fs };
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
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  function drawHalf(indices, x0, cellW) {
    for (let j = 0; j < ny; j += 1) {
      for (let localX = 0; localX < indices.length; localX += 1) {
        const globalX = indices[localX];
        ctx.fillStyle = valueToColor(values[j][globalX], options.clim);
        ctx.fillRect(x0 + localX * cellW, margins.top + j * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
    if (options.hatchMask) {
      // fig02's hatch convention (section_row hatch_pattern "////"):
      // thin forward-diagonal lines, cell-exact - clip to the union of
      // masked cells and stroke 45-degree lines across the half
      ctx.save();
      ctx.beginPath();
      for (let j = 0; j < ny; j += 1) {
        for (let localX = 0; localX < indices.length; localX += 1) {
          if (options.hatchMask[j][indices[localX]]) {
            ctx.rect(x0 + localX * cellW, margins.top + j * cellH,
                     cellW + 0.5, cellH + 0.5);
          }
        }
      }
      ctx.clip();
      ctx.strokeStyle = theme.hatch;
      ctx.lineWidth = 0.8 * fs;
      const spacing = 6.5 * fs;
      const halfWidth = indices.length * cellW;
      ctx.beginPath();
      for (let c = 0; c <= halfWidth + plotHeight; c += spacing) {
        ctx.moveTo(x0 + c - plotHeight, margins.top + plotHeight);
        ctx.lineTo(x0 + c, margins.top);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawHalf(split.leftIndices, leftX0, leftCellW);
  drawHalf(split.rightIndices, rightX0, rightCellW);

  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = theme.ink;
  ctx.font = fonts.panel;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28 * fs);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28 * fs);

  ctx.fillStyle = theme.muted;
  ctx.font = fonts.tick;
  ctx.textAlign = "center";
  drawIntegerLatTicks(ctx, latitudes, split.leftIndices, leftX0, leftCellW,
    margins.top + plotHeight, height - 20 * fs, fs);
  drawIntegerLatTicks(ctx, latitudes, split.rightIndices, rightX0, rightCellW,
    margins.top + plotHeight, height - 20 * fs, fs);

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
  ctx.translate(24 * fs * 0.8, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14 * fs);

  const cbW = 11 * fs;
  const cbX = width - margins.right + 24 * fs;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, cbW, 1);
  }
  ctx.strokeStyle = theme.frame;
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.fillStyle = theme.muted;
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
      ctx.strokeStyle = theme.hlOuter;
      ctx.lineWidth = 3.6 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = theme.hlInner;
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
  const theme = pc();
  const split = getBasinSplitInfo(latitudes);
  const margins = { left: 104 * fs, right: 70 * fs, top: 26 * fs, bottom: 48 * fs };
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
  ctx.fillStyle = theme.bg;
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

  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(leftX0, margins.top, leftWidth, plotHeight);
  ctx.strokeRect(rightX0, margins.top, rightWidth, plotHeight);

  ctx.fillStyle = theme.ink;
  ctx.font = fonts.panel;
  ctx.textAlign = "left";
  ctx.fillText(options.leftTitle, leftX0 + 10, margins.top + 28 * fs);
  ctx.fillText(options.rightTitle, rightX0 + 10, margins.top + 28 * fs);

  ctx.fillStyle = theme.muted;
  ctx.font = fonts.tick;
  ctx.textAlign = "center";
  drawIntegerLatTicks(ctx, latitudes, split.leftIndices, leftX0, leftCellW,
    margins.top + plotHeight, height - 20 * fs, fs);
  drawIntegerLatTicks(ctx, latitudes, split.rightIndices, rightX0, rightCellW,
    margins.top + plotHeight, height - 20 * fs, fs);

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
  ctx.translate(26 * fs * 0.8, margins.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.yTitle, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = fonts.title;
  ctx.fillText(options.title, margins.left + (availableWidth + gap) / 2, 14 * fs);

  const cbW = 11 * fs;
  const cbX = width - margins.right + 24 * fs;
  const cbY = margins.top;
  const cbH = plotHeight;
  for (let p = 0; p < cbH; p += 1) {
    const value = options.clim - (2 * options.clim * p) / cbH;
    ctx.fillStyle = valueToColor(value, options.clim);
    ctx.fillRect(cbX, cbY + p, cbW, 1);
  }
  ctx.strokeStyle = theme.frame;
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.fillStyle = theme.muted;
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
      ctx.strokeStyle = theme.hlOuter;
      ctx.lineWidth = 3.6 * fs;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5 * fs, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = theme.hlInner;
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

function isRapidCell() {
  if (!state.data || !state.data.rapid) {
    return false;
  }
  const preset = PRESETS.rapid();
  return state.latitudeIndex === preset.latIdx && state.densityIndex === preset.densityIdx;
}

function drawTimeSeries() {
  const d = state.data;
  const theme = pc();
  const nt = d.dims.nt;
  // the panel spans both map rows on wide screens and the SVG flexes to
  // fill it - match the drawing height to the CSS box (no letterboxing)
  const width = 900;
  const cssWidth = timeseriesSvg.clientWidth || width;
  const cssHeight = timeseriesSvg.clientHeight || 0;
  const height = cssHeight > 40
    ? Math.max(300, Math.min(720, Math.round((cssHeight / Math.max(cssWidth, 1)) * width)))
    : 320;
  timeseriesSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const values = [];
  const stdValues = [];
  for (let t = 0; t < nt; t += 1) {
    values.push(predAt(t, state.densityIndex, state.latitudeIndex));
    stdValues.push(stdAt(t, state.densityIndex, state.latitudeIndex));
  }
  const legendDefault = document.getElementById("legend-default");
  const legendRapid = document.getElementById("legend-rapid");
  if (!Number.isFinite(values[0])) {
    // masked cell (outside the valid latitude-density plane)
    timeseriesSvg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="${theme.bg}"></rect>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="20" fill="${theme.gapText}">
        No data at this cell — pick a cell inside the colored region.
      </text>`;
    if (legendDefault) legendDefault.hidden = true;
    if (legendRapid) legendRapid.hidden = true;
    return;
  }
  // the band exists everywhere since the unpriced-cell fill (the mapping
  // term of abyssal cells is borrowed from the nearest priced level above
  // in the column); keep the NaN fallback for robustness and annotate
  // borrowed cells
  const hasStd = stdValues.some(Number.isFinite);
  const safeStd = stdValues.map((value) => (Number.isFinite(value) ? value : 0));
  const showDefault = state.combosReady && comboIndex() !== 0;
  const defaultValues = [];
  if (showDefault) {
    for (let t = 0; t < nt; t += 1) {
      defaultValues.push(predAtCombo(0, t, state.densityIndex, state.latitudeIndex));
    }
  }
  // The uncertainty band is an estimate for the default
  // JPL + DUACS + CCMP reconstruction, so it stays centered on that
  // series (the gray curve) when another combination is selected. The
  // TREND is the selected combination's own (stage 18), so it is centered
  // on the selected series - drawing it through the default's mean would
  // combine one combination's slope with another's offset.
  const referenceValues = showDefault ? defaultValues : values;
  const xYears = d.time_years;
  const rawSlope = trendSlopeAt(state.densityIndex, state.latitudeIndex);
  const trendDefined = Number.isFinite(rawSlope);
  const slope = trendDefined ? rawSlope : 0;
  // the basis the trend panel's control selects; the per-point-vs-FDR
  // nuance is spelled out by the interpretation chip
  const sigShown = trendDefined
    && trendSigAt(state.densityIndex, state.latitudeIndex);
  const meanStateValue = meanStateYZ()[state.densityIndex][state.latitudeIndex];
  const direction = trendDefined
    ? relativeTrendDirection(meanStateValue, slope) : "neutral";
  const directionColor = direction === "declining" ? theme.declining
    : direction === "increasing" ? theme.increasing : theme.trendNot;
  const directionBand = direction === "declining" ? theme.decliningBand
    : direction === "increasing" ? theme.increasingBand : theme.neutralBand;
  const trendColor = sigShown ? directionColor : theme.trendNot;
  const ciHalfRaw = trendHalfAt(state.densityIndex, state.latitudeIndex);
  // The exported interval is symmetric about the slope and its half-width
  // IS 2 sigma_total (|slope| > half-width is exactly the per-point test),
  // so "slope +- half-width" restates the same interval and reads more
  // directly than a bracketed range. Always annotated, significant or not.
  const ciHalf = trendDefined ? ciHalfRaw : NaN;
  const trendLabel = trendDefined
    ? `Trend = ${formatTrend(slope)} ± ${formatTrend(ciHalf)} Sv yr⁻¹`
      + (sigShown ? "" : " (not significant)")
    : "No trend estimate at this cell";
  const xMean = xYears.reduce((sum, value) => sum + value, 0) / xYears.length;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const intercept = yMean - slope * xMean;
  const trendValues = xYears.map((x) => slope * x + intercept);

  const showRapid = isRapidCell();
  let rapidValues = null;
  let rapidUnc = null;
  if (showRapid) {
    // fig02's zero-bias display convention: shift the observed curve onto
    // the DISPLAYED reconstruction's mean over the shared months
    let sumPred = 0;
    let sumObs = 0;
    let nMatched = 0;
    d.rapid.time_index.forEach((ti, i) => {
      const v = ti >= 0 ? values[ti] : NaN;
      if (Number.isFinite(v)) {
        sumPred += v;
        sumObs += d.rapid.anomaly_sv[i];
        nMatched += 1;
      }
    });
    const offset = nMatched ? sumPred / nMatched - sumObs / nMatched : 0;
    rapidValues = d.rapid.anomaly_sv.map((value) => value + offset);
    rapidUnc = d.rapid.uncertainty_sv || null;
  }
  if (legendDefault) legendDefault.hidden = !showDefault;
  if (legendRapid) legendRapid.hidden = !showRapid;

  const fs = Math.min(2.2, Math.max(1, 0.68 * (width / Math.max(cssWidth, 1))));
  const margins = { left: 72 * fs, right: 22, top: 24 * fs, bottom: 38 * fs };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  // Fixed axis across the selector: span every combination's series, the
  // one uncertainty band (centered on the default reconstruction), AND
  // every combination's trend line - each is now centered on its own
  // series, so the axis must not jump when the selection changes.
  let yMinRaw = Math.min(...referenceValues.map((v, i) => v - safeStd[i]));
  let yMaxRaw = Math.max(...referenceValues.map((v, i) => v + safeStd[i]));
  const xFirst = xYears[0];
  const xLast = xYears[xYears.length - 1];
  for (let c = 0; c < d.dims.nCombos; c += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < nt; i += 1) {
      const v = predAtCombo(c, i, state.densityIndex, state.latitudeIndex);
      if (Number.isFinite(v)) {
        yMinRaw = Math.min(yMinRaw, v);
        yMaxRaw = Math.max(yMaxRaw, v);
        sum += v;
        count += 1;
      }
    }
    if (!count) {
      continue;
    }
    const slopeC = trendSlopeAtCombo(c, state.densityIndex, state.latitudeIndex);
    if (!Number.isFinite(slopeC)) {
      continue;
    }
    const interceptC = sum / count - slopeC * xMean;
    for (const x of [xFirst, xLast]) {
      const y = slopeC * x + interceptC;
      yMinRaw = Math.min(yMinRaw, y);
      yMaxRaw = Math.max(yMaxRaw, y);
    }
  }
  if (showRapid) {
    rapidValues.forEach((v, i) => {
      const unc = rapidUnc ? rapidUnc[i] : 0;
      if (Number.isFinite(v)) {
        yMinRaw = Math.min(yMinRaw, v - unc);
        yMaxRaw = Math.max(yMaxRaw, v + unc);
      }
    });
  }
  let ymin = Math.floor(yMinRaw);
  let ymax = Math.ceil(yMaxRaw);
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const yrange = ymax - ymin || 1;
  const yOf = (v) => margins.top + ((ymax - v) / yrange) * plotHeight;
  const xs = values.map((_, i) => margins.left + (i / (values.length - 1)) * plotWidth);
  const ys = values.map(yOf);
  const trendYs = trendValues.map(yOf);
  const upper = referenceValues.map((v, i) => yOf(v + safeStd[i]));
  const lower = referenceValues.map((v, i) => yOf(v - safeStd[i]));

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
  const defaultPath = showDefault ? buildPath(xs, defaultValues.map(yOf)) : "";
  const rapidXs = showRapid
    ? d.rapid.time_years.map((year) => xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth))
    : null;
  const rapidPath = showRapid
    ? rapidXs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${yOf(rapidValues[i]).toFixed(2)}`).join(" ")
    : "";
  const rapidBandPath = showRapid && rapidUnc
    ? rapidXs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${yOf(rapidValues[i] + rapidUnc[i]).toFixed(2)}`).join(" ")
      + " "
      + rapidXs
        .slice()
        .reverse()
        .map((x, idx) => {
          const i = rapidXs.length - 1 - idx;
          return `L ${x.toFixed(2)} ${yOf(rapidValues[i] - rapidUnc[i]).toFixed(2)}`;
        })
        .join(" ")
      + " Z"
    : "";
  const currentX = xs[state.timeIndex];
  // tick density follows the (now variable) plot height
  const targetTicks = Math.max(6, Math.min(14, Math.round(plotHeight / 40)));
  const yTickStep = Math.max(1, Math.ceil(((ymax - ymin) / targetTicks) * (fs > 1.6 ? 2 : 1)));
  const yTicks = [];
  for (let tick = ymin; tick <= ymax; tick += yTickStep) {
    yTicks.push(tick);
  }
  // One significance convention everywhere: whichever mask the trend
  // panel's control selects (sigField). Curve and band color encode
  // strengthening/weakening relative to the local mean-state sign; an
  // insignificant dashed trend stays gray.
  const comboNote = comboIndex() === 0 ? "" : " · band: default products";
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
  const zeroY = crossesZero ? yOf(0) : null;
  const fTick = Math.round(16 * fs);
  const fTitle = Math.round(18 * fs);

  timeseriesSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="${theme.bg}"></rect>
    <rect x="${margins.left}" y="${margins.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${theme.frame}"></rect>
    ${gapX1 !== null && gapX2 !== null ? `<rect x="${gapX1}" y="${margins.top}" width="${Math.max(0, gapX2 - gapX1)}" height="${plotHeight}" fill="${theme.gap}"></rect>` : ""}
    ${gapX1 !== null && gapX2 !== null && gapX2 - gapX1 > 34 * fs ? `<text x="${(gapX1 + gapX2) / 2}" y="${margins.top + plotHeight / 2}" text-anchor="middle" font-size="${Math.round(13 * fs)}" fill="${theme.gapText}" transform="rotate(-90 ${(gapX1 + gapX2) / 2} ${margins.top + plotHeight / 2})">GRACE gap</text>` : ""}
    ${crossesZero ? `<line x1="${margins.left}" y1="${zeroY}" x2="${width - margins.right}" y2="${zeroY}" stroke="${theme.zero}" stroke-width="1"></line>` : ""}
    ${yTicks
      .map((tick) => {
        const y = yOf(tick);
        return `<g>
          <line x1="${margins.left}" y1="${y}" x2="${width - margins.right}" y2="${y}" stroke="${theme.grid}"></line>
          <line x1="${margins.left - 6}" y1="${y}" x2="${margins.left}" y2="${y}" stroke="${theme.frame}"></line>
          <text x="${margins.left - 10}" y="${y + 5}" text-anchor="end" font-size="${fTick}" fill="${theme.muted}">${tick}</text>
        </g>`;
      })
      .join("")}
    ${minorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 4}" stroke="${theme.frame}"></line>
        </g>`;
      })
      .join("")}
    ${majorYears
      .map((year) => {
        const x = xToSvg(year, xYears[0], xYears[xYears.length - 1], margins, plotWidth);
        return `<g>
          <line x1="${x}" y1="${height - margins.bottom}" x2="${x}" y2="${height - margins.bottom + 8}" stroke="${theme.frame}"></line>
          <text x="${x}" y="${height - margins.bottom + 8 + fTick}" text-anchor="middle" font-size="${fTick}" fill="${theme.muted}">${year}</text>
        </g>`;
      })
      .join("")}
    ${hasStd ? `<path d="${areaPath}" fill="${directionBand}"></path>` : ""}
    ${showDefault ? `<path d="${defaultPath}" fill="none" stroke="${theme.defaultLine}" stroke-width="2"></path>` : ""}
    ${rapidBandPath ? `<path d="${rapidBandPath}" fill="${theme.rapidBand}"></path>` : ""}
    ${showRapid ? `<path d="${rapidPath}" fill="none" stroke="${theme.rapid}" stroke-width="2.4"></path>` : ""}
    <path d="${linePath}" fill="none" stroke="${directionColor}" stroke-width="3"></path>
    ${trendDefined ? `<path d="${trendPath}" fill="none" stroke="${trendColor}" stroke-width="2.5" stroke-dasharray="9 6"></path>` : ""}
    <line x1="${currentX}" y1="${margins.top}" x2="${currentX}" y2="${height - margins.bottom}" stroke="${theme.cursor}" stroke-width="1.5" stroke-dasharray="6 4"></line>
    <text x="${22 * fs}" y="${margins.top + plotHeight / 2}" text-anchor="middle" font-size="${fTitle}" fill="${theme.muted}" transform="rotate(-90 ${22 * fs} ${margins.top + plotHeight / 2})">Ψ anomaly (Sv)</text>
    <text x="${width - 20}" y="${fTitle}" text-anchor="end" font-size="${fTick}" fill="${trendColor}">
      ${trendLabel}${comboNote}
    </text>
    ${hasStd ? "" : `<text x="${margins.left + 8}" y="${fTitle}" font-size="${fTick}" fill="${theme.gapText}">Uncertainty unavailable at this cell</text>`}
  `;

  const reconSwatch = document.getElementById("legend-reconstruction-swatch");
  const bandSwatch = document.getElementById("legend-uncertainty-swatch");
  const trendSwatch = document.getElementById("legend-trend-swatch");
  if (reconSwatch) reconSwatch.style.background = directionColor;
  if (bandSwatch) bandSwatch.style.background = directionBand;
  if (trendSwatch) trendSwatch.style.borderTopColor = trendColor;
}

/* ---------------- mean-state trend interpretation ---------------- */

// Whether a trend strengthens or weakens the local overturning cell
// depends on the SIGN of the cell it acts on: a positive trend on a
// negative (counterclockwise) mean-state cell REDUCES its magnitude.
function updateTrendReading() {
  const el = controls.trendReading;
  if (!el) {
    return;
  }
  const d = state.data;
  const k = state.densityIndex;
  const j = state.latitudeIndex;
  const base = meanStateYZ()[k][j];
  const hasSeries = Number.isFinite(predAtCombo(0, 0, k, j));
  if (!Number.isFinite(base) || !hasSeries) {
    el.hidden = true;
    return;
  }
  const rawSlope = trendSlopeAt(k, j);
  const trendDefined = Number.isFinite(rawSlope);
  // same combination and basis as the map hatching and the plot label
  const sigPoint = trendDefined && trendSigAt(k, j, "point");
  const sigShown = trendDefined && trendSigAt(k, j);
  const sense = base >= 0 ? "clockwise" : "counterclockwise";
  let verdict;
  let cls = "is-neutral";
  if (!trendDefined) {
    verdict = "no trend estimate at this cell";
  } else if (!sigShown) {
    verdict = (state.sigBasis === "fdr" && sigPoint)
      ? "trend ±2σ excludes zero but fails FDR control — no robust change claimed"
      : "trend not significant — no robust change in cell strength";
  } else if (relativeTrendDirection(base, rawSlope) === "neutral") {
    verdict = "mean state near zero — strengthening vs. weakening is ill-defined here";
  } else {
    const strengthening = relativeTrendDirection(base, rawSlope) === "increasing";
    cls = strengthening ? "is-strengthening" : "is-weakening";
    verdict = `significant ${rawSlope > 0 ? "positive" : "negative"} trend on a `
      + `${base >= 0 ? "positive" : "negative"} cell → the overturning here is `
      + `<strong>${strengthening ? "strengthening" : "weakening"}</strong>`;
  }
  // the borrowed-band caveat is a per-cell annotation like the verdict,
  // and the SVG's top line has no room for it beside the trend label
  const mappingFilled = d.mapping_filled || d.transfer_filled;
  const borrowed = mappingFilled && mappingFilled[k][j] === 1;
  const defaultNote = "";
  el.className = `trend-reading ${cls}`;
  el.innerHTML = `<span>Mean state <strong>${formatSigned(base)} Sv</strong> (${sense} cell)</span>`
    + `<span class="tr-sep" aria-hidden="true">·</span><span class="tr-verdict">${verdict}</span>`
    + defaultNote
    + (borrowed
      ? `<span class="tr-sep" aria-hidden="true">·</span><span>uncertainty band: mapping-error term borrowed from the σ₂ level above</span>`
      : "");
  el.hidden = false;
}

/* ---------------- hero sparkline ---------------- */

function renderHeroSpark() {
  const svg = document.getElementById("hero-spark");
  if (!svg || !state.data) {
    return;
  }
  const { latIdx, densityIdx } = PRESETS.rapid();
  const nt = state.data.dims.nt;
  const vals = [];
  for (let t = 0; t < nt; t += 1) {
    vals.push(predAtCombo(0, t, densityIdx, latIdx));
  }
  const finite = vals.filter(Number.isFinite);
  if (!finite.length) {
    return;
  }
  const w = 300;
  const h = 64;
  const pad = 6;
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (i) => pad + (i / (nt - 1)) * (w - 2 * pad);
  const y = (v) => pad + ((hi - v) / (hi - lo)) * (h - 2 * pad);
  const line = vals
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const theme = pc();
  const zero = lo < 0 && hi > 0 ? y(0) : null;
  svg.innerHTML = `
    ${zero !== null ? `<line x1="${pad}" x2="${w - pad}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="${theme.frame}" stroke-width="1" stroke-dasharray="3 3"></line>` : ""}
    <path d="${line} L ${x(nt - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z" fill="${theme.band}"></path>
    <path d="${line}" fill="none" stroke="${theme.recon}" stroke-width="1.8" stroke-linejoin="round"></path>`;
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
  const deltaPrefix = diffActive() ? "Δ " : "";
  if (kind === "hovmoller") {
    const timeIdx = d.dims.nt - 1 - rowIdx;
    const value = displayValueAt(timeIdx, state.densityIndex, latIdx);
    return `${latText} · ${d.time_labels[timeIdx]}<br><strong>${Number.isFinite(value) ? `${deltaPrefix}${value.toFixed(2)} Sv` : "no data"}</strong>`;
  }
  const sigmaText = `σ₂ ${formatDensity(d.densities[rowIdx])}`;
  if (kind === "trend") {
    const slope = trendSlopeAt(rowIdx, latIdx);
    if (slope <= -900) {
      return `${latText} · ${sigmaText}<br><strong>no data</strong>`;
    }
    const sig = trendSigAt(rowIdx, latIdx);
    return `${latText} · ${sigmaText}<br><strong>${slope.toFixed(3)} Sv yr⁻¹</strong>${sig ? "" : " (not significant)"}`;
  }
  if (kind === "snapshot") {
    const value = displayValueAt(state.timeIndex, rowIdx, latIdx);
    return `${latText} · ${sigmaText} · ${d.time_labels[state.timeIndex]}<br><strong>${Number.isFinite(value) ? `${deltaPrefix}${value.toFixed(2)} Sv` : "no data"}</strong>`;
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
  const baseValue = meanState[state.densityIndex][state.latitudeIndex];
  const meanValue = d.combo_mean_yz[comboIndex()][state.densityIndex][state.latitudeIndex];
  const diff = diffActive();
  const anomClim = diff ? Math.max(1, Math.round(state.climAnom / 2)) : state.climAnom;
  const diffSuffix = diff ? " · selected − default" : "";

  controls.timeLabel.textContent = d.time_labels[state.timeIndex];
  controls.climLabel.textContent = diff
    ? `±${anomClim} Sv (difference)` : `±${state.climAnom} Sv`;
  controls.selectedLatitude.textContent = formatLatitude(d.latitudes[state.latitudeIndex]);
  controls.selectedDensity.textContent = `σ₂ = ${formatDensity(d.densities[state.densityIndex])} kg m⁻³`;
  if (controls.selectedBaseline) {
    controls.selectedBaseline.textContent = Number.isFinite(baseValue)
      ? `${formatSigned(baseValue, 2)} Sv` : "no data";
  }
  controls.selectedValue.textContent = Number.isFinite(meanValue)
    ? `${meanValue.toFixed(2)} Sv` : "no data";
  controls.selectedStd.textContent = Number.isFinite(selectedStd)
    ? `${selectedStd.toFixed(2)} Sv` : "no data";

  const snapshotGeom = drawDualBasinHeatmap(snapshotCanvas, sliceKJ(state.timeIndex), d.latitudes, d.densities, {
    clim: anomClim,
    colorbarTickDigits: 0,
    yTitle: "Density σ₂ (kg/m³)",
    title: `${d.time_labels[state.timeIndex]}${diffSuffix}`,
    colorbarTitle: diff ? "Δ Sv" : "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(snapshotCanvas, snapshotGeom, "snapshot");

  const sectionGeom = drawDualBasinHeatmap(sectionCanvas, meanState, d.latitudes, d.densities, {
    clim: state.clim,
    colorbarTickDigits: 0,
    yTitle: "Density σ₂ (kg/m³)",
    title: "2004–2009 mean",
    colorbarTitle: "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(sectionCanvas, sectionGeom, "mean");

  const hovmollerGeom = drawDualBasinHovmoller(hovmollerCanvas, sliceTJ(state.densityIndex), d.latitudes, d.time_labels, {
    clim: anomClim,
    colorbarTickDigits: 0,
    flipY: true,
    yTitle: "Time",
    title: `${hovmollerDensityTitle(d.densities[state.densityIndex])}${diffSuffix}`,
    colorbarTitle: diff ? "Δ Sv" : "Sv",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.timeIndex,
    yTickIndices: hovmollerYearTicks.majorTicks,
    yMinorTickIndices: hovmollerYearTicks.minorTickIndices,
  });
  registerHover(hovmollerCanvas, hovmollerGeom, "hovmoller");

  const trendFields = ensureTrendFields();
  const trendGeom = drawDualBasinHeatmap(trendCanvas, trendFields.slope, d.latitudes, d.densities, {
    clim: state.trendClim,
    colorbarTickDigits: 1,
    yTitle: "Density σ₂ (kg/m³)",
    title: "Linear trend",
    colorbarTitle: "Sv yr⁻¹",
    leftTitle: "SMOC",
    rightTitle: "AMOC",
    highlightX: state.latitudeIndex,
    highlightY: state.densityIndex,
    hatchMask: trendFields.hatch,
    yTickIndices: [0, 4, 8, 12, 16],
  });
  registerHover(trendCanvas, trendGeom, "trend");

  drawTimeSeries();
  updateTrendReading();
  updatePresetHighlight();
  scheduleUrlUpdate();
}

// light up the preset button matching the current cell (if any)
function updatePresetHighlight() {
  if (!controls.presetRow) {
    return;
  }
  controls.presetRow.querySelectorAll(".preset-option").forEach((button) => {
    const preset = PRESETS[button.dataset.preset];
    if (!preset) {
      return;
    }
    const { latIdx, densityIdx } = preset();
    button.classList.toggle("is-active",
      latIdx === state.latitudeIndex && densityIdx === state.densityIndex);
  });
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

function nearestDensityIndex(target) {
  const dens = state.data.densities;
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  dens.forEach((value, idx) => {
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
  amoc40: () => {
    const latIdx = nearestLatIndex(40.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "max") };
  },
  amoceq: () => {
    // Use the -0.5-degree column so the split-basin selection remains on
    // the Atlantic side of the equator.
    const latIdx = nearestLatIndex(-0.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "max") };
  },
  amoc30s: () => {
    const latIdx = nearestLatIndex(-30.5);
    return { latIdx, densityIdx: coreDensityIndex(latIdx, "max") };
  },
  somid: () => {
    // the SO mid-depth (clockwise) cell at 53.5S, pinned to the sigma2
    // 35.81 level where the strengthening is FDR-significant (the deeper
    // column maximum is not significant)
    return { latIdx: nearestLatIndex(-53.5),
             densityIdx: nearestDensityIndex(35.8125) };
  },
  abyssal: () => {
    // the SO abyssal (counterclockwise) cell at 65.5S, pinned to the
    // sigma2 37.06 level where the weakening is FDR-significant (the
    // column minimum at sigma2 36.94 is not)
    return { latIdx: nearestLatIndex(-65.5),
             densityIdx: nearestDensityIndex(37.0625) };
  },
};

function applyComboIndex(combo) {
  // mixed radix, not a bit field: obp has three options since GSFC was
  // added, so index = obp*4 + ssh*2 + wind with obp in 0..2
  state.combo = {
    obp: Math.floor(combo / 4), ssh: (combo >> 1) & 1, wind: combo & 1,
  };
  controls.productBar.querySelectorAll(".product-option").forEach((item) => {
    const axis = item.dataset.axis;
    item.classList.toggle("is-active",
      Number(item.dataset.option) === state.combo[axis]);
  });
  controls.productComboLabel.textContent = comboLabel();
  updateDiffAvailability();
}

function syncSigControl() {
  if (!controls.sigControl) {
    return;
  }
  controls.sigControl.querySelectorAll(".sig-option").forEach((button) => {
    const active = (button.dataset.sig === "point") === (state.sigBasis === "point");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function updateDiffAvailability() {
  if (!controls.diffToggle) {
    return;
  }
  const pendingNonDefault = state.pendingCombo !== null && state.pendingCombo !== 0;
  controls.diffToggle.disabled = comboIndex() === 0 && !pendingNonDefault;
}

function setProductOptionsEnabled(ready) {
  controls.productBar.querySelectorAll(".product-option").forEach((button) => {
    if (Number(button.dataset.option) > 0) {
      button.disabled = !ready;
      button.classList.toggle("is-loading", !ready);
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
    if (!button || !state.data || button.disabled) {
      return;
    }
    const axis = button.dataset.axis;
    const next = { ...state.combo, [axis]: Number(button.dataset.option) };
    state.pendingCombo = null;
    applyComboIndex(next.obp * 4 + next.ssh * 2 + next.wind);
    render();
  });

  if (controls.diffToggle) {
    controls.diffToggle.addEventListener("change", (event) => {
      state.diff = event.target.checked;
      render();
    });
  }

  if (controls.sigControl) {
    controls.sigControl.addEventListener("click", (event) => {
      const button = event.target.closest(".sig-option");
      if (!button || !state.data) {
        return;
      }
      state.sigBasis = button.dataset.sig === "point" ? "point" : "fdr";
      syncSigControl();
      render();
    });
  }

  if (controls.shareView) {
    controls.shareView.addEventListener("click", async () => {
      const hash = buildHash();
      history.replaceState(null, "",
        hash ? `#${hash}` : window.location.pathname + window.location.search);
      const original = "Copy link to this view";
      try {
        await navigator.clipboard.writeText(window.location.href);
        controls.shareView.textContent = "Link copied!";
      } catch (error) {
        controls.shareView.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        controls.shareView.textContent = original;
      }, 1600);
    });
  }

  if (controls.themeToggle) {
    controls.themeToggle.addEventListener("click", () => {
      applyTheme(currentTheme() === "dark" ? "light" : "dark", true);
    });
  }

  const sparkChip = document.getElementById("hero-spark-chip");
  if (sparkChip) {
    const jumpToRapid = () => {
      if (!state.data) {
        return;
      }
      const preset = PRESETS.rapid();
      state.latitudeIndex = preset.latIdx;
      state.densityIndex = preset.densityIdx;
      controls.densitySelect.value = String(preset.densityIdx);
      render();
      const panel = document.getElementById("timeseries-panel");
      if (panel) {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    sparkChip.addEventListener("click", jumpToRapid);
    sparkChip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        jumpToRapid();
      }
    });
  }

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

function decodeCounts(counts, offset, target, targetOffset, n, scale, nanCount) {
  for (let i = 0; i < n; i += 1) {
    const c = counts[offset + i];
    target[targetOffset + i] = c === nanCount ? NaN : c * scale;
  }
}

async function loadData() {
  setLoadingProgress(0.03, "Fetching metadata…");
  const metaResponse = await fetch(META_PATH);
  if (!metaResponse.ok) {
    throw new Error(`HTTP ${metaResponse.status} while fetching metadata`);
  }
  const meta = await metaResponse.json();
  const [nt, nk, nj] = meta.series_core.shape;
  const nCombos = meta.dimensions.combos;
  const { scale_sv: scale, nan_count: nanCount } = meta.series_encoding;
  const nCell = nt * nk * nj;

  // the core file (default combination + envelope) is enough to render;
  // the other seven combinations stream in the background afterwards
  setLoadingProgress(0.06, "Downloading the reconstruction…");
  const bytes = await fetchWithProgress(
    `${DATA_DIR}${meta.series_core.file}?v=${meta.series_core.version}`,
    meta.series_core.byte_length,
    (fraction) => setLoadingProgress(0.06 + 0.86 * fraction, "Downloading the reconstruction…"),
  );
  if (bytes.byteLength !== meta.series_core.byte_length) {
    throw new Error(`Core file has ${bytes.byteLength} bytes; expected ${meta.series_core.byte_length}.`);
  }

  setLoadingProgress(0.95, "Decoding…");
  const counts = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const pred = new Float32Array(nCombos * nCell).fill(NaN);
  const std = new Float32Array(nCell);
  decodeCounts(counts, 0, pred, 0, nCell, scale, nanCount);
  decodeCounts(counts, nCell, std, 0, nCell, scale, nanCount);

  meta.dims = { nCombos, nt, nk, nj };
  meta.pred = pred;
  meta.std = std;
  return meta;
}

// Per-combination trend statistics: small enough to fetch before the
// combination cubes, so the map is ready the moment the buttons unlock.
async function loadTrendCombos() {
  const d = state.data;
  const info = d.trend_combos;
  if (!info) {
    return;                       // data predates stage 18; default stands in
  }
  const bytes = await fetchWithProgress(
    `${DATA_DIR}${info.file}?v=${info.version}`, info.byte_length, () => {});
  if (bytes.byteLength !== info.byte_length) {
    throw new Error(`Trend file has ${bytes.byteLength} bytes; expected ${info.byte_length}.`);
  }
  const [nCombos, nk, nj] = info.shape;
  const n = nCombos * nk * nj;
  const base = bytes.byteOffset;
  d.trendPack = {
    slope: new Float32Array(bytes.buffer, base, n),
    half: new Float32Array(bytes.buffer, base + n * 4, n),
    sig: new Uint8Array(bytes.buffer, base + n * 8, n),
    sigFdr: new Uint8Array(bytes.buffer, base + n * 8 + n, n),
  };
  trendFieldMemo = null;
}

async function loadCombos() {
  const d = state.data;
  const info = d.series_combos;
  try {
    await loadTrendCombos();
    const bytes = await fetchWithProgress(
      `${DATA_DIR}${info.file}?v=${info.version}`, info.byte_length, () => {});
    if (bytes.byteLength !== info.byte_length) {
      throw new Error(`Combos file has ${bytes.byteLength} bytes; expected ${info.byte_length}.`);
    }
    const counts = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const { nt, nk, nj } = d.dims;
    const nCell = nt * nk * nj;
    const { scale_sv: scale, nan_count: nanCount } = d.series_encoding;
    decodeCounts(counts, 0, d.pred, nCell, counts.length, scale, nanCount);
    state.combosReady = true;
    setProductOptionsEnabled(true);
    if (controls.productNote) {
      controls.productNote.hidden = true;
    }
    if (state.pendingCombo !== null) {
      applyComboIndex(state.pendingCombo);
      state.pendingCombo = null;
    }
    updateDiffAvailability();
    render();          // fixed y-limits now span all eight combinations
  } catch (error) {
    console.error(error);
    if (controls.productNote) {
      controls.productNote.textContent =
        "Could not load the other product combinations — reload the page to retry.";
      controls.productNote.hidden = false;
    }
  }
}

async function init() {
  state.data = await loadData();
  const rapid = PRESETS.rapid();
  DEFAULT_VIEW = {
    j: rapid.latIdx,
    k: rapid.densityIdx,
    t: state.data.time_labels.length - 1,
  };
  state.timeIndex = DEFAULT_VIEW.t;
  state.latitudeIndex = DEFAULT_VIEW.j;
  state.densityIndex = DEFAULT_VIEW.k;
  applyHashState();

  controls.timeSlider.max = String(state.data.time_labels.length - 1);
  controls.timeSlider.value = String(state.timeIndex);
  controls.climSlider.value = String(state.climAnom);
  if (controls.diffToggle) {
    controls.diffToggle.checked = state.diff;
  }

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
  setProductOptionsEnabled(state.combosReady);
  updateDiffAvailability();
  syncSigControl();

  bindControls();
  bindCanvasInteractions();
  render();
  renderHeroSpark();
  // the first render can measure the SVG box before the flex/grid layout
  // has settled; one more pass on the next frame locks the aspect in
  window.requestAnimationFrame(() => {
    if (state.data) {
      drawTimeSeries();
    }
  });

  setLoadingProgress(1, "Done");
  controls.loadingOverlay.classList.add("is-hidden");
  window.setTimeout(() => {
    controls.loadingOverlay.remove();
  }, 450);

  // canvas text may have been measured against the fallback font; redraw
  // once the webfonts are in
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (state.data) {
        render();
        renderHeroSpark();
      }
    });
  }

  loadCombos();
}

init().catch((error) => {
  controls.loadingStatus.textContent = `Failed to load: ${error.message}`;
  controls.loadingBarFill.style.background = "#c0533f";
  console.error(error);
});
