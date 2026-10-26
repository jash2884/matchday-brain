import type { EloParams, Match } from "../core/types.ts";

export type CompetitionDef = { id: string; name: string; short: string; region?: string };

// Seasons are compared as strings, so they must sort chronologically
// ("2023-24" < "2024-25", "2021" < "2022").
export type Split = {
  warmupBefore: string; // seasons before this only warm up ratings
  tuneFrom: string;     // inclusive
  tuneTo: string;       // inclusive; everything after is the unseen test set
};

export type SportAdapter = {
  id: string;
  name: string;
  hasDraws: boolean | ((competitionId: string) => boolean);
  hasHomeAdvantage: boolean;
  source: { name: string; url: string; licence: string };
  competitions: CompetitionDef[];
  split: Split;
  params: (competitionId: string) => EloParams;
  load: (competitionId: string) => Promise<Match[]>;
};

export const drawsFor = (a: SportAdapter, comp: string) => (typeof a.hasDraws === "function" ? a.hasDraws(comp) : a.hasDraws);

export async function fetchOk(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "matchday-brain (github.com/jash2884/matchday-brain)" } });
      if (res.ok || res.status === 404 || attempt >= 3) return res;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}
