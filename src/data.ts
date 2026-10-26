import type { RawMatch } from "./model.ts";

export const LEAGUES = {
  "en.1": { name: "Premier League", country: "England" },
  "es.1": { name: "La Liga", country: "Spain" },
  "it.1": { name: "Serie A", country: "Italy" },
  "de.1": { name: "Bundesliga", country: "Germany" },
  "fr.1": { name: "Ligue 1", country: "France" },
} as const;
export type LeagueCode = keyof typeof LEAGUES;

// Oldest first. The first season only warms up ratings; 2024-25 tunes the
// model; later seasons are the honest, unseen test set.
export const SEASONS = ["2023-24", "2024-25", "2025-26", "2026-27"];
export const WARMUP_SEASON = "2023-24";
export const TUNING_SEASON = "2024-25";

const SOURCE = "https://raw.githubusercontent.com/openfootball/football.json/master";

export async function loadLeague(code: LeagueCode, fetcher: typeof fetch = fetch) {
  const seasons: { season: string; matches: RawMatch[] }[] = [];
  for (const season of SEASONS) {
    const res = await fetcher(`${SOURCE}/${season}/${code}.json`);
    if (!res.ok) continue;
    const data = (await res.json()) as { matches?: RawMatch[] };
    if (data.matches?.length) seasons.push({ season, matches: data.matches });
  }
  return seasons;
}
