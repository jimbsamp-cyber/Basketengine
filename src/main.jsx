import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, CalendarDays, CheckCircle2, Clock3, Database, RefreshCw, Search, Target, TrendingUp, Users, Wifi, AlertCircle, Menu } from "lucide-react";
import "./style.css";

const FEEDS = [
  { key:"NBA", name:"NBA", url:"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { key:"EuroLeague", name:"EuroLeague", url:"https://site.api.espn.com/apis/site/v2/sports/basketball/euroleague/scoreboard" }
];
const fmtDate = value => value ? new Date(value).toLocaleString("sr-RS",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "Termin nije dostupan";
function App(){
  const [league,setLeague]=useState("Sve lige");
  const [tab,setTab]=useState("Pregled");
  const [query,setQuery]=useState("");
  const [games,setGames]=useState([]);
  const [sources,setSources]=useState([]);
  const [busy,setBusy]=useState(false);
  const [lastUpdated,setLastUpdated]=useState("");
  const [error,setError]=useState("");
  const [mobileNav,setMobileNav]=useState(false);

  const refresh=useCallback(async()=>{
    setBusy(true);setError("");
    const results=await Promise.all(FEEDS.map(async feed=>{
      try{
        const response=await fetch(feed.url,{headers:{accept:"application/json"}});
        if(!response.ok) throw new Error("HTTP "+response.status);
        const json=await response.json();
        const events=(json.events||[]).map(event=>{
          const comp=event.competitions?.[0];
          const competitors=comp?.competitors||[];
          const home=competitors.find(t=>t.homeAway==="home")||competitors[0];
          const away=competitors.find(t=>t.homeAway==="away")||competitors[1];
          const state=event.status?.type?.state;
          return {id:feed.key+"-"+event.id,league:feed.name,date:event.date,home:home?.team?.displayName||"Domaćin",away:away?.team?.displayName||"Gost",homeScore:home?.score,awayScore:away?.score,status:state==="post"?"Završena":state==="in"?"Uživo":"Zakazana",statusCode:state,venue:comp?.venue?.fullName||""};
        });
        return {name:feed.name,status:"Uspeh",count:events.length,detail:"Podaci uspešno preuzeti",games:events};
      }catch(e){return {name:feed.name,status:"Greška",count:0,detail:"Izvor trenutno nije dostupan ("+(e?.message||"greška")+")",games:[]};}
    }));
    const all=results.flatMap(r=>r.games).sort((a,b)=>new Date(a.date)-new Date(b.date));
    setSources(results);setGames(all);setLastUpdated(new Date().toISOString());
    if(results.every(r=>r.status==="Greška"))setError("Trenutno nije moguće preuzeti podatke sa javnih izvora. Pokušaj ponovo kasnije.");
    setBusy(false);
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,5*60*1000);return()=>clearInterval(timer);},[refresh]);

  const visible=useMemo(()=>games.filter(g=>(league==="Sve lige"||g.league===league)&&(!query||[g.home,g.away,g.league].join(" ").toLowerCase().includes(query.toLowerCase()))),[games,league,query]);
  const upcoming=games.filter(g=>g.status==="Zakazana").length;
  const finished=games.filter(g=>g.status==="Završena").length;
  const nav=[["Pregled",BarChart3],["Utakmice",CalendarDays],["Model Rez",Target],["Player Props",Users],["Value",TrendingUp],["Backtest",Activity],["Data Center",Database]];
  return <div className="shell">
    <aside className={"sidebar "+(mobileNav?"show":"")}><div className="brand"><div className="brandmark"><BarChart3 size={23}/></div><div><b>BASKET<span>LAB</span></b><small>PROJECTION ENGINE</small></div></div><p className="eyebrow">RADNI PROSTOR</p><div className="season">● SEZONA 2026 / 27</div><nav>{nav.map(([label,Icon])=><button key={label} className={tab===label?"nav active":"nav"} onClick={()=>{setTab(label);setMobileNav(false)}}><Icon size={17}/><span>{label}</span>{label==="Value"&&<em>EV</em>}</button>)}</nav><div className="sidebottom"><div className="health"><small>STATUS PODATAKA</small><b>{sources.some(s=>s.status==="Uspeh")?"Izvor dostupan":"Provera izvora"}</b><p>Javni scoreboard izvori, bez ručnog uvoza.</p></div><small>NEZAVISNA VERZIJA · V0.1</small></div></aside>
    <main><header className="topbar"><button className="hamburger" onClick={()=>setMobileNav(!mobileNav)} aria-label="Otvori meni"><Menu size={19}/></button><span className="crumb">BASKETLAB <i>/</i> {tab.toUpperCase()}</span><div className="actions"><span className="live"><span/> {sources.some(s=>s.status==="Uspeh")?"IZVOR PROVEREN":"ČEKA PODATKE"}</span><button className="refresh" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy?"spin":""}/>{busy?"Učitavam…":"Ažuriraj podatke"}</button></div></header>
    <div className="content"><div className="heading"><div><p className="kicker">BASKETBALL INTELLIGENCE / 01</p><h1>{tab==="Pregled"?"Pregled sistema":tab}</h1><p className="sub">NBA i Evroliga · Statistika · Projekcije · Tržišna vrednost</p></div><div className="updated"><CalendarDays size={18}/><div><small>POSLEDNJE AŽURIRANJE</small><b>{lastUpdated?fmtDate(lastUpdated):"Povezivanje…"}</b></div></div></div>
    {error&&<div className="alert"><AlertCircle size={17}/>{error}</div>}
    <div className="leaguebar">{["Sve lige","NBA","EuroLeague"].map(l=><button key={l} onClick={()=>setLeague(l)} className={league===l?"chosen":""}>{l}</button>)}</div>
    {tab==="Pregled"&&<><section className="metrics"><Metric title="UTAKMICE U FEED-U" value={games.length} info="Trenutno vraćeni zapisi" icon={<CalendarDays/>}/><Metric title="PREDSTOJEĆE" value={upcoming} info="Prema izvoru" icon={<Clock3/>}/><Metric title="ZAVRŠENE" value={finished} info="Rezultati dostupni" icon={<CheckCircle2/>}/><Metric title="VALIDIRANE PROJEKCIJE" value="—" info="Model još nije validiran" icon={<Target/>}/></section><section className="columns"><div className="panel"><div className="panelhead"><div><h2>Raspored utakmica</h2><p>Podaci iz dostupnih javnih izvora</p></div><button className="textbtn" onClick={()=>setTab("Utakmice")}>Sve utakmice ↗</button></div><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pretraži tim ili ligu…"/></label>{busy&&!games.length?<div className="empty">Učitavam raspored…</div>:visible.length?<div className="gamelist">{visible.slice(0,8).map(g=><GameRow key={g.id} game={g}/>)}</div>:<div className="empty">{games.length?"Nema utakmica za izabrani filter.":"Izvor nije vratio utakmice. Proveri Data Center ili pokušaj ponovo."}</div>}</div><div className="stack"><div className="panel"><div className="panelhead"><div><h2>Projection Engine</h2><p>Status modela</p></div><Activity size={19}/></div><div className="engine"><span className="dot"/><div><b>Model u pripremi</b><p>Ne prikazujemo neproverene prognoze kao pouzdane.</p></div></div><div className="checkrow"><span>Timske projekcije</span><em>Čeka validaciju</em></div><div className="checkrow"><span>Player props</span><em>Čeka istoriju igrača</em></div><div className="checkrow"><span>Kvote i EV</span><em>Bez feed-a kvota</em></div></div><div className="panel value"><div className="panelhead"><div><h2>Value Scanner</h2><p>Model naspram tržišta</p></div><TrendingUp size={19}/></div><div className="empty"><Target size={25}/><b>Čeka podatke o kvotama</b><p>EV zahteva tačnu tržišnu liniju i validiranu verovatnoću modela.</p></div></div></div></section></>}
    {tab==="Utakmice"&&<div className="panel"><div className="panelhead"><div><h2>Sve utakmice</h2><p>{visible.length} utakmica · {league}</p></div></div><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pretraži tim ili ligu…"/></label>{visible.map(g=><GameRow key={g.id} game={g}/>)}</div>}
    {tab==="Model Rez"&&<Placeholder icon={<Target/>} title="Model Rez — projekcije utakmica" text="Sledeći korak je izgradnja i validacija modela na istorijskim rezultatima, snazi timova, tempu i domaćem terenu. Trenutno se ne prikazuju izmišljene prognoze."/>}
    {tab==="Player Props"&&<Placeholder icon={<Users/>} title="Player Props" text="Za projekcije poena, skokova i asistencija potrebni su istorijski box score podaci, minutaža i status dostupnosti igrača."/>}
    {tab==="Value"&&<Placeholder icon={<TrendingUp/>} title="Value Scanner" text="EV = verovatnoća × kvota − 1. Ne računamo value bez validiranog modela i odgovarajuće tržišne kvote."/>}
    {tab==="Backtest"&&<Placeholder icon={<Activity/>} title="Backtest & kalibracija" text="Čuvaćemo prognoze pre početka meča i porediti ih sa stvarnim ishodima. ROI i tačnost biće prikazani tek kada postoje stvarni testni rezultati."/>}
    {tab==="Data Center"&&<div className="panel"><div className="panelhead"><div><h2>Izvori podataka</h2><p>Automatska provera na pet minuta dok je aplikacija otvorena</p></div><Wifi size={19}/></div>{sources.length?sources.map(s=><div className="source" key={s.name}><div><b>{s.name}</b><p>{s.detail}</p></div><span className={s.status==="Uspeh"?"success":"failure"}>{s.status} · {s.count} zapisa</span></div>):<div className="empty">Provera izvora još traje.</div>}<div className="note"><AlertCircle size={17}/><p>Ovo je početna verzija sa javnim scoreboard feed-ovima. Osvežavanje se trenutno dešava u otvorenom pregledaču; pozadinsko zakazivanje i pouzdan istorijski backfill tek treba postaviti.</p></div></div>}
    <footer> BASKETBALL PROJECTION ENGINE <span>INDEPENDENT BUILD · V0.1</span></footer></div></main></div>;
}
function Metric({title,value,info,icon}){return <div className="metric"><div className="metric-top"><span>{title}</span><i>{icon}</i></div><strong>{value}</strong><small>{info}</small></div>}
function GameRow({game:g}){return <div className="game"><div className="date">{fmtDate(g.date)}</div><div className="teams"><div><span className="badge">{(g.home||"??").split(" ").map(x=>x[0]).slice(0,3).join("")}</span><b>{g.home}</b><strong>{g.homeScore??"—"}</strong></div><div><span className="badge away">{(g.away||"??").split(" ").map(x=>x[0]).slice(0,3).join("")}</span><b>{g.away}</b><strong>{g.awayScore??"—"}</strong></div></div><div className="gameinfo"><span className={g.league==="NBA"?"tag nba":"tag euro"}>{g.league}</span><small className={g.statusCode==="in"?"inplay":g.statusCode==="post"?"final":""}>{g.status}</small></div></div>}
function Placeholder({icon,title,text}){return <div className="panel placeholder"><div className="placeholdericon">{icon}</div><h2>{title}</h2><p>{text}</p></div>}
createRoot(document.getElementById("root")).render(<App/>);