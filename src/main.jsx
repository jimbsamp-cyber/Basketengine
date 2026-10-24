import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, CalendarDays, CheckCircle2, Clock3, Database, RefreshCw, Search, Target, TrendingUp, Users, Wifi, AlertCircle, Menu, BrainCircuit, Gauge, Trophy, ChartNoAxesCombined } from "lucide-react";
import "./style.css";

const FEEDS = [
  { key:"NBA", name:"NBA", sport:"nba", url:"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { key:"EuroLeague", name:"EuroLeague", sport:"euroleague", url:"https://site.api.espn.com/apis/site/v2/sports/basketball/euroleague/scoreboard" }
];
const fmtDate = value => value ? new Date(value).toLocaleString("sr-RS",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "Termin nije dostupan";
const num = (v,d=1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const pct = p => Number.isFinite(p) ? (p*100).toFixed(1)+"%" : "—";
const cleanGame = (event, feed) => {
  const comp=event.competitions?.[0], competitors=comp?.competitors||[];
  const home=competitors.find(t=>t.homeAway==="home")||competitors[0], away=competitors.find(t=>t.homeAway==="away")||competitors[1];
  const state=event.status?.type?.state;
  if(!home?.team||!away?.team)return null;
  return {id:feed.key+"-"+event.id,eventId:String(event.id),league:feed.name,date:event.date,home:home.team.displayName||home.team.name,away:away.team.displayName||away.team.name,homeId:String(home.team.id||""),awayId:String(away.team.id||""),homeScore:home.score==null?null:Number(home.score),awayScore:away.score==null?null:Number(away.score),status:state==="post"?"Završena":state==="in"?"Uživo":"Zakazana",statusCode:state,venue:comp?.venue?.fullName||""};
};
function teamForm(games, team, league, beforeDate) {
  const rows=games.filter(g=>g.league===league&&g.status==="Završena"&&g.homeScore!=null&&g.awayScore!=null&&new Date(g.date)<new Date(beforeDate)&&(g.home===team||g.away===team)).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
  const scored=[], allowed=[], wins=[];
  for(const g of rows){const home=g.home===team;scored.push(home?g.homeScore:g.awayScore);allowed.push(home?g.awayScore:g.homeScore);wins.push((home?g.homeScore>g.awayScore:g.awayScore>g.homeScore)?1:0);}
  return {games:rows.length,for:mean(scored),against:mean(allowed),winRate:mean(wins),margin:mean(scored.map((s,i)=>s-allowed[i])),rows};
}
function predictGame(game,games) {
  const h=teamForm(games,game.home,game.league,game.date), a=teamForm(games,game.away,game.league,game.date);
  if(h.games<3||a.games<3||h.for==null||a.for==null)return null;
  const baseline=games.filter(g=>g.league===game.league&&g.status==="Završena"&&g.homeScore!=null&&g.awayScore!=null&&new Date(g.date)<new Date(game.date));
  const avgHome=mean(baseline.map(g=>g.homeScore)), avgAway=mean(baseline.map(g=>g.awayScore));
  const leagueHome=avgHome??h.for, leagueAway=avgAway??a.for;
  const homeExpected=Math.max(45,Math.min(160,(h.for+a.against)/2+(leagueHome-leagueAway)*0.15+1.8));
  const awayExpected=Math.max(45,Math.min(160,(a.for+h.against)/2-1.8));
  const margin=homeExpected-awayExpected, total=homeExpected+awayExpected;
  // Walk-forward Elo: every rating update uses only games before this tip-off.
  const prior=baseline.slice().sort((x,y)=>new Date(x.date)-new Date(y.date));
  const ratings=new Map();
  for(const played of prior){
    const rh=ratings.get(played.home)??1500, ra=ratings.get(played.away)??1500;
    const expected=1/(1+Math.pow(10,-((rh+65-ra)/400)));
    const actual=played.homeScore>played.awayScore?1:played.homeScore===played.awayScore?0.5:0;
    const diff=Math.abs(played.homeScore-played.awayScore);
    const multiplier=Math.log(diff+1)*(2.2/(2.2+0.001*Math.abs(rh-ra)));
    const change=20*multiplier*(actual-expected);
    ratings.set(played.home,rh+change);ratings.set(played.away,ra-change);
  }
  const eloHome=ratings.get(game.home)??1500,eloAway=ratings.get(game.away)??1500;
  const eloProb=1/(1+Math.pow(10,-((eloHome+65-eloAway)/400)));
  const formProb=1/(1+Math.exp(-margin/11.5));
  const homeWin=0.6*eloProb+0.4*formProb;
  return {homeExpected,awayExpected,margin,total,homeWin,awayWin:1-homeWin,sampleHome:h.games,sampleAway:a.games,eloHome,eloAway,model:"Elo + rolling form / experimental"};
}
function buildBacktest(games) {
  const finished=games.filter(g=>g.status==="Završena"&&g.homeScore!=null&&g.awayScore!=null).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=[], errors=[], margins=[], totals=[], outcomes=[];
  for(const g of finished){
    const p=predictGame(g,past);
    if(p){const actualMargin=g.homeScore-g.awayScore, actualTotal=g.homeScore+g.awayScore;errors.push(Math.abs(p.homeExpected-g.homeScore)+Math.abs(p.awayExpected-g.awayScore));margins.push(Math.abs(p.margin-actualMargin));totals.push(Math.abs(p.total-actualTotal));outcomes.push((p.homeWin>=0.5)===(actualMargin>0)?1:0);}
    past.push(g);
  }
  return {count:outcomes.length,accuracy:mean(outcomes),pointMae:mean(errors),marginMae:mean(margins),totalMae:mean(totals)};
}
function playerProjections(playerGames,league,query){
  const grouped=new Map();
  for(const row of playerGames.filter(p=>!league||league==="Sve lige"||p.league===league)){
    const key=row.league+"|"+(row.id||row.name);
    if(!grouped.has(key))grouped.set(key,{...row,rows:[]});
    grouped.get(key).rows.push(row);
  }
  return [...grouped.values()].map(p=>{
    const recent=p.rows.sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
    const avg=key=>mean(recent.map(r=>r[key]).filter(v=>Number.isFinite(v)));
    return {...p,sample:recent.length,minutesAvg:avg("minutes"),ptsAvg:avg("points"),rebAvg:avg("rebounds"),astAvg:avg("assists"),lastDate:recent[0]?.date};
  }).filter(p=>p.sample>0&&(!query||[p.name,p.team,p.league].join(" ").toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>(b.sample-a.sample)||(b.ptsAvg||0)-(a.ptsAvg||0));
}
function App(){
  const [league,setLeague]=useState("Sve lige"),[tab,setTab]=useState("Pregled"),[query,setQuery]=useState("");
  const [games,setGames]=useState([]),[playerGames,setPlayerGames]=useState([]),[sources,setSources]=useState([]),[syncInfo,setSyncInfo]=useState(null),[historyWindow,setHistoryWindow]=useState("");
  const [busy,setBusy]=useState(false),[lastUpdated,setLastUpdated]=useState(""),[error,setError]=useState(""),[mobileNav,setMobileNav]=useState(false),[odds,setOdds]=useState([]),[oddsUpdatedAt,setOddsUpdatedAt]=useState(null),[playerPropOdds,setPlayerPropOdds]=useState([]),[playerPropOddsUpdatedAt,setPlayerPropOddsUpdatedAt]=useState(null);
  const refresh=useCallback(async()=>{
    setBusy(true);setError("");
    let savedGames=[],savedPlayers=[],savedSources={},sync=null;
    try{
      const r=await fetch(import.meta.env.BASE_URL+"data/engine-data.json?ts="+Date.now(),{cache:"no-store"});
      if(r.ok){const data=await r.json();savedGames=data.games||[];savedPlayers=data.playerGames||[];savedSources=data.sources||{};sync=data.sync||null;setLastUpdated(data.lastUpdated||"");setHistoryWindow(data.historyWindow||"");setOdds(data.odds||[]);setOddsUpdatedAt(data.oddsUpdatedAt||null);setPlayerPropOdds(data.playerPropOdds||[]);setPlayerPropOddsUpdatedAt(data.playerPropOddsUpdatedAt||null);}
    }catch(e){console.warn("Static data feed:",e);}
    const live=await Promise.all(FEEDS.map(async feed=>{
      try{const r=await fetch(feed.url,{headers:{accept:"application/json"},cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();return {name:feed.name,status:"Uspeh",detail:"ESPN raspored dostupan",games:(j.events||[]).map(e=>cleanGame(e,feed)).filter(Boolean)};}
      catch(e){return {name:feed.name,status:"Greška",detail:"ESPN feed nije dostupan ("+(e?.message||"greška")+")",games:[]};}
    }));
    const map=new Map(savedGames.map(g=>[g.id,g]));
    live.forEach(s=>s.games.forEach(g=>map.set(g.id,{...map.get(g.id),...g})));
    const all=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
    setGames(all);setPlayerGames(savedPlayers);setSyncInfo(sync);
    setSources([
      {name:"Lokalna istorijska baza",status:savedGames.length?"Uspeh":"Čeka podatke",detail:savedGames.length+" utakmica sačuvano · "+savedPlayers.length+" linija igrača"},
      ...live.map(s=>({name:s.name,status:s.status,detail:s.detail+" · "+s.games.length+" događaja"}))
    ]);
    if(!savedGames.length&&live.every(s=>s.status==="Greška"))setError("Nije moguće dobaviti podatke. Proveri mrežu ili sačekaj sledeću automatsku sinhronizaciju.");
    setBusy(false);
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,5*60*1000);return()=>clearInterval(timer);},[refresh]);
  const visible=useMemo(()=>games.filter(g=>(league==="Sve lige"||g.league===league)&&(!query||[g.home,g.away,g.league].join(" ").toLowerCase().includes(query.toLowerCase()))),[games,league,query]);
  const upcoming=visible.filter(g=>g.status==="Zakazana").length,finished=visible.filter(g=>g.status==="Završena").length,liveCount=visible.filter(g=>g.status==="Uživo").length;
  const upcomingPred=useMemo(()=>visible.filter(g=>g.status!=="Završena").map(g=>({game:g,p:predictGame(g,games)})),[visible,games]);
  const players=useMemo(()=>playerProjections(playerGames,league,query),[playerGames,league,query]);
  const backtest=useMemo(()=>buildBacktest(games.filter(g=>league==="Sve lige"||g.league===league)),[games,league]);
  const valueRows=useMemo(()=>{
    const normalize=x=>(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const rows=[];
    for(const o of odds){
      if(league!=="Sve lige"&&o.league!==league)continue;
      const g=games.find(x=>x.league===o.league&&Math.abs(new Date(x.date)-new Date(o.date))<36*60*60*1000&&((normalize(x.home)===normalize(o.home)||normalize(x.home).includes(normalize(o.home))||normalize(o.home).includes(normalize(x.home)))&&(normalize(x.away)===normalize(o.away)||normalize(x.away).includes(normalize(o.away))||normalize(o.away).includes(normalize(x.away)))));
      if(!g||g.status==="Završena")continue;
      const p=predictGame(g,games);if(!p)continue;
      const addRow=(market,selection,price,probability,line="—")=>{if(!Number.isFinite(price)||price<=1||!Number.isFinite(probability))return;const ev=probability*price-1;rows.push({id:o.id+"|"+market+"|"+selection,game:g,bookmaker:o.bookmaker,market,selection,price,probability,ev,line});};
      if(o.moneyline){addRow("Pobeda",g.home,o.moneyline.home,p.homeWin);addRow("Pobeda",g.away,o.moneyline.away,p.awayWin);}
      if(o.spread){const ph=1/(1+Math.exp(-(p.margin+o.spread.homePoint)/6.5));addRow("Hendikep",g.home,o.spread.homeOdds,ph,(o.spread.homePoint>0?"+":"")+o.spread.homePoint);addRow("Hendikep",g.away,o.spread.awayOdds,1-ph,(o.spread.awayPoint>0?"+":"")+o.spread.awayPoint);}
      if(o.total){const po=1/(1+Math.exp(-(p.total-o.total.point)/8));addRow("Ukupno","Over "+o.total.point,o.total.overOdds,po,o.total.point);addRow("Ukupno","Under "+o.total.point,o.total.underOdds,1-po,o.total.point);}
    }
    for(const o of playerPropOdds){
      if(league!=="Sve lige"&&o.league!==league)continue;
      const normalize=x=>(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const g=games.find(x=>x.league===o.league&&Math.abs(new Date(x.date)-new Date(o.date))<36*60*60*1000&&((normalize(x.home)===normalize(o.home)||normalize(x.home).includes(normalize(o.home))||normalize(o.home).includes(normalize(x.home)))&&(normalize(x.away)===normalize(o.away)||normalize(x.away).includes(normalize(o.away))||normalize(o.away).includes(normalize(x.away)))));
      if(!g||g.status==="Završena")continue;
      const statKey=({player_points:"points",player_rebounds:"rebounds",player_assists:"assists"})[o.market];
      if(!statKey)continue;
      const playerKey=normalize(o.player);
      const logs=playerGames.filter(p=>p.league===o.league&&normalize(p.name)===playerKey&&new Date(p.date)<new Date(g.date)&&[g.home,g.away].some(team=>{const t=normalize(team),pt=normalize(p.team);return t===pt||t.includes(pt)||pt.includes(t);})).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
      const values=logs.map(p=>p[statKey]).filter(v=>Number.isFinite(v));
      if(values.length<3)continue;
      const avg=mean(values),variance=mean(values.map(v=>(v-avg)*(v-avg)))||0,sd=Math.sqrt(variance);
      const overProb=1/(1+Math.exp(-(avg-o.line)/(Math.max(1.3,sd*0.75))));
      const addProp=(selection,price,probability)=>{if(!Number.isFinite(price)||price<=1)return;rows.push({id:o.id+"|"+selection,game:g,bookmaker:o.bookmaker,market:statKey==="points"?"Player poeni":statKey==="rebounds"?"Player skokovi":"Player asistencije",selection,price,probability,ev:probability*price-1,line:o.line});};
      addProp(o.player+" Over "+o.line,o.overOdds,overProb);
      addProp(o.player+" Under "+o.line,o.underOdds,1-overProb);
    }
    return rows.sort((a,b)=>b.ev-a.ev);
  },[odds,playerPropOdds,games,playerGames,league]);

  const nav=[["Pregled",BarChart3],["Utakmice",CalendarDays],["Model Rez",Target],["Player Props",Users],["Value",TrendingUp],["Backtest",Activity],["Data Center",Database]];
  return <div className="shell">
    <aside className={"sidebar "+(mobileNav?"show":"")}><div className="brand"><div className="brandmark"><BarChart3 size={23}/></div><div><b>BASKET<span>LAB</span></b><small>PROJECTION ENGINE</small></div></div><p className="eyebrow">RADNI PROSTOR</p><div className="season">● SEZONA 2026 / 27</div><nav>{nav.map(([label,Icon])=><button key={label} className={tab===label?"nav active":"nav"} onClick={()=>{setTab(label);setMobileNav(false)}}><Icon size={17}/><span>{label}</span>{label==="Value"&&<em>EV</em>}</button>)}</nav><div className="sidebottom"><div className="health"><small>STATUS PODATAKA</small><b>{games.length?"Istorija povezana":"Provera izvora"}</b><p>Automatska baza i živi raspored.</p></div><small>NEZAVISNA VERZIJA · V0.2</small></div></aside>
    <main><header className="topbar"><button className="hamburger" onClick={()=>setMobileNav(!mobileNav)} aria-label="Otvori meni"><Menu size={19}/></button><span className="crumb">BASKETLAB <i>/</i> {tab.toUpperCase()}</span><div className="actions"><span className="live"><span/> {games.length?"BAZA POVEZANA":"ČEKA PODATKE"}</span><button className="refresh" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy?"spin":""}/>{busy?"Učitavam…":"Ažuriraj podatke"}</button></div></header>
    <div className="content"><div className="heading"><div><p className="kicker">BASKETBALL INTELLIGENCE / 02</p><h1>{tab==="Pregled"?"Pregled sistema":tab}</h1><p className="sub">NBA i Evroliga · automatska istorija · projekcije · tržišna vrednost</p></div><div className="updated"><CalendarDays size={18}/><div><small>POSLEDNJA SINHRONIZACIJA</small><b>{lastUpdated?fmtDate(lastUpdated):"Čeka prvi sync"}</b></div></div></div>
    {error&&<div className="alert"><AlertCircle size={17}/>{error}</div>}
    <div className="leaguebar">{["Sve lige","NBA","EuroLeague"].map(l=><button key={l} onClick={()=>setLeague(l)} className={league===l?"chosen":""}>{l}</button>)}</div>
    {tab==="Pregled"&&<><section className="metrics"><Metric title="UTAKMICE U BAZI" value={visible.length} info="Sačuvana istorija + raspored" icon={<CalendarDays/>}/><Metric title="PREDSTOJEĆE" value={upcoming} info="Prema izvoru" icon={<Clock3/>}/><Metric title="UŽIVO" value={liveCount} info="Trenutno u toku" icon={<Activity/>}/><Metric title="IGRAČKI BOX SCORE" value={players.length} info="Igrači sa istorijskim zapisima" icon={<Users/>}/></section><section className="columns"><div className="panel"><div className="panelhead"><div><h2>Raspored utakmica</h2><p>Sačuvani rezultati i aktuelni raspored</p></div><button className="textbtn" onClick={()=>setTab("Utakmice")}>Sve utakmice ↗</button></div><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pretraži tim ili ligu…"/></label>{busy&&!games.length?<div className="empty">Učitavam raspored…</div>:visible.length?<div className="gamelist">{visible.slice(-80).reverse().slice(0,10).map(g=><GameRow key={g.id} game={g}/>)}</div>:<div className="empty">Podaci još nisu sinhronizovani.</div>}</div><div className="stack"><div className="panel"><div className="panelhead"><div><h2>Projection Engine</h2><p>Model forma timova</p></div><BrainCircuit size={19}/></div><div className="engine"><span className="dot"/><div><b>Eksperimentalni Elo + rolling model</b><p>Koristi prethodne rezultate, samo pre početka utakmice. Još nije kalibrisan za klađenje.</p></div></div><div className="checkrow"><span>Projekcije rezultata</span><em>{upcomingPred.filter(x=>x.p).length} dostupno</em></div><div className="checkrow"><span>Player Props</span><em>{playerGames.length} zapisa</em></div><div className="checkrow"><span>Tržišne kvote</span><em>{odds.length||playerPropOdds.length?"Dostupne":"Nije povezan feed"}</em></div></div><div className="panel value"><div className="panelhead"><div><h2>Model health</h2><p>Walk-forward provera</p></div><Gauge size={19}/></div><div className="miniStats"><div><small>Test utakmice</small><b>{backtest.count}</b></div><div><small>Pogodak pobednika</small><b>{pct(backtest.accuracy)}</b></div></div><p className="fineprint">Ovo je osnovni backtest nad dostupnim rezultatima, bez kvota i bez korekcije svih faktora. Nije dokaz profitabilnosti.</p></div></div></section></>}
    {tab==="Utakmice"&&<div className="panel"><div className="panelhead"><div><h2>Sve utakmice</h2><p>{visible.length} zapisa · prikazano poslednjih 300 · {league}</p></div></div><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pretraži tim ili ligu…"/></label>{visible.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,300).map(g=><GameRow key={g.id} game={g}/>)}</div>}
    {tab==="Model Rez"&&<div className="panel"><div className="panelhead"><div><h2>Projekcije utakmica</h2><p>Forma poslednjih 10 utakmica; minimum 3 prethodna meča po timu</p></div><Target size={19}/></div><div className="tableWrap"><table><thead><tr><th>Utakmica</th><th>Prognoza rezultata</th><th>Hendikep</th><th>Ukupno</th><th>Pobeda domaćina</th><th>Uzorak</th></tr></thead><tbody>{upcomingPred.sort((a,b)=>new Date(a.game.date)-new Date(b.game.date)).map(({game:g,p})=><tr key={g.id}><td><b>{g.home} – {g.away}</b><small>{g.league} · {fmtDate(g.date)}</small></td>{p?<><td>{num(p.homeExpected,0)} : {num(p.awayExpected,0)}</td><td>{p.margin>0?"+":""}{num(p.margin)} {g.home}</td><td>{num(p.total)}</td><td>{pct(p.homeWin)}</td><td>{p.sampleHome}/{p.sampleAway}</td></>:<td colSpan="5" className="muted">Nema dovoljno prethodnih rezultata za odgovornu procenu.</td>}</tr>)}</tbody></table></div><div className="note"><AlertCircle size={17}/><p>Ovo je početni statistički baseline, ne konačan prediktivni model. Potrebni su walk-forward testovi, kalibracija i dodatne informacije (povrede, odmor, tempo) pre upotrebe za opklade.</p></div></div>}
    {tab==="Player Props"&&<div className="panel"><div className="panelhead"><div><h2>Player Props — projekcije</h2><p>Prosek poslednjih do 10 sačuvanih box score utakmica</p></div><Users size={19}/></div><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pretraži igrača ili tim…"/></label><div className="tableWrap"><table><thead><tr><th>Igrač</th><th>Tim</th><th>Utakmice</th><th>Min</th><th>Poeni</th><th>Skokovi</th><th>Asistencije</th><th>Poslednji meč</th></tr></thead><tbody>{players.slice(0,250).map(p=><tr key={p.league+"-"+p.id}><td><b>{p.name}</b><small>{p.league}</small></td><td>{p.team}</td><td>{p.sample}</td><td>{num(p.minutesAvg)}</td><td>{num(p.ptsAvg)}</td><td>{num(p.rebAvg)}</td><td>{num(p.astAvg)}</td><td>{fmtDate(p.lastDate)}</td></tr>)}</tbody></table></div>{!players.length&&<div className="empty">Igračka istorija će se pojaviti nakon što sinhronizacija preuzme box score podatke.</div>}<div className="note"><AlertCircle size={17}/><p>Brojevi su rolling proseci, ne kalibrisane projekcije za konkretan meč. Ne uzimaju u obzir potvrđene povrede, očekivanu minutažu ni tržišne linije.</p></div></div>}
    {tab==="Value"&&<div className="panel"><div className="panelhead"><div><h2>Value Scanner</h2><p>EV = model verovatnoća × decimalna kvota − 1 · {oddsUpdatedAt?"kvote ažurirane "+fmtDate(oddsUpdatedAt):"kvote nisu dostupne"} {playerPropOddsUpdatedAt?"· player props "+fmtDate(playerPropOddsUpdatedAt):""}</p></div><TrendingUp size={19}/></div>{valueRows.length?<><div className="tableWrap"><table><thead><tr><th>Utakmica</th><th>Tržište</th><th>Izbor</th><th>Kvota</th><th>Model verovatnoća</th><th>EV</th><th>Kladionica</th></tr></thead><tbody>{valueRows.map(r=><tr key={r.id}><td><b>{r.game.home} – {r.game.away}</b><small>{r.game.league} · {fmtDate(r.game.date)}</small></td><td>{r.market}</td><td>{r.selection} {r.line!=="—"&&r.market==="Hendikep"?r.line:""}</td><td>{num(r.price,2)}</td><td>{pct(r.probability)}</td><td className={r.ev>0.03?"success":r.ev<0?"failure":"pending"}>{(r.ev*100).toFixed(1)}%</td><td>{r.bookmaker}</td></tr>)}</tbody></table></div><div className="note"><AlertCircle size={17}/><p>EV koristi eksperimentalnu verovatnoću modela, zato su vrednosti indikativne, a ne validirane preporuke. Hendikep i total koriste aproksimaciju distribucije. Proveri liniju i cenu pre odluke.</p></div></>:<div className="valueExplain"><div className="placeholdericon"><ChartNoAxesCombined/></div><h2>{odds.length||playerPropOdds.length?"Čekaju se odgovarajuće utakmice i dovoljan istorijski uzorak":"Automatski feed kvota još nije povezan"}</h2><p>Integracija je spremna za The Odds API. Potrebno je jednom dodati ODDS_API_KEY kao GitHub Actions secret. Bez ključa ne prikazujemo izmišljene kvote. Player props se preuzimaju dnevno za do četiri naredne NBA utakmice kada provider i plan podržavaju ta tržišta.</p><div className="checkrow"><span>Moneyline / pobednik</span><em>{odds.length?"Feed dostupan":"Čeka ODDS_API_KEY"}</em></div><div className="checkrow"><span>Hendikep / totals</span><em>{odds.length?"Feed dostupan":"Čeka ODDS_API_KEY"}</em></div><div className="checkrow"><span>Player props tržišta</span><em>Posebna dostupnost kod providera</em></div></div>}</div>}
    {tab==="Backtest"&&<div className="panel"><div className="panelhead"><div><h2>Backtest & kalibracija</h2><p>Hronološki test: svaka prognoza koristi samo ranije rezultate</p></div><Activity size={19}/></div><section className="metrics backmetrics"><Metric title="TESTIRANE UTAKMICE" value={backtest.count} info="Model imao bar 3 meča po timu" icon={<Trophy/>}/><Metric title="TAČNOST POBEDNIKA" value={pct(backtest.accuracy)} info="Nije ROI" icon={<Target/>}/><Metric title="GREŠKA REZULTATA" value={num(backtest.pointMae)} info="Prosečna apsolutna greška zbir po timovima" icon={<Gauge/>}/><Metric title="GREŠKA UKUPNOG ZBIRA" value={num(backtest.totalMae)} info="Poeni po utakmici" icon={<ChartNoAxesCombined/>}/></section><div className="checkrow"><span>Prosečna greška margine</span><em>{num(backtest.marginMae)} poena</em></div><div className="note"><AlertCircle size={17}/><p>Rezultat se računa lokalno iz istorije koja je trenutno dostupna. Za validaciju pre klađenja potreban je duži uzorak, odvojeni vremenski periodi, kalibracija verovatnoća i istorijske kvote. ROI se ne prikazuje bez stvarnih kvota.</p></div></div>}
    {tab==="Data Center"&&<div className="panel"><div className="panelhead"><div><h2>Data Center</h2><p>Automatska sinhronizacija u pozadini na svakih 6 sati</p></div><Wifi size={19}/></div>{sources.map(s=><div className="source" key={s.name}><div><b>{s.name}</b><p>{s.detail}</p></div><span className={s.status==="Uspeh"?"success":s.status==="Greška"?"failure":"pending"}>{s.status}</span></div>)}<div className="source"><div><b>Istorijski backfill</b><p>{historyWindow||"Čeka se prvi automatski backfill"}</p></div><span className="pending">{syncInfo?.mode||"Čeka"}</span></div><div className="source"><div><b>Odds provider</b><p>Tržišne kvote nisu deo javnog ESPN feed-a</p></div><span className="pending">{odds.length||playerPropOdds.length?"Povezan":"Nije povezan"}</span></div><div className="note"><AlertCircle size={17}/><p>Automatski sync radi na GitHub Actions rasporedu i čuva normalizovane rezultate u javnom statičkom dataset-u. Ovaj frontend osvežava prikaz svakih 5 minuta; pozadinski sync radi nezavisno od otvorenog pregledača. Dataset je javno čitljiv jer aplikacija koristi GitHub Pages.</p></div></div>}
    <footer>BASKETBALL PROJECTION ENGINE <span>INDEPENDENT BUILD · V0.2</span></footer></div></main></div>;
}
function Metric({title,value,info,icon}){return <div className="metric"><div className="metric-top"><span>{title}</span><i>{icon}</i></div><strong>{value}</strong><small>{info}</small></div>}
function GameRow({game:g}){return <div className="game"><div className="date">{fmtDate(g.date)}</div><div className="teams"><div><span className="badge">{(g.home||"??").split(" ").map(x=>x[0]).slice(0,3).join("")}</span><b>{g.home}</b><strong>{g.homeScore??"—"}</strong></div><div><span className="badge away">{(g.away||"??").split(" ").map(x=>x[0]).slice(0,3).join("")}</span><b>{g.away}</b><strong>{g.awayScore??"—"}</strong></div></div><div className="gameinfo"><span className={g.league==="NBA"?"tag nba":"tag euro"}>{g.league}</span><small className={g.statusCode==="in"?"inplay":g.statusCode==="post"?"final":""}>{g.status}</small></div></div>}
createRoot(document.getElementById("root")).render(<App/>);
