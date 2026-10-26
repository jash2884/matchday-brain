// Edge Worker: serves the static app plus a small versioned JSON API over the
// precomputed snapshots. Request-time work is limited to cheap lookups.
import { expectedHome, outcomeProbs, pickOf } from "./core/elo.ts";
import type { CompetitionSnapshot } from "./core/types.ts";
import { type AnalyticsEnv, type Ctx, recordEvent, recordPageview } from "./analytics.ts";

type Env = AnalyticsEnv & { ASSETS: { fetch: (request: Request | string) => Promise<Response> } };

const SITE = "matchday";

const API_CACHE = "public, max-age=300, stale-while-revalidate=3600";

function json(data: unknown, status = 200, cache = API_CACHE) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const SLUG = /^[a-z0-9][a-z0-9.-]{0,40}$/;

async function snapshot(env: Env, origin: string, sport: string, comp: string): Promise<CompetitionSnapshot | null> {
  if (!SLUG.test(sport) || !SLUG.test(comp)) return null;
  const res = await env.ASSETS.fetch(`${origin}/data/${sport}/${comp}.json`);
  if (!res.ok) return null;
  return (await res.json()) as CompetitionSnapshot;
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // Cookieless visit counting shared with Chat Wrapped (see src/analytics.ts).
    if (url.pathname === "/" && request.method === "GET") ctx.waitUntil(recordPageview(env, request, SITE));
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, "no-store");

    if (path === "/api/v1" || path === "/api/v1/health") {
      return json({ status: "ok", service: "matchday-brain", version: "1", endpoints: ["/api/v1/catalog", "/api/v1/{sport}/{competition}", "/api/v1/{sport}/{competition}/predict?home=&away=&neutral=1"] }, 200, "no-store");
    }
    if (path === "/api/v1/catalog") {
      const res = await env.ASSETS.fetch(`${url.origin}/data/catalog.json`);
      return res.ok ? json(await res.json()) : json({ error: "Catalog not available yet." }, 503, "no-store");
    }

    const m = path.match(/^\/api\/v1\/([^/]+)\/([^/]+)(\/predict)?$/);
    if (!m) return json({ error: "Not found." }, 404, "no-store");
    const snap = await snapshot(env, url.origin, m[1], m[2]);
    if (!snap) return json({ error: "Unknown sport or competition." }, 404, "no-store");
    if (!m[3]) return json(snap);

    // Head-to-head predictor from the latest ratings.
    const home = url.searchParams.get("home") ?? "";
    const away = url.searchParams.get("away") ?? "";
    const ratings = new Map(snap.table.map((t) => [t.team, t.rating]));
    if (!ratings.has(home) || !ratings.has(away)) return json({ error: "Pick two teams from this competition's ratings table." }, 400, "no-store");
    if (home === away) return json({ error: "Pick two different teams." }, 400, "no-store");
    const neutral = !snap.hasHomeAdvantage || url.searchParams.get("neutral") === "1";
    const p = snap.params;
    const e = expectedHome(ratings.get(home)!, ratings.get(away)!, neutral ? 0 : p.home, p.scale ?? 400);
    const probs = outcomeProbs(e, p);
    ctx.waitUntil(recordEvent(env, SITE, "predict"));
    return json({ home, away, neutral, ratingHome: ratings.get(home), ratingAway: ratings.get(away), probs, pick: pickOf(probs), basedOn: snap.updatedThrough });
  },
};
