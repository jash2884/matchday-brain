import type { Match } from "../core/types.ts";
import { fetchOk, type SportAdapter } from "./adapter.ts";
import { TUNED } from "./tuned.ts";

const URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const FIRST_SEASON = 2015;

// Minimal CSV parser (the nflverse file has no quoted commas in the columns we use,
// but this handles quotes correctly anyway).
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const TEAM_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers",
  CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos",
  DET: "Detroit Lions", GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LA: "Los Angeles Rams", LAC: "Los Angeles Chargers", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants", NYJ: "New York Jets",
  PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks", SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders", OAK: "Las Vegas Raiders", SD: "Los Angeles Chargers", STL: "Los Angeles Rams",
};
const name = (abbr: string) => TEAM_NAMES[abbr] ?? abbr;

export const nfl: SportAdapter = {
  id: "nfl",
  name: "NFL",
  hasDraws: false,
  hasHomeAdvantage: true,
  source: { name: "nflverse", url: "https://github.com/nflverse/nfldata", licence: "CC BY 4.0" },
  competitions: [{ id: "nfl", name: "NFL", short: "NFL", region: "USA" }],
  split: { warmupBefore: "2020", tuneFrom: "2020", tuneTo: "2022" },
  params: () => TUNED.nfl,
  async load() {
    const res = await fetchOk(URL);
    if (!res.ok) throw new Error(`nflverse returned ${res.status}`);
    const rows = parseCsv(await res.text());
    return rows
      .filter((r) => Number(r.season) >= FIRST_SEASON)
      .map((r): Match => {
        const played = r.home_score !== "" && r.away_score !== "" && r.home_score !== "NA";
        const score: [number, number] | undefined = played ? [Number(r.home_score), Number(r.away_score)] : undefined;
        const week = r.game_type === "REG" ? `Week ${r.week}` : ({ WC: "Wild Card", DIV: "Divisional", CON: "Conference", SB: "Super Bowl" } as Record<string, string>)[r.game_type] ?? r.game_type;
        return {
          id: r.game_id, season: r.season, date: r.gameday, home: name(r.home_team), away: name(r.away_team),
          neutral: r.location === "Neutral", label: week, score,
          // Rare NFL ties count as a half-win for Elo; displayed as a draw.
          outcome: score ? (score[0] > score[1] ? "H" : score[0] < score[1] ? "A" : "D") : undefined,
        };
      });
  },
};
