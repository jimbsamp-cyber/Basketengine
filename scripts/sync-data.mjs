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
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "BasketballProjectionEngine/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.replace(/apiKey=[^&]+/, "apiKey=REDACTED")}`);
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
    homeScore: home.score == null || home.score === "" ? null : (Number.isFinite(Number(home.score)) ? Number(home.score) : null),
    awayScore: away.score == null || away.score === "" ? null : (Number.isFinite(Number(away.score)) ? Number(away.score) : null),
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
  const played = g.played === true || ["result", "finished", "final", "played"].includes(statusRaw) || (!!date && new Date(date) < now && hs != null && as != null && Number(hs) + Number(as) > 0 && statusRaw !== "scheduled");
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
    source: "EuroLeague public API",
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
      for (const g of rows) {
        const previous = gameMap.get(g.id);
        gameMap.set(g.id, previous ? { ...g, playerStatsFetched: previous.playerStatsFetched === true } : g);
      }
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

const games = [...gameMap.values()].sort((a,b) => new Date(a.date) - new Date(b.date));
const finalGames = games.filter(g => g.status === "Završena" && g.homeScore !== null && g.awayScore !== null);
const existingPlayerGames = new Map((old.playerGames || []).map(p => [p.gameId + "|" + p.id, p]));
const nbaFinals = finalGames.filter(g => g.league === "NBA");
const summariesToFetch = (fullBackfill ? nbaFinals.slice(-90) : nbaFinals.slice(-24)).filter(g => !g.playerStatsFetched || fullBackfill);
let summariesSucceeded = 0;
for (const game of summariesToFetch) {
  const league = LEAGUES.find(l => l.name === game.league);
  try {
    const summary = await getJson("https://site.api.espn.com/apis/site/v2/sports/basketball/" + league.sport + "/summary?event=" + encodeURIComponent(game.eventId));
    const rows = parsePlayerStats(summary, game);
    if (rows.length) {
      for (const row of rows) existingPlayerGames.set(row.gameId + "|" + row.id, row);
      game.playerStatsFetched = true;
      summariesSucceeded++;
    }
  } catch (e) { console.warn("NBA box score warning [" + game.id + "]: " + e.message); }
  await wait(160);
}
// EuroLeague box scores come from its official public API. Throttle requests to avoid upstream rate limits.
const euroFinals = games.filter(g => g.league === "EuroLeague" && g.seasonCode === "E2026" && g.status === "Završena" && g.homeScore !== null && g.awayScore !== null);
const missingEuroFinals = euroFinals.filter(g => !g.playerStatsFetched);
const euroToFetch = fullBackfill ? missingEuroFinals.slice(-15) : missingEuroFinals.slice(-2);
let euroStatsFetched = 0;
for (const game of euroToFetch) {
  try {
    const summary = await getJson("https://api-live.euroleague.net/v2/competitions/E/seasons/" + game.seasonCode + "/games/" + game.gameCode + "/stats");
    const playerRows = [];
    const root = summary.data || summary;
    for (const side of ["local", "road"]) {
      const sideData = root[side] || {};
      const teamName = sideData.club?.name || sideData.team?.name || sideData.name || (side === "local" ? game.home : game.away);
      for (const p of sideData.players || []) {
        const player = p.player || {};
        const person = player.person || p.person || {};
        const club = player.club || p.club || {};
        const stats = p.stats || p.statistics || p;
        const read = (...keys) => {
          for (const key of keys) {
            const v = stats[key] ?? stats[key.toLowerCase()];
            if (v !== undefined && v !== null && v !== "") return v;
          }
          return null;
        };
        const number = v => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
        const name = person.name || player.name || p.name || p.playerName || p.player_name || "Nepoznat igrač";
        const id = person.code || person.id || player.code || player.id || p.playerCode || p.player_code || name;
        const points = number(read("points", "PTS"));
        const rebounds = number(read("totalRebounds", "total_rebounds", "rebounds", "REB", "TREB"));
        const assists = number(read("assistances", "assists", "AST"));
        if (points === null && rebounds === null && assists === null) continue;
        const minutesRaw = number(read("timePlayed", "minutes", "MIN"));
        const minutes = minutesRaw === null ? null : (minutesRaw > 100 ? minutesRaw / 60 : minutesRaw);
        const team = club.name || teamName;
        playerRows.push({id:String(id).trim(),name:String(name).trim(),team:String(team).trim(),league:"EuroLeague",gameId:game.id,date:game.date,opponent:team===game.home?game.away:game.home,minutes,points,rebounds,assists,steals:number(read("steals","STL")),blocks:number(read("blocksFavour","blocks_favour","blocks","BLK")),turnovers:number(read("turnovers","TO")),threes:number(read("fieldGoalsMade3","field_goals_made3","3PM")),source:"Official EuroLeague box score"});
      }
    }
    if (!playerRows.length) console.warn("EuroLeague stats empty [" + game.id + "]: root=" + Object.keys(root).join(",") + "; local=" + Object.keys(root.local || {}).join(",") + "; players=" + ((root.local?.players || []).length));
    if (playerRows.length) {
      for (const row of playerRows) existingPlayerGames.set(row.gameId + "|" + row.id, row);
      game.playerStatsFetched = true;
      euroStatsFetched++;
    }
  } catch (e) { console.warn("EuroLeague box score warning [" + game.id + "]: " + e.message); }
  await wait(6500);
}
const updatedGames = games.map(g => gameMap.get(g.id));
const playerGames = [...existingPlayerGames.values()].sort((a,b) => new Date(a.date)-new Date(b.date)).slice(-12000);
let odds = old.odds || [];
let oddsUpdatedAt = old.oddsUpdatedAt || null;
if (process.env.ODDS_API_KEY) {
  try {
    const key = process.env.ODDS_API_KEY;
    const sports = await getJson("https://api.the-odds-api.com/v4/sports/?apiKey=" + encodeURIComponent(key));
    const supported = (sports || []).filter(s => s.active && /basketball.*(nba|euroleague)|basketball_nba/i.test((s.key || "") + " " + (s.title || "")));
    const fresh = [];
    for (const sport of supported) {
      try {
        const events = await getJson("https://api.the-odds-api.com/v4/sports/" + encodeURIComponent(sport.key) + "/odds/?apiKey=" + encodeURIComponent(key) + "&regions=us,eu&markets=h2h,spreads,totals&oddsFormat=decimal&dateFormat=iso");
        const leagueName = /euroleague/i.test(sport.key + " " + sport.title) ? "EuroLeague" : "NBA";
        for (const event of events || []) {
          for (const book of event.bookmakers || []) {
            const record = { id:String(event.id)+"|"+book.key,eventId:String(event.id),league:leagueName,home:event.home_team,away:event.away_team,date:event.commence_time,bookmaker:book.title||book.key,moneyline:null,spread:null,total:null };
            for (const market of book.markets || []) {
              if (market.key === "h2h") {
                const h=market.outcomes?.find(o=>o.name===event.home_team),a=market.outcomes?.find(o=>o.name===event.away_team);
                if(h&&a)record.moneyline={home:Number(h.price),away:Number(a.price),updatedAt:market.last_update||book.last_update};
              } else if (market.key === "spreads") {
                const h=market.outcomes?.find(o=>o.name===event.home_team),a=market.outcomes?.find(o=>o.name===event.away_team);
                if(h&&a)record.spread={homePoint:Number(h.point),awayPoint:Number(a.point),homeOdds:Number(h.price),awayOdds:Number(a.price),updatedAt:market.last_update||book.last_update};
              } else if (market.key === "totals") {
                const over=market.outcomes?.find(o=>o.name==="Over"),under=market.outcomes?.find(o=>o.name==="Under");
                if(over&&under)record.total={point:Number(over.point),overOdds:Number(over.price),underOdds:Number(under.price),updatedAt:market.last_update||book.last_update};
              }
            }
            if(record.moneyline||record.spread||record.total)fresh.push(record);
          }
        }
      } catch(e) { console.warn("Odds feed warning ["+sport.key+"]: "+e.message); }
      await wait(200);
    }
    if(fresh.length){odds=fresh;oddsUpdatedAt=now.toISOString();}
    console.log("Odds records received: "+fresh.length);
  } catch(e) { console.warn("Odds provider unavailable: "+e.message); }
}
const result = {
  schemaVersion: 1,
  lastUpdated: now.toISOString(),
  historyWindow: fullBackfill ? "Istorijski backfill: NBA 35 dana; EuroLeague 2024–2026" : "Automatsko ažuriranje: poslednjih 8 dana + sačuvana istorija",
  games: updatedGames,
  playerGames,
  odds,
  oddsUpdatedAt,
  sources: {
    NBA: { provider: "ESPN public scoreboard/box score", checkedAt: now.toISOString(), games: updatedGames.filter(g => g.league === "NBA").length },
    EuroLeague: { provider: "EuroLeague public API", checkedAt: now.toISOString(), games: updatedGames.filter(g => g.league === "EuroLeague").length }
  },
  sync: { mode: fullBackfill ? "full-backfill" : "incremental", summariesAttempted: summariesToFetch.length, summariesSucceeded, euroStatsFetched, warnings: errors }
};
await fs.mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await fs.writeFile(DATA_FILE, JSON.stringify(result));
console.log("Saved " + updatedGames.length + " games and " + playerGames.length + " player-game lines; NBA box scores " + summariesSucceeded + "/" + summariesToFetch.length + "; EuroLeague box scores " + euroStatsFetched + "/" + euroToFetch.length + "; fullBackfill=" + fullBackfill);
