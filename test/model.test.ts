import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedHome, outcomeProbs, runSeasons, score, calibration, type RawMatch } from "../src/model.ts";
import { PARAMS } from "../src/params.ts";

const m = (date: string, team1: string, team2: string, ft?: [number, number]): RawMatch => ({ date, team1, team2, round: "R", ...(ft ? { score: { ft } } : {}) });

test("probabilities sum to 1 and favour the stronger side", () => {
  for (const gap of [-400, -100, 0, 100, 400]) {
    const p = outcomeProbs(expectedHome(1500 + gap, 1500, 0), PARAMS);
    assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
    if (gap > 0) assert.ok(p.home > p.away);
    if (gap < 0) assert.ok(p.away > p.home);
  }
});

test("draws are most likely between evenly matched teams", () => {
  const even = outcomeProbs(0.5, PARAMS).draw;
  const lopsided = outcomeProbs(0.9, PARAMS).draw;
  assert.ok(even > lopsided);
});

test("predictions are walk-forward: a match never uses its own result", () => {
  const seasons = [{ season: "2024-25", matches: [m("2024-08-01", "A", "B", [5, 0]), m("2024-08-08", "A", "B", [0, 0])] }];
  const [first, second] = runSeasons(seasons, PARAMS).predictions;
  assert.equal(first.ratingHome, 1500); // before any result
  assert.ok(second.ratingHome > 1500);   // updated only after the first match
});

test("winners gain rating, losers lose the same amount", () => {
  const { ratings } = runSeasons([{ season: "s", matches: [m("2024-01-01", "A", "B", [2, 0])] }], PARAMS);
  assert.ok(ratings.get("A")! > 1500);
  assert.equal(Math.round(ratings.get("A")! + ratings.get("B")!), 3000);
});

test("unplayed fixtures are predicted but not scored", () => {
  const { predictions } = runSeasons([{ season: "s", matches: [m("2024-01-01", "A", "B", [1, 0]), m("2024-01-08", "B", "A")] }], PARAMS);
  assert.equal(predictions.length, 2);
  assert.equal(score(predictions).matches, 1);
});

test("calibration bins are well formed", () => {
  const preds = [{ probs: { home: 0.6, draw: 0.25, away: 0.15 }, outcome: "H" as const }];
  const bins = calibration(preds);
  assert.equal(bins.reduce((n, b) => n + b.n, 0), 3);
  for (const b of bins) assert.ok(b.observed >= 0 && b.observed <= 1);
});
