// Generic walk-forward Elo engine. Every prediction uses only results that
// happened before it; ratings update only after a result is known.
import type { EloParams, Match, Outcome, Prediction, Probs } from "./types.ts";

export const BASE = 1500;

export function expectedHome(rh: number, ra: number, homeAdv: number, scale = 400): number {
  return 1 / (1 + Math.pow(10, -(rh + homeAdv - ra) / scale));
}

export function outcomeProbs(e: number, p: EloParams): Probs {
  if (!p.draws) return { home: e, draw: 0, away: 1 - e };
  const draw = Math.min(0.45, Math.max(0.03, p.draws.d0 - p.draws.d1 * Math.abs(2 * e - 1)));
  const home = Math.max(0.01, e - draw / 2);
  const away = Math.max(0.01, 1 - e - draw / 2);
  const t = home + draw + away;
  return { home: home / t, draw: draw / t, away: away / t };
}

export function pickOf(p: Probs): Outcome {
  if (p.home >= p.draw && p.home >= p.away) return "H";
  return p.away >= p.draw ? "A" : "D";
}

export function outcomeFromScore(s: [number, number]): Outcome {
  return s[0] > s[1] ? "H" : s[0] < s[1] ? "A" : "D";
}

function movMultiplier(p: EloParams, m: Match, outcome: Outcome, ratingGapWinner: number): number {
  if (p.mov === "none" || !m.score) return 1;
  const diff = Math.abs(m.score[0] - m.score[1]);
  if (p.mov === "goals") return Math.log(diff + 1) + 1;
  // "points": FiveThirtyEight-style, damped when the favourite wins big.
  if (outcome === "D") return 1;
  return (Math.log(diff + 1) * 2.2) / (ratingGapWinner * 0.001 + 2.2);
}

const letter = (o: Outcome, side: "H" | "A") => (o === "D" ? "D" : o === side ? "W" : "L");

export function run(matches: Match[], p: EloParams) {
  const ratings = new Map<string, number>();
  const form = new Map<string, string>();
  const played = new Map<string, number>();
  const ratingAtSeasonStart = new Map<string, number>();
  const predictions: Prediction[] = [];
  const ordered = [...matches].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let season: string | null = null;
  let firstSeason = true;

  for (const m of ordered) {
    if (m.season !== season) {
      if (season !== null) {
        firstSeason = false;
        for (const [t, r] of ratings) ratings.set(t, BASE + (r - BASE) * (1 - p.regress));
      }
      season = m.season;
      for (const [t, r] of ratings) ratingAtSeasonStart.set(t, r);
    }
    for (const t of [m.home, m.away]) {
      if (!ratings.has(t)) {
        const start = firstSeason ? BASE : BASE + p.newcomer;
        ratings.set(t, start);
        ratingAtSeasonStart.set(t, start);
      }
    }
    const rh = ratings.get(m.home)!, ra = ratings.get(m.away)!;
    const homeAdv = m.neutral ? 0 : p.home;
    const e = expectedHome(rh, ra, homeAdv, p.scale ?? 400);
    const probs = outcomeProbs(e, p);
    const outcome = m.outcome ?? (m.score ? outcomeFromScore(m.score) : undefined);
    const pred: Prediction = {
      id: m.id, season: m.season, date: m.date, label: m.label, home: m.home, away: m.away, neutral: m.neutral,
      ratingHome: Math.round(rh), ratingAway: Math.round(ra), probs, pick: pickOf(probs),
      formHome: form.get(m.home) ?? "", formAway: form.get(m.away) ?? "",
      score: m.score, outcome, detail: m.detail,
    };
    predictions.push(pred);
    if (!outcome) continue;

    const actual = outcome === "H" ? 1 : outcome === "A" ? 0 : 0.5;
    const winnerGap = outcome === "H" ? rh + homeAdv - ra : outcome === "A" ? ra - rh - homeAdv : 0;
    const delta = p.k * movMultiplier(p, m, outcome, winnerGap) * (actual - e);
    ratings.set(m.home, rh + delta);
    ratings.set(m.away, ra - delta);
    form.set(m.home, ((form.get(m.home) ?? "") + letter(outcome, "H")).slice(-5));
    form.set(m.away, ((form.get(m.away) ?? "") + letter(outcome, "A")).slice(-5));
    played.set(m.home, (played.get(m.home) ?? 0) + 1);
    played.set(m.away, (played.get(m.away) ?? 0) + 1);
  }
  return { predictions, ratings, ratingAtSeasonStart, played };
}

export const shortName = (n: string) =>
  n.replace(/\s+(FC|AFC|CF|SC)$/, "").replace(/^(FC|AC|SSC|AS|US)\s+/, "");

export function explain(x: Prediction, p: EloParams): string {
  const homeAdv = x.neutral ? 0 : p.home;
  const gap = x.ratingHome + homeAdv - x.ratingAway;
  const fav = shortName(gap >= 0 ? x.home : x.away);
  const size = Math.abs(gap) < 40 ? "an even contest" : Math.abs(gap) < 120 ? `a moderate edge for ${fav}` : `a clear edge for ${fav}`;
  const venue = homeAdv ? `, plus ${homeAdv} points for home advantage,` : " at a neutral venue";
  const formNote = (team: string, f: string) => {
    if (f.length < 4) return "";
    const w = [...f].filter((c) => c === "W").length;
    return w >= 4 ? `${shortName(team)} are in strong form (${f}).` : w <= 1 ? `${shortName(team)} are struggling (${f}).` : "";
  };
  return [`Ratings ${x.ratingHome} vs ${x.ratingAway}${venue} give ${size}.`, formNote(x.home, x.formHome), formNote(x.away, x.formAway)]
    .filter(Boolean).join(" ");
}
