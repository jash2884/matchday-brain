import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedHome, outcomeProbs, run } from "../src/core/elo.ts";
import { score, calibration } from "../src/core/evaluate.ts";
import { readInfo } from "../src/sports/cricket.ts";
import { parseCsv } from "../src/sports/nfl.ts";
import type { EloParams, Match } from "../src/core/types.ts";

const withDraws: EloParams = { k: 20, home: 60, draws: { d0: 0.3, d1: 0.18 }, regress: 0.15, newcomer: -200, mov: "goals", scale: 700 };
const noDraws: EloParams = { ...withDraws, draws: null, mov: "points" };
const m = (id: string, date: string, home: string, away: string, score?: [number, number], extra: Partial<Match> = {}): Match =>
  ({ id, season: date.slice(0, 4), date, home, away, score, ...extra });

test("probabilities sum to 1 and favour the stronger side", () => {
  for (const p of [withDraws, noDraws]) for (const gap of [-400, 0, 400]) {
    const pr = outcomeProbs(expectedHome(1500 + gap, 1500, 0, p.scale), p);
    assert.ok(Math.abs(pr.home + pr.draw + pr.away - 1) < 1e-9);
    if (gap > 0) assert.ok(pr.home > pr.away);
  }
});

test("sports without draws never forecast a draw", () => {
  assert.equal(outcomeProbs(0.5, noDraws).draw, 0);
});

test("draws are most likely between evenly matched teams", () => {
  assert.ok(outcomeProbs(0.5, withDraws).draw > outcomeProbs(0.9, withDraws).draw);
});

test("predictions are walk-forward: a match never sees its own result", () => {
  const { predictions } = run([m("1", "2024-01-01", "A", "B", [5, 0]), m("2", "2024-01-08", "A", "B", [0, 0])], withDraws);
  assert.equal(predictions[0].ratingHome, 1500);
  assert.ok(predictions[1].ratingHome > 1500);
});

test("rating exchange is zero-sum", () => {
  const { ratings } = run([m("1", "2024-01-01", "A", "B", [2, 0])], withDraws);
  assert.equal(Math.round(ratings.get("A")! + ratings.get("B")!), 3000);
});

test("neutral venues remove home advantage", () => {
  const { predictions } = run([m("1", "2024-01-01", "A", "B", undefined, { neutral: true })], withDraws);
  assert.ok(Math.abs(predictions[0].probs.home - predictions[0].probs.away) < 1e-9);
});

test("unforecastable ties are excluded from scoring", () => {
  const preds = [{ probs: { home: 0.6, draw: 0, away: 0.4 }, outcome: "D" as const }, { probs: { home: 0.6, draw: 0, away: 0.4 }, outcome: "H" as const }];
  assert.equal(score(preds).matches, 1);
});

test("calibration bins are well formed", () => {
  const { predictions } = run([m("1", "2024-01-01", "A", "B", [1, 0]), m("2", "2024-01-08", "B", "A", [1, 1])], withDraws);
  for (const b of calibration(predictions, true)) assert.ok(b.observed >= 0 && b.observed <= 1 && b.n > 0);
});

test("cricket reader parses only the info header", () => {
  const text = '{\n "meta": {"x": 1},\n "info": {"dates": ["2024-04-01"], "teams": ["A", "B"], "gender": "male", "match_type": "T20", "outcome": {"winner": "A", "by": {"runs": 5}}},\n "innings": [ {"broken": ';
  assert.equal(readInfo(text)?.outcome?.winner, "A");
});

test("CSV parser handles quotes", () => {
  const rows = parseCsv('a,b\n1,"x, y"\n2,"say ""hi"""\n');
  assert.deepEqual(rows, [{ a: "1", b: "x, y" }, { a: "2", b: 'say "hi"' }]);
});
