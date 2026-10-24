import fs from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const DATA_FILE = new URL("../public/data/engine-data.json", import.meta.url);
const LEAGUES = [
  { key: "NBA", name: "NBA", sport: "nba", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { key: "EuroLeague", name: "EuroLeague", sport: "euroleague", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/euroleague/scoreboard" }
];
const now = new Date();
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
function toEuroGame(g, seasonCode) {
  const pick = (...values) => values.find(v => v !== undefined && v !== null && v !== "");
  const code = String(pick(g.gameCode, g.game_code, g.code, (g.identifier || "").split("_").pop(), g.id) || "");
  const home = pick(g.localClubName, g.local_club_name, g.local?.club?.name, g.local?.team?.name, g.local?.name);
  const away = pick(g.roadClubName, g.road_club_name, g.road?.club?.name, g.road?.team?.name, g.road?.name);
  if (!home || !away) return null;
  const date = pick(g.utcDate, g.utc_date, g.date, g.localDate, g.local_date);
  const hs = pick(g.localScore, g.local_score, g.local?.score, g.local?.points);
  const as = pick(g.roadScore, g.road_score, g.road?.score, g.road?.points);
  const statusRaw = String(pick(g.gameStatus, g.game_status, g.status, "")).toLowerCase();
  const played = g.played === true || statusRaw === "result" || statusRaw === "finished" || (hs != null && as != null && statusRaw !== "scheduled");
  const status = played ? "Završena" : statusRaw === "live" ? "Uživo" : "Zakazana";
  return {
    id: "EuroLeague-" + seasonCode + "-" + code,
    eventId: seasonCode + "_" + code,
    gameCode: code,
    seasonCode,
    league: "EuroLeague",
    date,
    home: String(home),
    away: String(away),
    homeId: String(pick(g.localClubCode, g.local_club_code, g.local?.club?.code, "") || ""),
    awayId: String(pick(g.roadClubCode, g.road_club_code, g.road?.club?.code, "") || ""),
    homeScore: played && hs != null ? Number(hs) : null,
    awayScore: played && as != null ? Number(as) : null,
    status,
    statusCode: played ? "post" : status === "Uživo" ? "in" : "pre",
    venue: g.venueName || g.venue_name || "",
    homeWinner: played && Number(hs) > Number(as),
    source: "Official EuroLeague public API",
    playerStatsFetched: false
  };
}
async function fetchEuroLeagueSeason(seasonCode) {
  try {
    const url = "https://api-live.euroleague.net/v2/competitions/E/seasons/" + seasonCode + "/games?limit=1000&offset=0";
    const json = await getJson(url);
    const rows = Array.isArray(json) ? json : (json.data || json.games || []);
    const games = rows.map(g => toEuroGame(g, seasonCode)).filter(Boolean);
    console.log("EuroLeague " + seasonCode + ": " + games.length + " games");
    return games;
  } catch (e) {
    console.warn("EuroLeague official API warning [" + seasonCode + "]: " + e.message);
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
const fullBackfill = process.env.FULL_BACKFILL === "true" || !(old.games || []).length;
const gameMap = new Map((old.games || []).map(g => [g.id, g]));
const errors = [];
const daysToFetch = fullBackfill ? 35 : 8;
for (const league of LEAGUES) {
  if (league.key === "EuroLeague") {
    const seasons = fullBackfill ? ["E2024", "E2025", "E2026"] : ["E2026"];
    for (const seasonCode of seasons) {
      const rows = await fetchEuroLeagueSeason(seasonCode);
      for (const g of rows) gameMap.set(g.id, g);
      await wait(6500);
    }
    continue;
  }
  for (let i = daysToFetch - 1; i >= 0; i--) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - i);
    for (const g of await fetchDay(league, date)) gameMap.set(g.id, g);
    await wait(100);
  }
}

