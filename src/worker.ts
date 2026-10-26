import { LEAGUES, loadLeague, TUNING_SEASON, WARMUP_SEASON, type LeagueCode } from "./data.ts";
import { baseRates, calibration, explain, runSeasons, score, type Prediction } from "./model.ts";
import { PARAMS } from "./params.ts";

type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> } };

const CACHE_SECONDS = 3 * 60 * 60;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  });

// Fetch source files through Cloudflare's cache so we don't hit GitHub on every request.
const cachedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } } as RequestInit);

export async function buildLeague(code: LeagueCode, fetcher: typeof fetch = cachedFetch) {
  const seasons = await loadLeague(code, fetcher);
  if (!seasons.length) throw new Error("No data available for this league.");
  const { predictions, ratings } = runSeasons(seasons, PARAMS);
  const current = seasons[seasons.length - 1].season;

  const played = predictions.filter((x) => x.outcome);
  const updatedThrough = played.reduce((d, x) => (x.date > d ? x.date : d), "");

  // Next up: the earliest unplayed fixtures in the current season.
  // Fixtures dated after the latest recorded result; earlier gaps are missing data, not future games.
  const upcoming = predictions.filter((x) => x.season === current && !x.outcome && x.date > updatedThrough);
  const missingResults = predictions.filter((x) => x.season === current && !x.outcome && x.date <= updatedThrough).length;
  const nextRound = upcoming[0]?.round;
  const nextUp = upcoming
    .filter((x) => x.round === nextRound)
    .map((x) => ({ ...round(x), why: explain(x, PARAMS) }));

  // Honest evaluation: only seasons never used for tuning.
  const test = played.filter((x) => x.season > TUNING_SEASON);
  const train = played.filter((x) => x.season !== WARMUP_SEASON && x.season <= TUNING_SEASON);
  const rates = baseRates(train);
  const homeOnly = { home: 1, draw: 0, away: 0 };
  const metrics = {
    model: score(test),
    baseRates: score(test.map((x) => ({ probs: rates, outcome: x.outcome }))),
    alwaysHome: score(test.map((x) => ({ probs: homeOnly, outcome: x.outcome, pick: "H" as const }))),
  };

  const currentTeams = new Set(predictions.filter((x) => x.season === current).flatMap((x) => [x.home, x.away]));
  const table = [...ratings.entries()]
    .filter(([team]) => currentTeams.has(team))
    .sort((a, b) => b[1] - a[1])
    .map(([team, rating]) => ({ team, rating: Math.round(rating) }));

  return {
    league: { code, ...LEAGUES[code] },
    season: current,
    updatedThrough,
    missingResults,
    nextUp,
    table,
    evaluation: {
      seasons: [...new Set(test.map((x) => x.season))],
      metrics,
      calibration: calibration(test),
      recent: test.slice(-20).reverse().map(round),
    },
    model: { params: PARAMS, tuningSeason: TUNING_SEASON },
  };
}

function round(x: Prediction) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { ...x, probs: { home: r(x.probs.home), draw: r(x.probs.draw), away: r(x.probs.away) } };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/leagues") return json(Object.entries(LEAGUES).map(([code, l]) => ({ code, ...l })));

    const match = url.pathname.match(/^\/api\/league\/([a-z]{2}\.1)$/);
    if (match) {
      const code = match[1] as LeagueCode;
      if (!(code in LEAGUES)) return json({ error: "Unknown league." }, 404);
      const cache = caches.default;
      const key = new Request(url.toString(), { method: "GET" });
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const response = json(await buildLeague(code));
        ctx.waitUntil(cache.put(key, response.clone()));
        return response;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Could not load league data." }, 502);
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
