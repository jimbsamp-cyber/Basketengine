# Basketball Projection Engine

Public, independent basketball analytics app for NBA and EuroLeague. This project is separate from Labprops and does not depend on Zite.

## Live app

https://jimbsamp-cyber.github.io/Basketengine/

## Automated data pipeline

- GitHub Actions sync runs every six hours and after relevant code changes.
- The pipeline stores a normalized dataset at `public/data/engine-data.json`; the public GitHub Pages frontend reads it automatically.
- NBA: ESPN public scoreboard and game-summary/box-score endpoints. Initial history backfill covers the latest 35 days; incremental sync revisits recent days and saves results.
- EuroLeague: public EuroLeague API endpoints. The initial backfill includes season codes E2024 (2024–25), E2025 (2025–26), and E2026 (2026–27 schedule/results). Recent E2026 player box scores are added incrementally to respect upstream rate limits.
- The browser refreshes the displayed dataset and current ESPN scoreboard feeds when opened; background ingestion does not require the browser to stay open.
- Data in the repository is public. Do not store credentials in the dataset or source files.

## Current model functionality

- Game schedule, live status and completed scores.
- Experimental score, total, spread and home-win probability estimates based on each team's previous games.
- Walk-forward Elo ratings blended with rolling form for win probability.
- Player points, rebounds, assists and minutes rolling averages from available box scores (up to the last 10 recorded games per player).
- Chronological backtest metrics: winner accuracy and absolute error for scores, margin and total.
- Value Scanner can calculate indicative expected value when current odds are available.

## Odds integration

The public ESPN scoreboard does not provide a dependable market-odds feed. Optional The Odds API integration is implemented for moneyline, spreads and totals when a repository secret named `ODDS_API_KEY` is configured.

To configure it:
1. Obtain an API key from [The Odds API](https://the-odds-api.com/).
2. Open this repository's **Settings → Secrets and variables → Actions**.
3. Select **New repository secret**, set the name to `ODDS_API_KEY`, and paste the key as its value.
4. The next scheduled sync will attempt to retrieve available markets.

Player-prop market access depends on the provider's sport coverage and subscription. The app will not invent odds if a market is unavailable. Never paste the key into chat, source code, or a public file.

## Build locally

```bash
npm install
npm run dev
npm run build
```

## Hosting

GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml` after code changes and dataset updates. The data-sync workflow is `.github/workflows/sync-data.yml`.

## Important model limitations

- Current projections are an experimental baseline, not a validated betting model.
- Player tables are recent statistical averages, not injury-aware, matchup-adjusted or calibrated prop probabilities.
- Backtest results are chronological and use only earlier games for each test prediction, but the available NBA historical window is currently much shorter than the EuroLeague history.
- No ROI or profit claim is made because a full historical odds archive, closing lines, vig removal, and out-of-sample calibration are not yet in place.
- The EuroLeague endpoint is a public but undocumented/unofficial interface and may change or rate-limit requests.
- Do not treat model outputs as guaranteed or as financial advice.

## Roadmap

1. Expand and validate historical player-game coverage, especially EuroLeague.
2. Add an odds archive and provider-backed player-prop lines where available.
3. Improve the model with rest, pace, availability and matchup features.
4. Run longer walk-forward validation, probability calibration and odds-aware ROI testing before describing any strategy as profitable.
