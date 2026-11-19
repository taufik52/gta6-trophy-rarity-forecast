// GTA VI trophy rarity forecast: for every trophy, the percent of the players
// Exophase tracks who will have earned it at the case's target, as five
// quantiles [0.05, 0.25, 0.5, 0.75, 0.95].
//
// The forecast blends two views of the case's history, both fitted in log time
// (x = ln(1 + hours since the game's release)):
//
//   1. Logit trend: a least-squares line of logit(rate) on x, per trophy,
//      fitted on the last 24 hours of reads and read at the target. It
//      follows a trophy's rise as players progress and its fall when a
//      refresh dilutes the tracked pool.
//   2. Dilution model: the earned count and the players-tracked count are
//      projected separately (log-linear in x, last 24 hours) and the rate is
//      their ratio, so a trophy's rate moves because players earn it AND
//      because new players join, instead of conflating the two.
//
// Both moves are damped and capped: a log-time line fitted on launch-night
// growth would otherwise extrapolate the early surge for days, while real
// earn curves saturate. The blended move is also shrunk 25% toward the last
// observed rate, which costs little when a trend is real and saves a lot
// when it has already flattened.
//
// When the history is flat (the page had not refreshed yet, so every read
// agrees), a refresh prior applies instead: the next refresh is expected to
// dilute rates toward the new-players mix, easy trophies least and hard ones
// most, with a widened spread to cover the refresh happening or not.
//
// Spreads come from each trophy's fit residuals plus a random-walk term that
// grows with the horizon. Runs offline, Node 22 standard library only, well
// inside the 8-second per-case cap.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Random-walk spread of a rate's move, in logit units per square-root day. */
const SIGMA_RW = 0.4;
/** Extra spread (logit std) when the history is flat and a refresh is only a prior. */
const SIGMA_FLAT_PRIOR = 0.3;

interface Trophy {
  id: number;
  name: string;
  tier: string;
}

interface Read {
  at: string;
  players_tracked: number;
  trophies_earned: number;
  rates: Array<number | null>;
}

interface Case {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  game: { name: string; release_date: string };
  trophies: Trophy[];
  history: Read[];
}

const clampRate = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => {
  const r = clampRate(pct);
  return Math.log(r / (100 - r));
};
const invLogitPct = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/** Least-squares line y = a + b*x. Returns intercept, slope and residual std. */
function ols(xs: number[], ys: number[]): { a: number; b: number; s: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  const a = my - b * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    rss += r * r;
  }
  const s = n > 2 ? Math.sqrt(rss / (n - 2)) : 0;
  return { a, b, s };
}

function forecastCase(c: Case): { trophies: Array<{ id: number; q: number[] }> } {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`case ${c.id} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (c.history.length === 0) throw new Error(`case ${c.id} has no history`);

  const releaseMs = Date.parse(`${c.game.release_date}T00:00:00Z`);
  const hoursSinceRelease = (iso: string): number =>
    (Date.parse(iso) - releaseMs) / 3_600_000;
  const xOf = (iso: string): number => Math.log(1 + Math.max(0, hoursSinceRelease(iso)));

  const history = [...c.history].sort((p, q) => Date.parse(p.at) - Date.parse(q.at));
  const xT = xOf(c.target);
  const dDays = c.horizon_minutes / 1440;
  const rw = SIGMA_RW * Math.sqrt(dDays);

  // Players-tracked growth, fitted once per case: ln(P) on x.
  const px = history.map((r) => xOf(r.at));
  const plogy = history.map((r) => Math.log(Math.max(1, r.players_tracked)));
  const pFit = ols(px, plogy);

  const rows = c.trophies.map((t, i) => {
    const points: Array<{ x: number; l: number; e: number; p: number }> = [];
    for (const r of history) {
      const rate = r.rates[i];
      if (rate === null || rate === undefined) continue;
      const earned = (rate / 100) * Math.max(1, r.players_tracked);
      points.push({ x: xOf(r.at), l: logit(rate), e: Math.max(earned, 0.05), p: Math.max(1, r.players_tracked) });
    }
    const lastPoint = points[points.length - 1];
    const lastRate = lastPoint !== undefined ? clampRate(invLogitPct(lastPoint.l)) : 0.5;
    const lLast = lastPoint !== undefined ? lastPoint.l : logit(0.5);
    const lValues = points.map((p) => p.l);
    const lRange = lValues.length > 0 ? Math.max(...lValues) - Math.min(...lValues) : 0;
    const distinctX = new Set(points.map((p) => p.x.toFixed(6))).size;
    const flat = points.length < 3 || distinctX < 3 || lRange < 0.02;

    let q50logit: number;
    let sigma: number;

    if (!flat) {
      // Fit on the last 24 hours of reads: the launch-night surge is history,
      // the recent slope is what keeps going.
      const hLast = Math.exp(lastPoint.x) - 1;
      const xCut = Math.log(1 + Math.max(0, hLast - 24));
      const recent = points.filter((p) => p.x >= xCut);
      const fitPts = recent.length >= 3 ? recent : points;
      const xs = fitPts.map((p) => p.x);
      const trend = ols(xs, fitPts.map((p) => p.l));
      const eFit = ols(xs, fitPts.map((p) => Math.log(p.e)));
      const pFitT = ols(xs, fitPts.map((p) => Math.log(p.p)));
      // Damped move from the last observed rate, in logit space.
      const damp = (delta: number): number => {
        const dx = Math.max(0, xT - lastPoint.x);
        const d = delta / (1 + 0.25 * dx);
        return clamp(d, -1.2, 1.2);
      };
      const dTrend = damp(trend.a + trend.b * xT - lLast);
      const pTarget = Math.exp(pFitT.a + pFitT.b * xT);
      const eTarget = Math.exp(eFit.a + eFit.b * xT);
      const predDil = logit(clampRate((100 * eTarget) / Math.max(1, pTarget)));
      const dDil = damp(predDil - lLast);
      // Blend the two moves, shrunk 25% toward the last observed rate.
      q50logit = lLast + 0.75 * (0.5 * dTrend + 0.5 * dDil);
      sigma = clamp(Math.sqrt(trend.s * trend.s + rw * rw), 0.2, 1.5);
    } else {
      // Flat history: the page is stale and a refresh is the main event.
      // Expected refresh size: players accumulate since the first read.
      const firstMs = Date.parse(history[0].at);
      const accumHours = Math.max(0, (Date.parse(c.target) - firstMs) / 3_600_000);
      const k = 1 + 0.6 * accumHours;
      // New players earn a trophy at a rate that rises with how early/easy it
      // is: a trophy everyone already holds is held by newcomers too.
      const yFactor = 0.6 + 0.4 * (lastRate / 100);
      const shifted = lastRate * ((1 + yFactor * (k - 1)) / k);
      q50logit = logit(clampRate(shifted));
      sigma = clamp(Math.sqrt(rw * rw + SIGMA_FLAT_PRIOR * SIGMA_FLAT_PRIOR), 0.35, 1.5);
    }

    const q = Z.map((z) => {
      const v = round4(clamp(invLogitPct(q50logit + z * sigma), 0, 100));
      return v;
    });
    // Rounding must never break the non-decreasing order.
    for (let j = 1; j < q.length; j++) {
      if (q[j] < q[j - 1]) q[j] = q[j - 1];
    }
    return { id: t.id, q };
  });

  return { trophies: rows };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const out = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify(out)}\n`);
}
