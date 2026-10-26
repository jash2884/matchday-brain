import type { CalibrationBin, Metrics, Outcome, Prediction, Probs } from "./types.ts";
import { pickOf } from "./elo.ts";

const probOf = (p: Probs, o: Outcome) => (o === "H" ? p.home : o === "D" ? p.draw : p.away);

export function score(preds: { probs: Probs; outcome?: Outcome; pick?: Outcome }[]): Metrics {
  // Rare ties in sports without a draw model (e.g. NFL) are not forecastable
  // outcomes, so they are excluded from scoring (they still update ratings).
  const played = preds.filter((x) => x.outcome && !(x.outcome === "D" && x.probs.draw === 0));
  let correct = 0, brier = 0, logLoss = 0;
  for (const x of played) {
    const o = x.outcome!;
    if ((x.pick ?? pickOf(x.probs)) === o) correct++;
    for (const k of ["H", "D", "A"] as Outcome[]) brier += (probOf(x.probs, k) - (k === o ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(1e-6, probOf(x.probs, o)));
  }
  const n = played.length || 1;
  return { matches: played.length, accuracy: correct / n, brier: brier / n, logLoss: logLoss / n };
}

export function baseRates(preds: { outcome?: Outcome }[], hasDraws: boolean): Probs {
  const played = preds.filter((x) => x.outcome);
  const n = played.length || 1;
  const rate = (o: Outcome) => played.filter((x) => x.outcome === o).length / n;
  const r = { home: rate("H"), draw: hasDraws ? rate("D") : 0, away: rate("A") };
  const t = r.home + r.draw + r.away || 1;
  return { home: r.home / t, draw: r.draw / t, away: r.away / t };
}

export function calibration(preds: Prediction[], hasDraws: boolean): CalibrationBin[] {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, forecast: 0, hits: 0, n: 0 }));
  const outcomes: Outcome[] = hasDraws ? ["H", "D", "A"] : ["H", "A"];
  for (const x of preds) {
    if (!x.outcome || (x.outcome === "D" && !hasDraws)) continue;
    for (const o of outcomes) {
      const p = probOf(x.probs, o);
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.forecast += p; b.n++; b.hits += x.outcome === o ? 1 : 0;
    }
  }
  return bins.filter((b) => b.n > 0).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, forecast: b.forecast / b.n, observed: b.hits / b.n }));
}
