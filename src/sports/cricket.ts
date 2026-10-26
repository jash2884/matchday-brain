import type { Match } from "../core/types.ts";
import { fetchOk, type SportAdapter } from "./adapter.ts";
import { zipEntries } from "./unzip.ts";
import { TUNED } from "./tuned.ts";

const BASE = "https://cricsheet.org/downloads";
const FIRST_YEAR = 2014;

type Info = {
  dates: string[];
  teams: [string, string];
  gender: "male" | "female";
  team_type?: "international" | "club";
  match_type: string;
  event?: { name?: string; match_number?: number; stage?: string };
  outcome?: { winner?: string; result?: string; by?: { runs?: number; wickets?: number; innings?: number }; eliminator?: string };
};

// Franchise renames: map historical names onto the current one so ratings carry over.
const ALIASES: Record<string, string> = {
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Rising Pune Supergiants": "Rising Pune Supergiant",
};
const canon = (t: string) => ALIASES[t] ?? t;

const COMPETITIONS = {
  ipl: { file: "ipl_json.zip", filter: (i: Info) => i.gender === "male" },
  "t20i-men": { file: "t20s_json.zip", filter: (i: Info) => i.gender === "male" && i.team_type !== "club" },
  "t20i-women": { file: "t20s_json.zip", filter: (i: Info) => i.gender === "female" && i.team_type !== "club" },
  "odi-men": { file: "odis_json.zip", filter: (i: Info) => i.gender === "male" },
  "test-men": { file: "tests_json.zip", filter: (i: Info) => i.gender === "male" },
} as const;

// Cricsheet files are pretty-printed with keys in the order meta, info, innings.
// Parsing only the head avoids decoding megabytes of ball-by-ball data per match.
export function readInfo(text: string): Info | null {
  const cut = text.indexOf('"innings"');
  const head = cut > 0 ? text.slice(0, cut).replace(/,\s*$/, "") + "}" : text;
  try {
    return (JSON.parse(head) as { info: Info }).info;
  } catch {
    try { return (JSON.parse(text) as { info: Info }).info; } catch { return null; }
  }
}

function describe(o: NonNullable<Info["outcome"]>): string | undefined {
  if (o.by?.runs) return `won by ${o.by.runs} run${o.by.runs > 1 ? "s" : ""}`;
  if (o.by?.wickets) return `won by ${o.by.wickets} wicket${o.by.wickets > 1 ? "s" : ""}`;
  if (o.by?.innings) return "won by an innings";
  if (o.eliminator) return `${o.eliminator} won the tie-breaker`;
  return o.result;
}

const zipCache = new Map<string, Promise<Buffer>>();
function download(file: string) {
  if (!zipCache.has(file)) {
    zipCache.set(file, fetchOk(`${BASE}/${file}`).then(async (r) => {
      if (!r.ok) throw new Error(`Cricsheet ${file} returned ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }));
  }
  return zipCache.get(file)!;
}

export const cricket: SportAdapter = {
  id: "cricket",
  name: "Cricket",
  hasDraws: (comp) => comp === "test-men",
  hasHomeAdvantage: false,
  source: { name: "Cricsheet", url: "https://cricsheet.org", licence: "Open Data Commons Attribution" },
  competitions: [
    { id: "ipl", name: "Indian Premier League", short: "IPL", region: "India" },
    { id: "t20i-men", name: "Men's T20 Internationals", short: "T20I", region: "International" },
    { id: "t20i-women", name: "Women's T20 Internationals", short: "W T20I", region: "International" },
    { id: "odi-men", name: "Men's ODIs", short: "ODI", region: "International" },
    { id: "test-men", name: "Men's Tests", short: "Tests", region: "International" },
  ],
  split: { warmupBefore: "2019", tuneFrom: "2019", tuneTo: "2022" },
  params: (comp) => (comp === "test-men" ? TUNED.cricketTests : TUNED.cricket),
  async load(comp) {
    const def = COMPETITIONS[comp as keyof typeof COMPETITIONS];
    if (!def) throw new Error(`Unknown cricket competition ${comp}`);
    const zip = await download(def.file);
    const out: Match[] = [];
    for (const entry of zipEntries(zip)) {
      if (!entry.name.endsWith(".json")) continue;
      const info = readInfo(entry.data().toString("utf8"));
      if (!info || !def.filter(info) || !info.dates?.length || info.teams?.length !== 2) continue;
      const date = info.dates[0];
      if (Number(date.slice(0, 4)) < FIRST_YEAR) continue;
      const o = info.outcome ?? {};
      const [a, b] = info.teams.map(canon) as [string, string];
      // No result / abandoned matches carry no information about strength.
      if (!o.winner && o.result !== "draw" && o.result !== "tie") continue;
      const winner = o.winner || o.eliminator ? canon((o.winner ?? o.eliminator)!) : undefined;
      const outcome = winner === a ? "H" : winner === b ? "A" : o.result === "draw" || o.result === "tie" ? "D" : undefined;
      if (!outcome) continue;
      out.push({
        id: `${comp}-${entry.name.replace(".json", "")}`, season: date.slice(0, 4), date, home: a, away: b,
        neutral: true, outcome, label: info.event?.name, detail: winner ? `${winner} ${describe(o) ?? "won"}` : describe(o),
      });
    }
    return out;
  },
};
