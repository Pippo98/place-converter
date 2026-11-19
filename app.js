'use strict';

/* =====================================================================
 *  CONFIG: tweak the joke here
 * ===================================================================== */
const PLACE = {
  name: 'Place',
  code: 'PLC',
  baseEur: 2.5,          // long-run "fair value" of 1 Place, in EUR
  dailyVol: 0.018,       // typical daily move (0.018 = 1.8%)
  meanReversion: 0.03,   // how hard the price is pulled back toward baseEur each day (0..1)
  eventChance: 0.03,     // chance, per day, of a big "Place event" (a sudden jump)
  eventSize: 0.08,       // typical size of such an event (0.08 = 8%)
  genesis: '2024-01-01', // first trading day of Place
  seed: 'place',         // change it to get a completely different (but stable) history
};

const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_RANGE = '1M';
const POPULAR = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];
const API = 'https://api.frankfurter.dev/v1';

// Used only if the exchange-rate API can't be reached (EUR base).
const FALLBACK_DATE = '2026-11-18';
const FALLBACK_RATES = {
  AUD: 1.6294, BRL: 6.3818, CAD: 1.569, CHF: 0.9243, CNY: 7.3126, CZK: 24.386,
  DKK: 7.4744, GBP: 0.8329, HKD: 8.6063, HUF: 368.4, IDR: 20020.71, ILS: 3.5798,
  INR: 102.4905, ISK: 137.0, JPY: 174.85, KRW: 1461.3, MXN: 20.3738, MYR: 4.5144,
  NOK: 10.6045, NZD: 1.9951, PHP: 69.832, PLN: 4.4118, RON: 5.3467, SEK: 11.143,
  SGD: 1.4144, THB: 37.264, TRY: 55.3197, USD: 1.0968, ZAR: 18.8897,
};

/* =====================================================================
 *  Constants
 * ===================================================================== */
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TICK = 2000; // the live rate moves every 2 seconds

const RANGES = {
  '1D': { span: DAY,       step: 10 * MINUTE, label: 'past 24 hours' },
  '1W': { span: 7 * DAY,   step: HOUR,        label: 'past week' },
  '1M': { span: 30 * DAY,  step: 4 * HOUR,    label: 'past month' },
  '3M': { span: 91 * DAY,  step: 12 * HOUR,   label: 'past 3 months' },
  '1Y': { span: 365 * DAY, step: DAY,         label: 'past year' },
};

const TICK_RULES = {
  '1D': { unit: 'hour',  every: [1, 2, 3, 4, 6, 12], fmt: { hour: 'numeric', minute: '2-digit' } },
  '1W': { unit: 'day',   every: [1, 2],             fmt: { month: 'short', day: 'numeric' } },
  '1M': { unit: 'day',   every: [7, 14],            fmt: { month: 'short', day: 'numeric' } },
  '3M': { unit: 'month', every: [1, 2],             fmt: { month: 'short', day: 'numeric' } },
  '1Y': { unit: 'month', every: [1, 2, 3, 6],       fmt: { month: 'short' } },
};

const LOCALE = navigator.language || 'en';
const currencyNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { return null; }
})();
const currencyName = (code) => {
  try { return (currencyNames && currencyNames.of(code)) || code; } catch { return code; }
};

/* =====================================================================
 *  The Place price model: deterministic, so everyone sees the same rate.
 *  Daily closes follow a mean-reverting random walk (with the occasional
 *  "event"); within a day the price drifts smoothly between closes.
 * ===================================================================== */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const SEED = hashString(PLACE.seed);

function rand(n, stream) { // uniform in (0, 1), deterministic in (n, stream)
  let h = SEED ^ Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca77);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}
