// Matchday Brain prediction model: Elo ratings with home advantage, a
// margin-of-victory multiplier, between-season regression, and a draw model.
// Every prediction is made walk-forward: only matches before it are used.

export type RawMatch = {
  round?: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft?: [number, number] };
};

export type Params = {
  k: number;          // rating update speed
  home: number;       // home advantage in Elo points
  draw0: number;      // draw probability when teams are level
  draw1: number;      // how fast draw probability falls as the gap grows
  regress: number;    // share of each rating pulled back to 1500 between seasons
  promoted: number;   // starting offset for a team new to the league
};

export type Probs = { home: number; draw: number; away: number };
export type Outcome = "H" | "D" | "A";

export type Prediction = {
  season: string;
  round: string;
  date: string;
  home: string;
  away: string;
  ratingHome: number;
  ratingAway: number;
  probs: Probs;
  pick: Outcome;
  formHome: string; // e.g. "WWDLW", most recent last
  formAway: string;
  result?: [number, number];
  outcome?: Outcome;
};

const BASE = 1500;

export function expectedHome(ratingHome: number, ratingAway: number, home: number): number {
  return 1 / (1 + Math.pow(10, -(ratingHome + home - ratingAway) / 400));
}

export function outcomeProbs(e: number, p: Params): Probs {
  // Draws are most likely when the expected score is close to 0.5.
  const draw = Math.min(0.45, Math.max(0.05, p.draw0 - p.draw1 * Math.abs(2 * e - 1)));
  let home = e - draw / 2;
  let away = 1 - e - draw / 2;
  home = Math.max(0.01, home);
  away = Math.max(0.01, away);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

export function outcomeOf(score: [number, number]): Outcome {
  return score[0] > score[1] ? "H" : score[0] < score[1] ? "A" : "D";
}

function pickOf(p: Probs): Outcome {
  if (p.home >= p.draw && p.home >= p.away) return "H";
  if (p.away >= p.draw) return "A";
  return "D";
}

function marginMultiplier(goalDiff: number): number {
  return Math.log(Math.abs(goalDiff) + 1) + 1;
}

const resultLetter = (scored: number, conceded: number) => (scored > conceded ? "W" : scored < conceded ? "L" : "D");

export function hasResult(m: RawMatch): m is RawMatch & { score: { ft: [number, number] } } {
  return Array.isArray(m.score?.ft) && m.score!.ft!.length === 2;
}

// Walk forward through seasons in order. Played matches get a prediction
// (made before the match) and then update ratings; unplayed fixtures get a
// prediction from the latest ratings.
export function runSeasons(seasons: { season: string; matches: RawMatch[] }[], p: Params) {
  const ratings = new Map<string, number>();
  const form = new Map<string, string>();
  const predictions: Prediction[] = [];
  let previousTeams = new Set<string>();

  for (const { season, matches } of seasons) {
    // Between seasons: pull ratings toward the mean; new teams start below it.
    const teams = new Set(matches.flatMap((m) => [m.team1, m.team2]));
    for (const [team, r] of ratings) ratings.set(team, BASE + (r - BASE) * (1 - p.regress));
    for (const team of teams) {
      if (!ratings.has(team)) ratings.set(team, previousTeams.size ? BASE + p.promoted : BASE);
      form.set(team, "");
    }
    previousTeams = teams;

    const ordered = [...matches].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
    for (const m of ordered) {
      const rh = ratings.get(m.team1) ?? BASE;
      const ra = ratings.get(m.team2) ?? BASE;
      const e = expectedHome(rh, ra, p.home);
      const probs = outcomeProbs(e, p);
      const prediction: Prediction = {
        season, round: m.round ?? "", date: m.date, home: m.team1, away: m.team2,
        ratingHome: Math.round(rh), ratingAway: Math.round(ra), probs, pick: pickOf(probs),
        formHome: form.get(m.team1) ?? "", formAway: form.get(m.team2) ?? "",
      };
      if (hasResult(m)) {
        const [gh, ga] = m.score.ft;
        prediction.result = [gh, ga];
        prediction.outcome = outcomeOf([gh, ga]);
        const actual = gh > ga ? 1 : gh < ga ? 0 : 0.5;
        const delta = p.k * marginMultiplier(gh - ga) * (actual - e);
        ratings.set(m.team1, rh + delta);
        ratings.set(m.team2, ra - delta);
        form.set(m.team1, ((form.get(m.team1) ?? "") + resultLetter(gh, ga)).slice(-5));
        form.set(m.team2, ((form.get(m.team2) ?? "") + resultLetter(ga, gh)).slice(-5));
      }
      predictions.push(prediction);
    }
  }
  return { predictions, ratings };
}

// ---- Evaluation ---------------------------------------------------------

export type Metrics = {
  matches: number;
  accuracy: number;
  brier: number;   // multi-class Brier score, lower is better (0..2)
  logLoss: number; // lower is better
};

function probOf(p: Probs, o: Outcome) {
  return o === "H" ? p.home : o === "D" ? p.draw : p.away;
}

export function score(preds: { probs: Probs; outcome?: Outcome; pick?: Outcome }[]): Metrics {
  const played = preds.filter((x) => x.outcome);
  let correct = 0, brier = 0, logLoss = 0;
  for (const x of played) {
    const o = x.outcome!;
    const pick = x.pick ?? pickOf(x.probs);
    if (pick === o) correct++;
    brier += (x.probs.home - (o === "H" ? 1 : 0)) ** 2 + (x.probs.draw - (o === "D" ? 1 : 0)) ** 2 + (x.probs.away - (o === "A" ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(1e-9, probOf(x.probs, o)));
  }
  const n = played.length || 1;
  return { matches: played.length, accuracy: correct / n, brier: brier / n, logLoss: logLoss / n };
}

// Baseline: always predict the league's historical outcome rates.
export function baseRates(preds: { outcome?: Outcome }[]): Probs {
  const played = preds.filter((x) => x.outcome);
  const n = played.length || 1;
  const count = (o: Outcome) => played.filter((x) => x.outcome === o).length / n;
  return { home: count("H"), draw: count("D"), away: count("A") };
}

// Calibration: for every outcome probability the model assigned, group into
// 10% bins and compare the average forecast with how often it happened.
export function calibration(preds: { probs: Probs; outcome?: Outcome }[]) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, forecast: 0, hits: 0, n: 0 }));
  for (const x of preds) {
    if (!x.outcome) continue;
    for (const o of ["H", "D", "A"] as Outcome[]) {
      const p = probOf(x.probs, o);
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.forecast += p; b.n += 1; b.hits += x.outcome === o ? 1 : 0;
    }
  }
  return bins.filter((b) => b.n > 0).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, forecast: b.forecast / b.n, observed: b.hits / b.n }));
}

export const shortName = (n: string) => n.replace(/\s+(FC|AFC|CF|SC)$/, "").replace(/^(FC|AC|SSC|AS|US)\s+/, "");

// Plain-English reason built only from the model's own numbers.
export function explain(x: Prediction, p: Params): string {
  const gap = x.ratingHome + p.home - x.ratingAway;
  const fav = shortName(gap >= 0 ? x.home : x.away);
  const strength = Math.abs(gap) < 40 ? "an even contest" : Math.abs(gap) < 120 ? `a moderate edge for ${fav}` : `a clear edge for ${fav}`;
  const formNote = (team: string, f: string) => {
    if (!f) return "";
    const wins = [...f].filter((c) => c === "W").length;
    return wins >= 4 ? `${team} are in strong form (${f}).` : wins <= 1 && f.length >= 4 ? `${team} are struggling (${f}).` : "";
  };
  const parts = [
    `Ratings ${x.ratingHome} vs ${x.ratingAway}, plus ${p.home} points for home advantage, give ${strength}.`,
    formNote(shortName(x.home), x.formHome),
    formNote(shortName(x.away), x.formAway),
  ].filter(Boolean);
  return parts.join(" ");
}
