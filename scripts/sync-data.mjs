import fs from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const DATA_FILE = new URL("../public/data/engine-data.json", import.meta.url);
const LEAGUES = [
  { key: "NBA", name: "NBA", sport: "nba", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { key: "EuroLeague", name: "EuroLeague", sport: "euroleague", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/euroleague/scoreboard" }
];
const now = new Date();
const fullBackfill = process.env.FULL_BACKFILL === "true";
const isoDay = d => d.toISOString().slice(0, 10);
const dayParam = d => isoDay(d).replaceAll("-", "");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = async url => {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "BasketballProjectionEngine/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
};
const toGame = (event, league) => {
  const comp = event.competitions?.[0];
  const competitors = comp?.competitors || [];
  const home = competitors.find(t => t.homeAway === "home") || competitors[0];
  const away = competitors.find(t => t.homeAway === "away") || competitors[1];
  if (!home?.team || !away?.team) return null;
  const state = event.status?.type?.state;
  return {
    id: league.key + "-" + event.id,
    eventId: String(event.id),
    league: league.name,
    date: event.date,
    home: home.team.displayName || home.team.name,
    away: away.team.displayName || away.team.name,
    homeId: String(home.team.id || ""),
    awayId: String(away.team.id || ""),
    homeScore: Number.isFinite(Number(home.score)) ? Number(home.score) : null,
    awayScore: Number.isFinite(Number(away.score)) ? Number(away.score) : null,
    status: state === "post" ? "Završena" : state === "in" ? "Uživo" : "Zakazana",
    statusCode: state || "pre",
    venue: comp?.venue?.fullName || "",
    homeWinner: home.winner === true,
    source: "ESPN public scoreboard"
  };
};
async function fetchDay(league, date) {
  try {
    const json = await getJson(league.url + "?dates=" + dayParam(date));
    return (json.events || []).map(e => toGame(e, league)).filter(Boolean);
  } catch (e) {
    console.warn(`Feed warning [${league.name} ${isoDay(date)}]: ${e.message}`);
    return [];
  }
}
async function fetchRange(league, start, end) {
  const range = dayParam(start) + "-" + dayParam(end);
  try {
    const json = await getJson(league.url + "?dates=" + range);
    return (json.events || []).map(e => toGame(e, league)).filter(Boolean);
  } catch (e) {
    console.warn(`Range warning [${league.name} ${range}]: ${e.message}`);
    return [];
  }
}
function parsePlayerStats(summary, game) {
  const output = [];
  for (const group of summary.boxscore?.players || []) {
    const teamName = group.team?.displayName || group.team?.name || "";
    for (const statGroup of group.statistics || []) {
      const labels = statGroup.labels || statGroup.names || [];
      for (const row of statGroup.athletes || []) {
        const values = row.stats || [];
        const stat = {};
        labels.forEach((label, i) => { stat[String(label).toUpperCase()] = values[i]; });
        const athlete = row.athlete || {};
        const number = value => {
          const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
          return Number.isFinite(n) ? n : null;
        };
        const minutes = number(stat.MIN);
        const points = number(stat.PTS);
        const rebounds = number(stat.REB);
        const assists = number(stat.AST);
        if (points === null && rebounds === null && assists === null) continue;
        output.push({
          id: String(athlete.id || athlete.uid || athlete.displayName || ""),
          name: athlete.displayName || athlete.fullName || "Nepoznat igrač",
          team: teamName,
          league: game.league,
          gameId: game.id,
          date: game.date,
          opponent: teamName === game.home ? game.away : game.home,
          minutes, points, rebounds, assists,
          steals: number(stat.STL), blocks: number(stat.BLK), turnovers: number(stat.TO),
          threes: number(stat["3PM"] ?? stat["3PT"]),
          source: "ESPN box score"
        });
      }
    }
  }
  return output;
}
let old = { schemaVersion: 1, games: [], playerGames: [], sources: {}, lastUpdated: null, historyWindow: "Nema podataka" };
try { old = { ...old, ...JSON.parse(await fs.readFile(DATA_FILE, "utf8")) }; } catch {}
const gameMap = new Map((old.games || []).map(g => [g.id, g]));
const errors = [];
const daysToFetch = fullBackfill ? 35 : 8;
for (const league of LEAGUES) {
  if (fullBackfill && league.key === "EuroLeague") {
    // Weekly windows keep requests manageable while covering the 2024-25 and 2025-26 seasons.
    const start = new Date("2024-09-01T12:00:00Z");
    const endLimit = new Date("2026-07-01T12:00:00Z");
    for (let cursor = new Date(start); cursor < endLimit; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
      const end = new Date(cursor); end.setUTCDate(end.getUTCDate() + 6);
      for (const g of await fetchRange(league, cursor, end > endLimit ? endLimit : end)) gameMap.set(g.id, g);
      await wait(180);
    }
    for (const g of await fetchDay(league, now)) gameMap.set(g.id, g);
  } else {
    for (let i = daysToFetch - 1; i >= 0; i--) {
      const date = new Date(now); date.setUTCDate(date.getUTCDate() - i);
      for (const g of await fetchDay(league, date)) gameMap.set(g.id, g);
      await wait(100);
    }
  }
}
const games = [...gameMap.values()].sort((a,b) => new Date(a.date) - new Date(b.date));
const finalGames = games.filter(g => g.status === "Završena" && g.homeScore !== null && g.awayScore !== null);
const existingPlayerGames = new Map((old.playerGames || []).map(p => [p.gameId + "|" + p.id, p]));
const summariesToFetch = (fullBackfill ? finalGames.slice(-90) : finalGames.slice(-24)).filter(g => !g.playerStatsFetched || fullBackfill);
let summariesSucceeded = 0;
for (const game of summariesToFetch) {
  const league = LEAGUES.find(l => l.name === game.league);
  try {
    const summary = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${league.sport}/summary?event=${game.eventId}`);
    const rows = parsePlayerStats(summary, game);
    if (rows.length) {
      for (const row of rows) existingPlayerGames.set(row.gameId + "|" + row.id, row);
      game.playerStatsFetched = true;
      summariesSucceeded++;
    }
  } catch (e) {
    console.warn(`Box score warning [${game.id}]: ${e.message}`);
  }
  await wait(160);
}
const updatedGames = games.map(g => gameMap.get(g.id));
const playerGames = [...existingPlayerGames.values()].sort((a,b) => new Date(a.date)-new Date(b.date));
// Retain all game results and the most recent 12,000 player-game lines to keep the static payload small.
const trimmedPlayers = playerGames.slice(-12000);
const result = {
  schemaVersion: 1,
  lastUpdated: now.toISOString(),
  historyWindow: fullBackfill ? "Istorijski backfill pokrenut: NBA 35 dana; EuroLeague 2024–2026" : "Automatsko ažuriranje: poslednjih 8 dana + sačuvana istorija",
  games: updatedGames,
  playerGames: trimmedPlayers,
  sources: {
    NBA: { provider: "ESPN public scoreboard/box score", checkedAt: now.toISOString(), games: updatedGames.filter(g => g.league === "NBA").length },
    EuroLeague: { provider: "ESPN public scoreboard/box score", checkedAt: now.toISOString(), games: updatedGames.filter(g => g.league === "EuroLeague").length }
  },
  sync: { mode: fullBackfill ? "full-backfill" : "incremental", summariesAttempted: summariesToFetch.length, summariesSucceeded, warnings: errors }
};
await fs.mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await fs.writeFile(DATA_FILE, JSON.stringify(result));
console.log(`Saved ${updatedGames.length} games and ${trimmedPlayers.length} player-game lines; box scores ${summariesSucceeded}/${summariesToFetch.length}; fullBackfill=${fullBackfill}`);
