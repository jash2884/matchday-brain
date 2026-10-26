// Tune Elo settings per sport group on its tuning window only (minimum log loss).
// Usage: node scripts/fit.ts [football|nfl|cricket|cricketTests]
import { run } from "../src/core/elo.ts";
import { score } from "../src/core/evaluate.ts";
import type { EloParams, Match } from "../src/core/types.ts";
import { SPORTS } from "../src/sports/index.ts";

const GROUPS: Record<string, { sport: string; comps?: string[]; exclude?: string[] }> = {
  football: { sport: "football" },
  nfl: { sport: "nfl" },
  cricket: { sport: "cricket", exclude: ["test-men"] },
  cricketTests: { sport: "cricket", comps: ["test-men"] },
};

const which = process.argv[2] ?? "football";
const g = GROUPS[which];
const sport = SPORTS.find((s) => s.id === g.sport)!;
const comps = sport.competitions.map((c) => c.id).filter((c) => (g.comps ? g.comps.includes(c) : true) && !g.exclude?.includes(c));
const data: Match[][] = [];
for (const c of comps) data.push(await sport.load(c));

const base = sport.params(comps[0]);
const grid = {
  k: [8, 12, 16, 20, 24, 32, 40, 56, 72, 96],
  scale: [400, 550, 700, 900, 1100, 1400],
  home: sport.hasHomeAdvantage ? [0, 20, 35, 48, 60, 75] : [0],
  regress: [0, 0.15, 0.25, 0.33, 0.5],
  newcomer: [-300, -200, -100, 0],
  draws: base.draws ? [{ d0: 0.22, d1: 0.15 }, { d0: 0.26, d1: 0.18 }, { d0: 0.3, d1: 0.18 }, { d0: 0.34, d1: 0.22 }, { d0: 0.38, d1: 0.26 }] : [null],
};
let best: { p: EloParams; ll: number; n: number } | null = null;
for (const k of grid.k) for (const scale of grid.scale) for (const home of grid.home) for (const regress of grid.regress) for (const newcomer of grid.newcomer) for (const draws of grid.draws) {
  const p: EloParams = { ...base, k, scale, home, regress, newcomer, draws };
  let ll = 0, n = 0;
  for (const matches of data) {
    const preds = run(matches, p).predictions.filter((x) => x.season >= sport.split.tuneFrom && x.season <= sport.split.tuneTo);
    const m = score(preds); ll += m.logLoss * m.matches; n += m.matches;
  }
  if (!best || ll / n < best.ll) best = { p, ll: ll / n, n };
}
console.log(which, JSON.stringify(best));
