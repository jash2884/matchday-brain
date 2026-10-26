// Sport-agnostic types shared by every adapter, the rating engine and the API.

export type Outcome = "H" | "D" | "A";
export type Probs = { home: number; draw: number; away: number };

// One fixture or result, normalised from any data source.
export type Match = {
  id: string;
  season: string;      // grouping used for between-season rating regression
  date: string;        // YYYY-MM-DD
  home: string;        // first-listed side; "home" only matters when neutral is false
  away: string;
  neutral?: boolean;   // no home advantage (cricket, finals, neutral venues)
  score?: [number, number];
  outcome?: Outcome;   // set when a result exists (overrides score for sports like cricket)
  label?: string;      // round, week or event name for display
  detail?: string;     // e.g. "won by 7 wickets"
};

export type DrawModel = { d0: number; d1: number } | null;

export type EloParams = {
  k: number;
  home: number;          // home advantage in Elo points
  draws: DrawModel;      // null for sports where draws are effectively impossible
  regress: number;       // share pulled back toward 1500 at each new season
  newcomer: number;      // starting offset for teams first seen after the first season
  mov: "goals" | "points" | "none"; // margin-of-victory scaling
  scale?: number;        // Elo divisor for probabilities (default 400); larger = less confident
};

export type Prediction = {
  id: string;
  season: string;
  date: string;
  label?: string;
  home: string;
  away: string;
  neutral?: boolean;
  ratingHome: number;
  ratingAway: number;
  probs: Probs;
  pick: Outcome;
  formHome: string;
  formAway: string;
  score?: [number, number];
  outcome?: Outcome;
  detail?: string;
};

export type Metrics = { matches: number; accuracy: number; brier: number; logLoss: number };

export type CalibrationBin = { lo: number; hi: number; n: number; forecast: number; observed: number };

// What the ingestion job writes for each competition, and what the API serves.
export type CompetitionSnapshot = {
  sport: string;
  competition: { id: string; name: string; short: string; region?: string };
  generatedAt: string;
  updatedThrough: string;
  missingResults: number;
  hasDraws: boolean;
  hasHomeAdvantage: boolean;
  nextUp: (Prediction & { why: string })[];
  table: { team: string; rating: number; change: number; played: number }[];
  evaluation: {
    window: string;
    metrics: { model: Metrics; baseRates: Metrics; alwaysHome: Metrics | null };
    calibration: CalibrationBin[];
    recent: Prediction[];
  };
  params: EloParams;
  source: { name: string; url: string; licence: string };
};
