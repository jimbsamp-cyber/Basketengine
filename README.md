# Basketball Projection Engine

Independent React + Vite application for NBA and EuroLeague. This repository is not dependent on Zite.

## Current version
- Responsive dashboard in Serbian.
- Attempts to fetch current scoreboard events from public ESPN endpoints.
- Manual refresh button and five-minute refresh while the page is open.
- Shows source status and does not fabricate player projections, odds, EV or backtest results.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Cloudflare Pages
Create a Pages project connected to this GitHub repository:
- Build command: `npm run build`
- Build output directory: `dist`

## Known limitations
- Public scoreboard endpoints can change, be unavailable, or omit EuroLeague events.
- The five-minute refresh currently runs in the open browser only; it is not a background scheduler.
- Historical data ingestion, database persistence, odds provider, player availability, projections, calibration, EV and backtesting are not implemented yet.
- Do not use any projection for wagering until it is backed by reproducible historical validation.

## Roadmap
1. Verify league feeds and store normalized game records.
2. Add a backend, persistent database and scheduled sync.
3. Ingest historical team and player statistics.
4. Build leakage-safe models and walk-forward backtests.
5. Add odds comparison and EV only after probability calibration.
