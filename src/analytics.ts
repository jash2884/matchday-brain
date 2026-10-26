// Privacy-friendly analytics: daily counters in D1. No cookies, no client-side
// tracker, no IP addresses stored. Unique visitors are counted with a salted
// daily hash of IP + user agent that can't be reversed or linked across days.
// The same file is used by Chat Wrapped and Matchday Brain (one shared database).

type Stmt = { bind: (...values: unknown[]) => Stmt; run: () => Promise<{ meta: { changes: number } }>; all: <T>() => Promise<{ results: T[] }> };
export type D1 = { prepare: (sql: string) => Stmt; batch: (statements: Stmt[]) => Promise<unknown[]> };
export type AnalyticsEnv = { DB?: D1; ANALYTICS_SALT?: string };
export type Ctx = { waitUntil: (p: Promise<unknown>) => void };

const PREVIEWS: [RegExp, string][] = [
  [/whatsapp/i, "whatsapp"], [/facebookexternalhit|facebot/i, "facebook"], [/telegrambot/i, "telegram"],
  [/twitterbot/i, "x"], [/linkedinbot/i, "linkedin"], [/slackbot/i, "slack"], [/discordbot/i, "discord"],
  [/skypeuripreview|teams/i, "microsoft"], [/iframely|embedly/i, "other"],
];
const BOT = /bot|crawl|spider|slurp|scan|curl|wget|python|httpx|aiohttp|go-http|java\/|okhttp|axios|node-fetch|headless|lighthouse|pagespeed|monitor|uptime|preview/i;

export type Visit = { kind: "human" } | { kind: "preview"; app: string } | { kind: "bot" };

export function classify(request: Request): Visit {
  const ua = request.headers.get("user-agent") ?? "";
  for (const [re, app] of PREVIEWS) if (re.test(ua)) return { kind: "preview", app };
  if (!ua || BOT.test(ua)) return { kind: "bot" };
  // Browsers mark a real page load as a navigation; scripts and scanners don't.
  if (request.headers.get("sec-fetch-mode") !== "navigate") return { kind: "bot" };
  return { kind: "human" };
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UPSERT = "INSERT INTO daily (day, site, metric, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, site, metric) DO UPDATE SET n = n + 1";

async function bump(db: D1, day: string, site: string, metrics: string[]) {
  if (metrics.length) await db.batch(metrics.map((m) => db.prepare(UPSERT).bind(day, site, m.slice(0, 80))));
}

function referrerHost(request: Request, own: string): string | null {
  try {
    const host = new URL(request.headers.get("referer") ?? "").hostname.replace(/^www\./, "");
    return host && host !== own ? host : null;
  } catch {
    return null;
  }
}

// Allowed values for ?source= so the metric names can't be filled with junk.
const SOURCES: Record<string, string> = { app: "app", shared: "share-menu", shortcut: "ios-shortcut" };

export async function recordPageview(env: AnalyticsEnv, request: Request, site: string) {
  if (!env.DB) return;
  try {
    const day = today(), visit = classify(request);
    if (visit.kind === "bot") return bump(env.DB, day, site, ["bot"]);
    if (visit.kind === "preview") return bump(env.DB, day, site, ["preview", `preview:${visit.app}`]);

    const url = new URL(request.url);
    const metrics = ["pageview"];
    const source = url.searchParams.get("source") ?? (url.searchParams.has("shared") ? "shared" : url.searchParams.get("from"));
    if (source && SOURCES[source]) metrics.push(`source:${SOURCES[source]}`);

    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const ua = request.headers.get("user-agent") ?? "";
    const id = await sha256(`${env.ANALYTICS_SALT ?? ""}|${day}|${site}|${ip}|${ua}`);
    const added = await env.DB.prepare("INSERT INTO visitors (day, site, id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(day, site, id).run();
    if (added.meta.changes > 0) {
      // Per-visitor breakdowns, so one person refreshing doesn't skew them.
      const cf = (request as Request & { cf?: { country?: string } }).cf;
      metrics.push("visitor", `device:${/mobi|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop"}`);
      if (cf?.country && /^[A-Z]{2}$/.test(cf.country)) metrics.push(`country:${cf.country}`);
      const ref = referrerHost(request, url.hostname);
      metrics.push(`ref:${ref ?? "direct"}`);
    }
    await bump(env.DB, day, site, metrics);
  } catch (e) {
    console.warn("analytics failed", e instanceof Error ? e.message : e);
  }
}

export async function recordEvent(env: AnalyticsEnv, site: string, name: string) {
  if (!env.DB) return;
  try {
    await bump(env.DB, today(), site, [`event:${name}`]);
  } catch (e) {
    console.warn("analytics failed", e instanceof Error ? e.message : e);
  }
}

export type Row = { day: string; site: string; metric: string; n: number };

export async function readRange(db: D1, days: number): Promise<Row[]> {
  const from = today(new Date(Date.now() - (days - 1) * 86_400_000));
  // Visitor hashes are only needed for today's de-duplication; keep a short tail.
  await db.prepare("DELETE FROM visitors WHERE day < ?").bind(today(new Date(Date.now() - 35 * 86_400_000))).run();
  const { results } = await db.prepare("SELECT day, site, metric, n FROM daily WHERE day >= ? ORDER BY day").bind(from).all<Row>();
  return results;
}
