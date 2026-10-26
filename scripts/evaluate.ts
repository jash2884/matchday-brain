import { LEAGUES, loadLeague, TUNING_SEASON, WARMUP_SEASON, type LeagueCode } from "../src/data.ts";
import { runSeasons, score, baseRates } from "../src/model.ts";
import { PARAMS } from "../src/params.ts";
for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
  const seasons = await loadLeague(code);
  const preds = runSeasons(seasons, PARAMS).predictions;
  const test = preds.filter((x) => x.season > TUNING_SEASON && x.outcome);
  const train = preds.filter((x) => x.season !== WARMUP_SEASON && x.season <= TUNING_SEASON);
  const rates = baseRates(train);
  const model = score(test);
  const base = score(test.map((x) => ({ probs: rates, outcome: x.outcome })));
  const homeOnly = test.filter((x) => x.outcome === "H").length / test.length;
  console.log(code.padEnd(5), `n=${model.matches}`, `acc ${(model.accuracy*100).toFixed(1)}% (always-home ${(homeOnly*100).toFixed(1)}%)`, `brier ${model.brier.toFixed(3)} vs base ${base.brier.toFixed(3)}`, `logloss ${model.logLoss.toFixed(3)} vs base ${base.logLoss.toFixed(3)}`);
}
