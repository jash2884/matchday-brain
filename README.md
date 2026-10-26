# Matchday Brain

[Live demo](https://matchday.jashparmar.com)

Football predictions that show their homework. An Elo rating model predicts every match in Europe's top five leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1), explains each call in plain English, and publishes how often it is right.

## What makes it honest
- **Walk-forward predictions:** every prediction uses only matches played before it, exactly as if made on match day.
- **Tuning kept separate from testing:** settings were tuned (grid search, minimum log loss) on 2024-25 only; accuracy is reported on 2025-26 onward, which the model never saw while being tuned.
- **Baselines:** compared against "always pick the home team" (accuracy) and league-average odds (Brier score, log loss).
- **Calibration chart:** forecast probability vs how often it happened.

| League | Accuracy | Always home | Brier (model vs base) |
|---|---|---|---|
| Premier League | 51.5% | 45.2% | 0.606 vs 0.643 |
| La Liga | 51.7% | 50.6% | 0.579 vs 0.625 |
| Serie A | 57.1% | 43.1% | 0.562 vs 0.651 |
| Bundesliga | 56.9% | 46.8% | 0.563 vs 0.642 |
| Ligue 1 | 54.8% | 49.2% | 0.584 vs 0.620 |

## Model
Elo ratings with home advantage, a margin-of-victory multiplier, regression toward the mean between seasons and a lower starting rating for promoted teams. The expected score is split into home/draw/away with a draw probability that peaks when teams are level. See `src/model.ts`; tuned parameters live in `src/params.ts`.

## Stack
A single Cloudflare Worker (TypeScript, no framework, no npm dependencies) serves a vanilla HTML/CSS/JS frontend and a JSON API. Data comes from [openfootball](https://github.com/openfootball/football.json) (CC0, community-maintained) and is cached at the edge for 3 hours. Results in that dataset can lag real life; the app shows the date of the latest recorded result.

## Run it
```sh
npm test            # model unit tests (Node >= 23.6, no install needed)
npm run fit         # re-tune parameters on the tuning season
npm run evaluate    # score the model on unseen seasons
npm run dev         # local Worker via Wrangler
npm run deploy      # deploy to Cloudflare
```

For fun and learning, not betting advice.
