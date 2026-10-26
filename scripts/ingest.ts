// Ingestion job: fetch every sport's data, run the walk-forward model and
// write small JSON snapshots to public/data/ for the CDN to serve.
// One competition failing never blocks the others.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { run, explain } from "../src/core/elo.ts";
import { score, baseRates, calibration } from "../src/core/evaluate.ts";
import type { CompetitionSnapshot, Prediction } from "../src/core/types.ts";
import { SPORTS } from "../src/sports/index.ts";
import { drawsFor } from "../src/sports/adapter.ts";

const OUT = "public/data";
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const slim = (x: Prediction): Prediction => ({ ...x, probs: { home: r3(x.probs.home), draw: r3(x.probs.draw), away: r3(x.probs.away) } });

type CatalogEntry = { id: string; name: string; competitions: { id: string; name: string; short: string; region?: string; updatedThrough?: string; ok: boolean; error?: string }[] };
const catalog: { generatedAt: string; sports: CatalogEntry[] } = { generatedAt: new Date().toISOString(), sports: [] };
let failures = 0;

for (const sport of SPORTS) {
  const entry: CatalogEntry = { id: sport.id, name: sport.name, competitions: [] };
  mkdirSync(`${OUT}/${sport.id}`, { recursive: true });
  for (const comp of sport.competitions) {
    const started = Date.now();
    try {
      const matches = await sport.load(comp.id);
      if (!matches.length) throw new Error("source returned no matches");
      const p = sport.params(comp.id);
      const hasDraws = drawsFor(sport, comp.id);
      const { predictions, ratings, ratingAtSeasonStart, played } = run(matches, p);
      const results = predictions.filter((x) => x.outcome);
      const updatedThrough = results.reduce((d, x) => (x.date > d ? x.date : d), "");
      const currentSeason = predictions.reduce((s, x) => (x.season > s ? x.season : s), "");

      const upcoming = predictions.filter((x) => !x.outcome && x.date > updatedThrough).sort((a, b) => a.date.localeCompare(b.date));
      // Show the next round; if it is nearly finished, include the following one too.
      const labels = [...new Set(upcoming.map((x) => x.label ?? ""))];
      let shown = upcoming.filter((x) => (x.label ?? "") === labels[0]);
      if (shown.length < 4 && labels.length > 1) shown = upcoming.filter((x) => [labels[0], labels[1]].includes(x.label ?? ""));
      const nextUp = (labels.length ? shown : upcoming).slice(0, 18)
        .map((x) => ({ ...slim(x), why: explain(x, p) }));
      const missingResults = predictions.filter((x) => !x.outcome && x.date <= updatedThrough && x.season === currentSeason).length;

      const test = results.filter((x) => x.season > sport.split.tuneTo);
      const train = results.filter((x) => x.season >= sport.split.tuneFrom && x.season <= sport.split.tuneTo);
      const rates = baseRates(train, hasDraws);
      const activeSince = new Date(Date.parse(updatedThrough) - 400 * 864e5).toISOString().slice(0, 10);
      const active = new Set(predictions.filter((x) => x.date >= activeSince).flatMap((x) => [x.home, x.away]));

      const snapshot: CompetitionSnapshot = {
        sport: sport.id,
        competition: comp,
        generatedAt: new Date().toISOString(),
        updatedThrough,
        missingResults,
        hasDraws,
        hasHomeAdvantage: sport.hasHomeAdvantage,
        nextUp,
        table: [...ratings.entries()].filter(([t]) => active.has(t)).sort((a, b) => b[1] - a[1])
          .map(([team, rating]) => ({ team, rating: Math.round(rating), change: Math.round(rating - (ratingAtSeasonStart.get(team) ?? rating)), played: played.get(team) ?? 0 })),
        evaluation: {
          window: `${[...new Set(test.map((x) => x.season))].sort()[0] ?? "-"} onward`,
          metrics: {
            model: score(test),
            baseRates: score(test.map((x) => ({ probs: rates, outcome: x.outcome }))),
            alwaysHome: sport.hasHomeAdvantage ? score(test.map((x) => ({ probs: { home: 1, draw: 0, away: 0 }, outcome: x.outcome, pick: "H" as const }))) : null,
          },
          calibration: calibration(test, hasDraws),
          recent: test.slice(-24).reverse().map(slim),
        },
        params: p,
        source: sport.source,
      };
      writeFileSync(`${OUT}/${sport.id}/${comp.id}.json`, JSON.stringify(snapshot));
      entry.competitions.push({ ...comp, updatedThrough, ok: true });
      console.log(`ok   ${sport.id}/${comp.id}  ${matches.length} matches, through ${updatedThrough}, acc ${(snapshot.evaluation.metrics.model.accuracy * 100).toFixed(1)}%  (${Date.now() - started} ms)`);
    } catch (e) {
      failures++;
      const message = e instanceof Error ? e.message : String(e);
      // Keep serving the last good snapshot if one exists.
      const previous = `${OUT}/${sport.id}/${comp.id}.json`;
      const stale = existsSync(previous) ? (JSON.parse(readFileSync(previous, "utf8")) as CompetitionSnapshot).updatedThrough : undefined;
      entry.competitions.push({ ...comp, updatedThrough: stale, ok: Boolean(stale), error: message });
      console.error(`FAIL ${sport.id}/${comp.id}: ${message}${stale ? " (keeping previous snapshot)" : ""}`);
    }
  }
  catalog.sports.push(entry);
}
writeFileSync(`${OUT}/catalog.json`, JSON.stringify(catalog));
console.log(`catalog written, ${failures} failure(s)`);
const total = SPORTS.reduce((n, s) => n + s.competitions.length, 0);
if (failures === total) process.exit(1); // only fail the job if nothing worked
