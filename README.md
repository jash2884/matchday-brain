# Matchday Brain

[Live](https://matchday.jashparmar.com) · [API](https://matchday.jashparmar.com/api/v1)

Multi-sport match predictions that show their homework. Tuned Elo models forecast **football** (Premier League, La Liga, Serie A, Bundesliga, Ligue 1), **cricket** (IPL, men's and women's T20Is, ODIs, Tests) and the **NFL**, explain every call in plain English, and publish an honest track record.

## Honest by design
- **Walk-forward:** every forecast uses only results from before the match.
- **Tuning kept apart from testing:** each sport's settings are grid-searched (minimum log loss) on an earlier window; the track record is scored only on later seasons the model never saw while being tuned.
- **Baselines and calibration:** compared against "always pick the home side" and historical average odds, with a calibration chart.

| Sport | Competition | Correct picks (unseen seasons) | Log loss (model vs baseline) |
|---|---|---|---|
| NFL | NFL | 64% | 0.637 vs 0.690 |
| Cricket | Women's T20I | 72% | |
| Cricket | Men's T20I | 70% | |
| Cricket | ODI / Tests | 60% / 59% | |
| Cricket | IPL | 50% (the IPL is famously unpredictable) | |
| Football | 5 leagues | 50–57% (three outcomes) | |

## Architecture
```
GitHub Actions (every 6h) ──> adapters fetch open data ──> walk-forward Elo engine ──> JSON snapshots
                                                                                         │
Browser <── Cloudflare CDN (static app + snapshots) <── Worker: /api/v1 (catalog, competition, predict)
```
- **Compute once, serve from the edge:** ingestion runs in CI, not per request, so page loads are static files and the API does only cheap lookups.
- **Sport adapters** (`src/sports/*`) normalise each source into one `Match` type; the **generic engine** (`src/core/elo.ts`) handles sports with and without draws, home advantage, margin-of-victory and between-season regression.
- **Fault isolation:** one competition failing keeps the others (and its own last good snapshot) online.
- **No runtime dependencies:** TypeScript on Node 24's built-in type stripping; cricket zips are read in memory with `node:zlib`.

## Public API
```
GET /api/v1/catalog
GET /api/v1/{sport}/{competition}                 e.g. /api/v1/nfl/nfl
GET /api/v1/{sport}/{competition}/predict?home=…&away=…[&neutral=1]
```

## Adding a sport
Write an adapter implementing `SportAdapter` (id, competitions, `load()` returning `Match[]`, a tuning split), register it in `src/sports/index.ts`, run `node scripts/fit.ts <group>` to tune it, and add the result to `src/sports/tuned.ts`. Tennis and NBA are planned once suitable data sources are connected.

## Develop
```sh
npm test                 # unit tests (Node >= 23.6, nothing to install)
node scripts/ingest.ts   # build snapshots into public/data
npx wrangler@4 dev       # local Worker
node scripts/fit.ts nfl  # re-tune a sport group
```

Data: [openfootball](https://github.com/openfootball/football.json) (CC0), [Cricsheet](https://cricsheet.org) (ODC Attribution), [nflverse](https://github.com/nflverse/nfldata) (CC BY 4.0). For analysis and fun, not betting advice.