function gauss(n, stream) {
  const u = rand(n, stream * 2 + 100);
  const v = rand(n, stream * 2 + 101);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GENESIS_DAY = Math.floor(Date.parse(PLACE.genesis + 'T00:00:00Z') / DAY);
const closes = [0]; // log-price at 00:00 UTC of GENESIS_DAY + i

function logAtMidnight(day) {
  const i = day - GENESIS_DAY;
  if (i <= 0) return 0;
  while (closes.length <= i) {
    const d = GENESIS_DAY + closes.length - 1;
    let next = closes[closes.length - 1] * (1 - PLACE.meanReversion) + PLACE.dailyVol * gauss(d, 0);
    if (rand(d, 1) < PLACE.eventChance) {
      next += (rand(d, 2) < 0.5 ? -1 : 1) * PLACE.eventSize * (0.5 + rand(d, 3));
    }
    closes.push(next);
  }
  return closes[i];
}

function placeLog(t) {
  const day = Math.floor(t / DAY);
  if (day < GENESIS_DAY) return 0;
  const f = (t - day * DAY) / DAY;
  const a = logAtMidnight(day);
  const b = logAtMidnight(day + 1);
  const envelope = Math.sin(Math.PI * f); // 0 at midnight, so closes are exact
  let wiggle = 0;
  for (let k = 1; k <= 5; k++) wiggle += Math.sin(2 * Math.PI * (k * f + rand(day, 10 + k))) / k;
  const jitter = gauss(Math.floor(t / TICK), 4);
  return a + (b - a) * f + envelope * PLACE.dailyVol * (0.3 * wiggle + 0.05 * jitter);
}

const placeEur = (t) => PLACE.baseEur * Math.exp(placeLog(t));

/* =====================================================================
 *  Real exchange rates (ECB via Frankfurter), with an offline fallback
 * ===================================================================== */
const fx = {
  latest: { EUR: 1, ...FALLBACK_RATES },
  date: FALLBACK_DATE,
  live: false,
  history: {},  // code -> { dates: ['YYYY-MM-DD', ...], rates: [...] }
  pending: {},
};

const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

async function loadLatest() {
  try {
    const res = await fetch(`${API}/latest?base=EUR`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fx.latest = { EUR: 1, ...data.rates };
    fx.date = data.date;
    fx.live = true;
  } catch (err) {
    console.warn('Exchange-rate API unreachable, using offline rates.', err);
  }
}

function loadHistory(code) {
  if (code === 'EUR' || fx.history[code]) return Promise.resolve();
  if (!fx.pending[code]) {
    const start = isoDate(Date.now() - 380 * DAY);
    fx.pending[code] = fetch(`${API}/${start}..?base=EUR&symbols=${encodeURIComponent(code)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const dates = Object.keys(data.rates).sort();
        fx.history[code] = { dates, rates: dates.map((d) => data.rates[d][code]) };
      })
      .catch((err) => {
        console.warn(`No history for ${code}, using a flat rate.`, err);
        fx.history[code] = { dates: [], rates: [] };
      });
  }
  return fx.pending[code];
}

function eurTo(code, t) {
  if (code === 'EUR') return 1;
  const latest = fx.latest[code];
  const h = fx.history[code];
  if (!h || !h.dates.length) return latest;
  const day = isoDate(t);
  if (day >= h.dates[h.dates.length - 1]) return latest ?? h.rates[h.rates.length - 1];
  let lo = 0, hi = h.dates.length - 1, found = 0; // last date <= day (fills weekends)
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h.dates[mid] <= day) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return h.rates[found];
}

/* =====================================================================
 *  State
 * ===================================================================== */
const state = {
  currency: DEFAULT_CURRENCY,
  placeFirst: true,     // true: PLC -> currency, false: currency -> PLC
  range: DEFAULT_RANGE,
  lastEdited: 'a',
  series: [],
  hoverT: null,
};

const store = {
  get(key) { try { return localStorage.getItem('place-converter:' + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem('place-converter:' + key, value); } catch { /* ignore */ } },
};

const fromCode = () => (state.placeFirst ? PLACE.code : state.currency);
const toCode = () => (state.placeFirst ? state.currency : PLACE.code);
const pairRate = (t) => {
  const p = placeEur(t) * eurTo(state.currency, t);
  return state.placeFirst ? p : 1 / p;
};

/* =====================================================================
 *  Formatting & parsing
 * ===================================================================== */
const fmtRate = (v) => v.toLocaleString(LOCALE, { minimumSignificantDigits: 6, maximumSignificantDigits: 6 });

function fmtInput(v) {
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const opts = abs >= 1 || abs === 0
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumSignificantDigits: 4 };
  return v.toLocaleString(LOCALE, { ...opts, useGrouping: false });
}

function parseAmount(raw) {
  let s = String(raw).replace(/[\s '’_]/g, '');
  if (!s) return NaN;
  const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (sep >= 0) s = s.slice(0, sep).replace(/[.,]/g, '') + '.' + s.slice(sep + 1); // accept 1,5 and 1.5
  return Number(s);
}

function fmtPct(p) {
  return `${p >= 0 ? '▲' : '▼'} ${Math.abs(p * 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function setChange(el, p) {
  el.className = 'change ' + (p >= 0 ? 'up' : 'down');
  el.textContent = fmtPct(p);
}

function fmtWhen(t, now) {
  if (now - t < TICK) return 'Now';
  const opts = state.range === '1Y'
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Date(t).toLocaleString(LOCALE, opts);
}

/* =====================================================================
 *  DOM
 * ===================================================================== */
const $ = (id) => document.getElementById(id);
const els = {
  heroPair: $('hero-pair'), heroRate: $('hero-rate'), heroUnit: $('hero-unit'),
  heroChange: $('hero-change'), heroTime: $('hero-time'),
  amountA: $('amount-a'), amountB: $('amount-b'), unitA: $('unit-a'), unitB: $('unit-b'),
  swap: $('swap'), placeBadge: $('place-badge'), currencyWrap: $('currency-wrap'), currency: $('currency'),
  chartTitle: $('chart-title'), chartStats: $('chart-stats'), chart: $('chart'), svg: $('chart-svg'),
  tooltip: $('tooltip'), tooltipValue: $('tooltip-value'), tooltipDate: $('tooltip-date'),
  fxDate: $('fx-date'),
};

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- currency picker ---------- */
const currencyDisplay = document.createElement('span');
currencyDisplay.className = 'select-display';
els.currencyWrap.prepend(currencyDisplay);

function populateCurrencies() {
  const codes = Object.keys(fx.latest).sort();
  if (!codes.includes(state.currency)) state.currency = DEFAULT_CURRENCY;
  const sel = els.currency;
  sel.replaceChildren();
  const group = (label, list) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const code of list) {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = `${code} – ${currencyName(code)}`;
      g.append(o);
    }
    sel.append(g);
  };
  group('Popular', POPULAR.filter((c) => codes.includes(c)));
  group('All currencies', codes.filter((c) => !POPULAR.includes(c)));
  sel.value = state.currency;
  updateCurrencyDisplay();
}

function updateCurrencyDisplay() {
  const strong = document.createElement('strong');
  strong.textContent = state.currency;
  const name = document.createElement('span');
  name.className = 'muted unit-name';
  name.textContent = currencyName(state.currency);
  currencyDisplay.replaceChildren(strong, ' ', name);
}

function mountUnits() {
  els.unitA.append(state.placeFirst ? els.placeBadge : els.currencyWrap);
  els.unitB.append(state.placeFirst ? els.currencyWrap : els.placeBadge);
}

/* ---------- hero ---------- */
let lastHeroText = '';
let lastHeroValue = null;
function updateHero(now) {
  const r = pairRate(now);
  const text = fmtRate(r);
  els.heroPair.textContent = `1 ${fromCode()} =`;
  els.heroRate.textContent = text;
  els.heroUnit.textContent = toCode();
  setChange(els.heroChange, r / pairRate(now - DAY) - 1);
  els.heroTime.textContent = 'Updated ' + new Date(now).toLocaleTimeString(LOCALE);
  document.title = `${text} ${toCode()} · 1 ${fromCode()}`;

  if (lastHeroValue != null && text !== lastHeroText) {
    const el = els.heroRate;
    el.classList.remove('flash-up', 'flash-down');
    el.classList.add(r > lastHeroValue ? 'flash-up' : 'flash-down');
    setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 150);
  }
  lastHeroText = text;
  lastHeroValue = r;
}

/* ---------- converter ---------- */
function updateConverter(now) {
  const rate = pairRate(now);
  if (state.lastEdited === 'a') {
    const v = parseAmount(els.amountA.value);
    els.amountB.value = Number.isFinite(v) ? fmtInput(v * rate) : '';
  } else {
    const v = parseAmount(els.amountB.value);
    els.amountA.value = Number.isFinite(v) ? fmtInput(v / rate) : '';
  }
}

/* ---------- chart ---------- */
function buildSeries(now) {
  const { span, step } = RANGES[state.range];
  const start = Math.max(Math.ceil((now - span) / step) * step, GENESIS_DAY * DAY);
  const pts = [];
  for (let t = start; t < now - 1000; t += step) pts.push({ t, v: pairRate(t) });
  pts.push({ t: now, v: pairRate(now) });
  if (pts.length === 1) pts.unshift({ t: now - step, v: pairRate(now - step) });
  return pts;
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function valueTicks(min, max, count) {
  if (max - min <= 0) { const pad = Math.abs(max) * 0.01 || 1; min -= pad; max += pad; }
  const step = niceStep((max - min) / (count - 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5 ? 1 : 0));
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(decimals + 2));
  return { ticks, decimals };
}

function timeTicks(t0, t1, rule, maxCount) {
  const d = new Date(t0);
  if (rule.unit === 'hour') { d.setMinutes(0, 0, 0); if (+d < t0) d.setHours(d.getHours() + 1); }
  else if (rule.unit === 'day') { d.setHours(0, 0, 0, 0); if (+d < t0) d.setDate(d.getDate() + 1); }
  else { d.setHours(0, 0, 0, 0); d.setDate(1); if (+d < t0) d.setMonth(d.getMonth() + 1); }
  const cands = [];
  for (let guard = 0; +d <= t1 && guard < 1000; guard++) {
    const key = rule.unit === 'hour' ? d.getHours()
      : rule.unit === 'day' ? Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) + 3 // +3: weeks start on Monday
      : d.getFullYear() * 12 + d.getMonth();
    cands.push({ t: +d, key });
    if (rule.unit === 'hour') d.setHours(d.getHours() + 1);
    else if (rule.unit === 'day') d.setDate(d.getDate() + 1);
    else d.setMonth(d.getMonth() + 1);
  }
  for (const k of rule.every) {
    const picked = cands.filter((c) => c.key % k === 0);
    if (picked.length <= maxCount) return picked;
  }
  return cands.filter((c) => c.key % rule.every[rule.every.length - 1] === 0);
}

let geom = null;

function renderChart() {
  const pts = state.series;
  const W = els.chart.clientWidth;
  const H = els.chart.clientHeight;
  if (!W || !H || pts.length < 2) return;
  const m = { top: 10, right: 60, bottom: 26, left: 2 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  let min = Infinity, max = -Infinity;
  for (const p of pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
  const pad = (max - min) * 0.08;
  const { ticks, decimals } = valueTicks(min - pad, max + pad, H < 240 ? 4 : 5);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => m.left + ((t - t0) / (t1 - t0)) * pw;
  const y = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * ph;

  const svg = els.svg;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  // grid + value labels (right side)
  const grid = svgEl('g');
  for (const v of ticks) {
    const yy = Math.round(y(v)) + 0.5;
    grid.append(svgEl('line', { class: 'grid', x1: m.left, x2: m.left + pw, y1: yy, y2: yy }));
    grid.append(svgEl('text', { class: 'axis-label', x: m.left + pw + 8, y: yy + 4 },
      v.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })));
  }
  svg.append(grid);

  // time labels
  const rule = TICK_RULES[state.range];
  const labels = svgEl('g');
  for (const tk of timeTicks(t0, t1, rule, Math.max(2, Math.floor(pw / 60)))) {
    const xx = x(tk.t);
    const date = new Date(tk.t);
    const fmt = state.range === '1Y' && date.getMonth() === 0 ? { month: 'short', year: 'numeric' } : rule.fmt;
    const text = date.toLocaleString(LOCALE, fmt);
    const half = text.length * 3.3;
    if (xx - half < 0 || xx + half > W - 4) continue;
    labels.append(svgEl('text', { class: 'axis-label', x: xx, y: H - 6, 'text-anchor': 'middle' }, text));
  }
  svg.append(labels);

  // area + line
  let d = '';
  pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`; });
  const base = m.top + ph;
  svg.append(svgEl('path', { class: 'area', d: `${d}L${x(t1).toFixed(1)} ${base}L${x(t0).toFixed(1)} ${base}Z` }));
  svg.append(svgEl('path', { class: 'line', d }));

  // live end dot
  const last = pts[pts.length - 1];
  svg.append(svgEl('circle', { class: 'end-dot', cx: x(last.t), cy: y(last.v), r: 4 }));

  // hover layer
  const cross = svgEl('line', { class: 'crosshair', y1: m.top, y2: m.top + ph, visibility: 'hidden' });
  const dot = svgEl('circle', { class: 'hover-dot', r: 5, visibility: 'hidden' });
  svg.append(cross, dot);

  geom = { x, y, m, pw, ph, W, H, cross, dot };
  if (state.hoverT != null) showHover(nearestIndex(state.hoverT));
}

function nearestIndex(t) {
  const pts = state.series;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  return Math.abs(pts[lo].t - t) <= Math.abs(pts[hi].t - t) ? lo : hi;
}

function showHover(i) {
  if (!geom) return;
  const p = state.series[i];
  const px = geom.x(p.t), py = geom.y(p.v);
  geom.cross.setAttribute('x1', px); geom.cross.setAttribute('x2', px);
  geom.cross.setAttribute('visibility', 'visible');
  geom.dot.setAttribute('cx', px); geom.dot.setAttribute('cy', py);
  geom.dot.setAttribute('visibility', 'visible');

  els.tooltipValue.textContent = `${fmtRate(p.v)} ${toCode()}`;
  els.tooltipDate.textContent = fmtWhen(p.t, Date.now());
  const tip = els.tooltip;
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = px + 12;
  if (left + tw > geom.W) left = px - tw - 12;
  const top = Math.min(Math.max(0, py - th - 12), geom.H - th);
  tip.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
}

function hideHover() {
  state.hoverT = null;
  els.tooltip.hidden = true;
  if (geom) {
    geom.cross.setAttribute('visibility', 'hidden');
    geom.dot.setAttribute('visibility', 'hidden');
  }
}

function updateStats() {
  const pts = state.series;
  const first = pts[0].v, last = pts[pts.length - 1].v;
  let hi = -Infinity, lo = Infinity;
  for (const p of pts) { hi = Math.max(hi, p.v); lo = Math.min(lo, p.v); }
  els.chartTitle.textContent = `${fromCode()} / ${toCode()}`;
  const change = document.createElement('span');
  setChange(change, last / first - 1);
  const label = document.createElement('span');
  label.textContent = RANGES[state.range].label;
  const hl = document.createElement('span');
  hl.textContent = `High ${fmtRate(hi)} · Low ${fmtRate(lo)}`;
  els.chartStats.replaceChildren(change, label, hl);
}

function updateChart(now) {
  state.series = buildSeries(now);
  updateStats();
  renderChart();
}

/* =====================================================================
 *  Wiring
 * ===================================================================== */
function updateAll() {
  const now = Date.now();
  updateHero(now);
  updateConverter(now);
  updateChart(now);
}

async function ensureHistory() {
  const code = state.currency;
  if (code === 'EUR' || fx.history[code]) return;
  els.chart.classList.add('loading');
  await loadHistory(code);
  if (state.currency === code) {
    els.chart.classList.remove('loading');
    updateAll();
  }
}

function setRange(range) {
  state.range = range;
  store.set('range', range);
  for (const b of document.querySelectorAll('.ranges button')) {
    b.setAttribute('aria-pressed', String(b.dataset.range === range));
  }
  hideHover();
  updateAll();
}

function onPointer(e) {
  if (!geom) return;
  const rect = els.svg.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * geom.W;
  const pts = state.series;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const t = t0 + ((px - geom.m.left) / geom.pw) * (t1 - t0);
  const i = nearestIndex(t);
  state.hoverT = pts[i].t;
  showHover(i);
}

function onChartKey(e) {
  const pts = state.series;
  let i = state.hoverT == null ? pts.length - 1 : nearestIndex(state.hoverT);
  if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
  else if (e.key === 'ArrowRight') i = Math.min(pts.length - 1, i + 1);
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = pts.length - 1;
  else if (e.key === 'Escape') { hideHover(); return; }
  else return;
  e.preventDefault();
  state.hoverT = pts[i].t;
  showHover(i);
}

function setupThemeToggle() {
  const btn = $('theme-toggle');
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  const label = () => {
    const text = `Switch to ${current() === 'dark' ? 'light' : 'dark'} theme`;
    btn.setAttribute('aria-label', text);
    btn.title = text;
  };
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('theme', next);
    label();
  });
  systemDark.addEventListener('change', label);
  label();
}

function init() {
  for (const el of document.querySelectorAll('[data-place]')) el.textContent = PLACE[el.dataset.place];
  setupThemeToggle();

  const savedCurrency = store.get('currency');
  if (savedCurrency) state.currency = savedCurrency;
  const savedRange = store.get('range');
  if (savedRange && RANGES[savedRange]) state.range = savedRange;

  populateCurrencies();
  mountUnits();

  els.amountA.addEventListener('input', () => { state.lastEdited = 'a'; updateConverter(Date.now()); });
  els.amountB.addEventListener('input', () => { state.lastEdited = 'b'; updateConverter(Date.now()); });
  for (const input of [els.amountA, els.amountB]) input.addEventListener('focus', () => input.select());

  els.swap.addEventListener('click', () => {
    state.placeFirst = !state.placeFirst;
    if (state.lastEdited === 'b') els.amountA.value = els.amountB.value;
    state.lastEdited = 'a';
    mountUnits();
    hideHover();
    updateAll();
  });

  els.currency.addEventListener('change', () => {
    state.currency = els.currency.value;
    store.set('currency', state.currency);
    updateCurrencyDisplay();
    hideHover();
    updateAll();
    ensureHistory();
  });

  for (const b of document.querySelectorAll('.ranges button')) {
    b.addEventListener('click', () => setRange(b.dataset.range));
  }

  els.svg.addEventListener('pointermove', onPointer);
  els.svg.addEventListener('pointerdown', onPointer);
  els.svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideHover(); });
  document.addEventListener('pointerdown', (e) => { if (!els.svg.contains(e.target)) hideHover(); });
  els.svg.addEventListener('keydown', onChartKey);
  els.svg.addEventListener('blur', hideHover);
  new ResizeObserver(() => renderChart()).observe(els.chart);

  setRange(state.range);
  setInterval(() => {
    const now = Date.now();
    updateHero(now);
    updateConverter(now);
    updateChart(now);
  }, TICK);

  loadLatest().then(() => {
    populateCurrencies();
    els.fxDate.textContent = fx.live
      ? ` (rates of ${new Date(fx.date + 'T12:00:00Z').toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })})`
      : ' (offline snapshot, the live service could not be reached)';
    updateAll();
    ensureHistory();
  });
}

init();
