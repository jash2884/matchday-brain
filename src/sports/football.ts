import type { Match } from "../core/types.ts";
import { fetchOk, type SportAdapter } from "./adapter.ts";
import { TUNED } from "./tuned.ts";

const SOURCE = "https://raw.githubusercontent.com/openfootball/football.json/master";
const SEASONS = ["2023-24", "2024-25", "2025-26", "2026-27"];

type Raw = { round?: string; date: string; time?: string; team1: string; team2: string; score?: { ft?: [number, number] } };

export const football: SportAdapter = {
  id: "football",
  name: "Football",
  hasDraws: true,
  hasHomeAdvantage: true,
  source: { name: "openfootball", url: "https://github.com/openfootball/football.json", licence: "CC0 1.0" },
  competitions: [
    { id: "en.1", name: "Premier League", short: "EPL", region: "England" },
    { id: "es.1", name: "La Liga", short: "LaLiga", region: "Spain" },
    { id: "it.1", name: "Serie A", short: "Serie A", region: "Italy" },
    { id: "de.1", name: "Bundesliga", short: "Bundesliga", region: "Germany" },
    { id: "fr.1", name: "Ligue 1", short: "Ligue 1", region: "France" },
  ],
  split: { warmupBefore: "2024-25", tuneFrom: "2024-25", tuneTo: "2024-25" },
  params: () => TUNED.football,
  async load(comp) {
    const out: Match[] = [];
    for (const season of SEASONS) {
      const res = await fetchOk(`${SOURCE}/${season}/${comp}.json`);
      if (!res.ok) continue;
      const data = (await res.json()) as { matches?: Raw[] };
      for (const [i, m] of (data.matches ?? []).entries()) {
        const ft = m.score?.ft;
        out.push({
          id: `${comp}-${season}-${i}`, season, date: m.date, home: m.team1, away: m.team2,
          label: m.round, score: Array.isArray(ft) && ft.length === 2 ? [ft[0], ft[1]] : undefined,
        });
      }
    }
    return out;
  },
};
