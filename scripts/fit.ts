// Grid-search model settings on the tuning season only, across all leagues.
import { LEAGUES, loadLeague, TUNING_SEASON, type LeagueCode } from "../src/data.ts";
import { runSeasons, score, type Params } from "../src/model.ts";

const leagues = await Promise.all((Object.keys(LEAGUES) as LeagueCode[]).map(async (c) => [c, await loadLeague(c)] as const));
let best: { p: Params; ll: number } | null = null;
for (const k of [4, 6, 8, 10, 12, 14])
  for (const home of [10, 20, 30, 40, 50])
    for (const draw0 of [0.28, 0.30, 0.32])
      for (const draw1 of [0.14, 0.18, 0.22])
        for (const regress of [0, 0.1, 0.2])
          for (const promoted of [-250, -200, -150]) {
            const p = { k, home, draw0, draw1, regress, promoted };
            let ll = 0, n = 0;
            for (const [, seasons] of leagues) {
              const upToTuning = seasons.filter((s) => s.season <= TUNING_SEASON);
              const preds = runSeasons(upToTuning, p).predictions.filter((x) => x.season === TUNING_SEASON);
              const m = score(preds);
              ll += m.logLoss * m.matches; n += m.matches;
            }
            if (!best || ll / n < best.ll) best = { p, ll: ll / n };
          }
console.log(JSON.stringify(best));
