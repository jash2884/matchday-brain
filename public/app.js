const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (n) => String(n).replace(/\s+(FC|AFC|CF|SC)$/, "").replace(/^(FC|AC|SSC|AS|US)\s+/, "");
const pct = (v) => `${Math.round(v * 100)}%`;
const fmtDate = (d) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");

const SPORT_META = {
  football: { icon: "⚽", label: "Football" },
  cricket: { icon: "🏏", label: "Cricket" },
  nfl: { icon: "🏈", label: "NFL" },
};
const COMING_SOON = [{ icon: "🎾", label: "Tennis" }, { icon: "🏀", label: "NBA" }];
const VIEWS = ["predictions", "h2h", "ratings", "record", "method"];

const state = { catalog: null, sport: "football", comp: null, view: "predictions", snap: null, cache: new Map() };

// ---------- routing: #/sport/competition/view ----------
function readHash() {
  const [, sport, comp, view] = location.hash.split("/");
  return { sport, comp, view };
}
function writeHash() {
  const next = `#/${state.sport}/${state.comp}/${state.view}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

async function getJson(url) {
  if (state.cache.has(url)) return state.cache.get(url);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  state.cache.set(url, data);
  return data;
}

function showError(msg) {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

// ---------- boot ----------
async function init() {
  try {
    state.catalog = await getJson("/api/v1/catalog");
  } catch (e) {
    showError(`Could not load the catalogue: ${e.message}`);
    return;
  }
  const h = readHash();
  const sport = state.catalog.sports.find((s) => s.id === h.sport) ?? state.catalog.sports[0];
  state.sport = sport.id;
  state.comp = sport.competitions.some((c) => c.id === h.comp) ? h.comp : firstOk(sport).id;
  state.view = VIEWS.includes(h.view) ? h.view : "predictions";

  $(".views").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) { state.view = b.dataset.view; writeHash(); renderView(); }
  });
  addEventListener("hashchange", () => {
    const h2 = readHash();
    if (h2.sport !== state.sport || h2.comp !== state.comp) { state.sport = h2.sport; state.comp = h2.comp; loadCompetition(); }
    else if (h2.view && h2.view !== state.view) { state.view = h2.view; renderView(); }
  });
  renderSports();
  loadCompetition();
}

const firstOk = (sport) => sport.competitions.find((c) => c.ok) ?? sport.competitions[0];

function renderSports() {
  const nav = $(".sports");
  nav.innerHTML =
    state.catalog.sports.map((s) => `<button class="sport" data-sport="${s.id}" aria-current="${s.id === state.sport}">${SPORT_META[s.id]?.icon ?? ""} ${esc(SPORT_META[s.id]?.label ?? s.name)}</button>`).join("") +
    COMING_SOON.map((s) => `<button class="sport" disabled title="Coming soon">${s.icon} ${s.label} <small>soon</small></button>`).join("");
  nav.onclick = (e) => {
    const b = e.target.closest("button[data-sport]");
    if (!b) return;
    const sport = state.catalog.sports.find((s) => s.id === b.dataset.sport);
    state.sport = sport.id;
    state.comp = firstOk(sport).id;
    loadCompetition();
  };
}

function renderComps() {
  const sport = state.catalog.sports.find((s) => s.id === state.sport);
  $("#comps").innerHTML = sport.competitions
    .map((c) => `<button class="comp" role="tab" data-comp="${c.id}" aria-selected="${c.id === state.comp}" ${c.ok ? "" : 'disabled title="Data temporarily unavailable"'}>${esc(c.short)}</button>`)
    .join("");
  $("#comps").onclick = (e) => {
    const b = e.target.closest("button[data-comp]");
    if (b && !b.disabled) { state.comp = b.dataset.comp; loadCompetition(); }
  };
}

async function loadCompetition() {
  document.body.dataset.sport = state.sport;
  document.querySelectorAll(".sport[data-sport]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.sport === state.sport)));
  renderComps();
  writeHash();
  showError("");
  $("#view").innerHTML = `<div class="grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  try {
    state.snap = await getJson(`/api/v1/${state.sport}/${state.comp}`);
  } catch (e) {
    showError(`Could not load this competition: ${e.message}`);
    $("#view").innerHTML = "";
    return;
  }
  renderHeader();
  renderTicker();
  renderView();
}

function renderHeader() {
  const s = state.snap;
  $("#comp-region").textContent = `${SPORT_META[s.sport]?.label ?? s.sport} · ${s.competition.region ?? ""}`;
  $("#comp-name").textContent = s.competition.name;
  const m = s.evaluation.metrics.model;
  $("#comp-meta").innerHTML = `<span>Results through <b>${fmtDate(s.updatedThrough)}</b></span><span>Track record <b>${pct(m.accuracy)}</b> correct on ${m.matches.toLocaleString()} unseen matches</span><span>${s.table.length} teams rated</span>`;
  $("#foot-source").innerHTML = `Data: <a href="${esc(s.source.url)}">${esc(s.source.name)}</a> (${esc(s.source.licence)})`;
  document.title = `${s.competition.name} predictions · Matchday Brain`;
}

function renderTicker() {
  const items = state.snap.evaluation.recent.slice(0, 14).map((x) => {
    const res = x.score ? `${x.score[0]}–${x.score[1]}` : x.outcome === "D" ? "draw" : "";
    const hit = x.pick === x.outcome;
    return `<span class="tick"><b>${esc(short(x.home))}</b> ${esc(res || "v")} <b>${esc(short(x.away))}</b> · model <span class="${hit ? "ok" : "no"}">${hit ? "✓" : "✗"}</span></span>`;
  });
  $("#ticker").innerHTML = items.join("") || `<span class="tick">No recent results</span>`;
}

function renderView() {
  document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.view === state.view)));
  const v = state.view;
  if (v === "predictions") return renderPredictions();
  if (v === "h2h") return renderH2H();
  if (v === "ratings") return renderRatings();
  if (v === "record") return renderRecord();
  return renderMethod();
}

// ---------- shared pieces ----------
const form = (f) => `<div class="form">${[...(f || "")].map((c) => `<span class="f ${c}">${c}</span>`).join("")}</div>`;
function probBlocks(p, hasDraws, homeName, awayName) {
  const max = Math.max(p.home, p.draw, p.away);
  const cell = (k, v) => `<div class="prob ${v === max ? "top" : ""}"><div class="k">${k}</div><div class="v">${pct(v)}</div></div>`;
  const bar = `<div class="bar" role="img" aria-label="${esc(homeName)} ${pct(p.home)}${hasDraws ? `, draw ${pct(p.draw)}` : ""}, ${esc(awayName)} ${pct(p.away)}"><i class="h" style="width:${p.home * 100}%"></i>${hasDraws ? `<i class="d" style="width:${p.draw * 100}%"></i>` : ""}<i class="a" style="width:${p.away * 100}%"></i></div>`;
  return `<div class="probs ${hasDraws ? "" : "two"}">${cell(esc(short(homeName)), p.home)}${hasDraws ? cell("Draw", p.draw) : ""}${cell(esc(short(awayName)), p.away)}</div>${bar}`;
}
function board(x, s, extra = "") {
  const venue = s.hasHomeAdvantage && !x.neutral ? "Home" : "Neutral";
  return `<article class="panel board">
    <div class="board-top"><span>${esc(x.label || "")}${x.label ? " · " : ""}${fmtDate(x.date)}</span><span class="pill">${venue === "Home" ? "HOME EDGE" : "NEUTRAL"}</span></div>
    <div class="sides">
      <div class="side"><div class="name">${esc(short(x.home))}</div><div class="rt">Elo <b>${x.ratingHome}</b></div>${form(x.formHome)}</div>
      <div class="vs">VS</div>
      <div class="side right"><div class="name">${esc(short(x.away))}</div><div class="rt">Elo <b>${x.ratingAway}</b></div>${form(x.formAway)}</div>
    </div>
    ${probBlocks(x.probs, s.hasDraws, x.home, x.away)}
    ${x.why ? `<p class="why">${esc(x.why)}</p>` : ""}${extra}
  </article>`;
}

// ---------- views ----------
function renderPredictions() {
  const s = state.snap;
  if (!s.nextUp.length) {
    $("#view").innerHTML = `<div class="panel empty">
      <h3>No upcoming fixtures in the open data</h3>
      <p class="muted">${esc(s.source.name)} publishes results, not future schedules, for ${esc(s.competition.name)}. Use the head-to-head predictor to forecast any match-up from the latest ratings.</p>
      <button class="btn" data-go="h2h">Open head-to-head</button></div>`;
    $("#view").querySelector("[data-go]").onclick = () => { state.view = "h2h"; writeHash(); renderView(); };
    return;
  }
  const lagNote = s.missingResults ? ` · ${s.missingResults} earlier result${s.missingResults > 1 ? "s" : ""} not yet in the source` : "";
  $("#view").innerHTML = `<h2 class="section-title">${esc(s.nextUp[0].label || "Next up")} <small>Forecasts from ratings as of ${fmtDate(s.updatedThrough)}${lagNote}</small></h2>
    <div class="grid">${s.nextUp.map((x) => board(x, s)).join("")}</div>`;
}

function renderH2H() {
  const s = state.snap;
  const teams = [...s.table].sort((a, b) => a.team.localeCompare(b.team));
  const opts = (sel) => teams.map((t) => `<option ${t.team === sel ? "selected" : ""}>${esc(t.team)}</option>`).join("");
  const a = s.table[0]?.team, b = s.table[1]?.team;
  $("#view").innerHTML = `<div class="panel">
      <h2 class="section-title">Head-to-head <small>Any two teams, from the latest ratings</small></h2>
      <form class="h2h-form" id="h2h">
        <label class="fld">${s.hasHomeAdvantage ? "Home" : "Team A"}<select name="home">${opts(a)}</select></label>
        <div class="vs" style="padding-bottom:14px">VS</div>
        <label class="fld">${s.hasHomeAdvantage ? "Away" : "Team B"}<select name="away">${opts(b)}</select></label>
        <button class="btn" type="submit">Predict</button>
      </form>
      ${s.hasHomeAdvantage ? `<label class="check" style="margin-top:12px"><input type="checkbox" name="neutral" form="h2h"> Neutral venue (no home advantage)</label>` : ""}
    </div><div id="h2h-out" style="margin-top:14px"></div>`;
  const run = async (e) => {
    e?.preventDefault();
    const f = new FormData($("#h2h"));
    const q = new URLSearchParams({ home: f.get("home"), away: f.get("away") });
    if (f.get("neutral")) q.set("neutral", "1");
    try {
      const r = await getJson(`/api/v1/${state.sport}/${state.comp}/predict?${q}`);
      $("#h2h-out").innerHTML = board({ ...r, date: r.basedOn, label: "Forecast", formHome: "", formAway: "" }, { ...s, hasHomeAdvantage: s.hasHomeAdvantage && !r.neutral });
    } catch (err) {
      $("#h2h-out").innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  };
  $("#h2h").onsubmit = run;
  run();
}

function renderRatings() {
  const s = state.snap;
  const max = s.table[0]?.rating ?? 1600, min = s.table.at(-1)?.rating ?? 1400;
  $("#view").innerHTML = `<div class="panel"><h2 class="section-title">Power ratings <small>1500 is average · change since the start of the season</small></h2>
    <table><thead><tr><th>#</th><th>Team</th><th>Elo</th><th>Season</th><th class="hide-sm"></th></tr></thead><tbody>
    ${s.table.map((t, i) => `<tr><td class="rank">${i + 1}</td><td class="team">${esc(short(t.team))}</td><td class="num"><b>${t.rating}</b></td>
      <td class="num ${t.change > 0 ? "up" : t.change < 0 ? "down" : ""}">${t.change > 0 ? "▲" : t.change < 0 ? "▼" : "•"} ${Math.abs(t.change)}</td>
      <td style="width:40%"><div class="rbar" style="width:${Math.max(3, ((t.rating - min) / Math.max(1, max - min)) * 100)}%"></div></td></tr>`).join("")}
    </tbody></table></div>`;
}

function renderRecord() {
  const s = state.snap, ev = s.evaluation, m = ev.metrics.model, base = ev.metrics.baseRates, home = ev.metrics.alwaysHome;
  const cmp = (a, b, lower) => ((lower ? a < b : a > b) ? `<span class="better">better</span>` : `<span class="worse">worse</span>`);
  $("#view").innerHTML = `
    <p class="muted" style="margin-top:0">Scored on <b>${m.matches.toLocaleString()}</b> matches from ${esc(ev.window)}, which the model never saw while its settings were tuned. Every forecast used only results from before the match.</p>
    <div class="stats">
      <div class="panel stat"><div class="k">Correct picks</div><div class="v">${pct(m.accuracy)}</div>
        <div class="c">${home ? `vs ${pct(home.accuracy)} for “always pick the home side” (${cmp(m.accuracy, home.accuracy)})` : `vs ${pct(base.accuracy)} for the base-rate baseline (${cmp(m.accuracy, base.accuracy)})`}</div></div>
      <div class="panel stat"><div class="k">Brier score · lower is better</div><div class="v">${m.brier.toFixed(3)}</div>
        <div class="c">vs ${base.brier.toFixed(3)} for historical average odds (${cmp(m.brier, base.brier, true)})</div></div>
      <div class="panel stat"><div class="k">Log loss · lower is better</div><div class="v">${m.logLoss.toFixed(3)}</div>
        <div class="c">vs ${base.logLoss.toFixed(3)} for historical average odds (${cmp(m.logLoss, base.logLoss, true)})</div></div>
    </div>
    <div class="two-col">
      <div class="panel calib"><h2 class="section-title">Calibration <small>Does 60% happen 60% of the time?</small></h2>${calib(ev.calibration)}</div>
      <div class="panel"><h2 class="section-title">Latest calls</h2><ul class="results">
        ${ev.recent.map((x) => {
          const res = x.score ? `${x.score[0]}–${x.score[1]}` : x.outcome === "D" ? "Draw" : "";
          const pickName = x.pick === "H" ? short(x.home) : x.pick === "A" ? short(x.away) : "Draw";
          return `<li><span>${esc(short(x.home))} ${esc(res || "v")} ${esc(short(x.away))}<div class="sub">${esc(x.detail || fmtDate(x.date))}</div></span>
            <span>${esc(pickName)} <span class="${x.pick === x.outcome ? "ok" : "no"}">${x.pick === x.outcome ? "✓" : "✗"}</span></span></li>`;
        }).join("")}
      </ul></div>
    </div>`;
}

function calib(bins) {
  const W = 340, H = 270, P = 36, sx = (v) => P + v * (W - P - 10), sy = (v) => H - P - v * (H - P - 10);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration: forecast probability against observed frequency">
    <line class="axis" x1="${P}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(0)}"/><line class="axis" x1="${P}" y1="${sy(0)}" x2="${P}" y2="${sy(1)}"/>
    <line class="diag" x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}"/>
    ${[0, 0.5, 1].map((t) => `<text x="${sx(t)}" y="${H - 16}" text-anchor="middle">${t * 100}%</text><text x="${P - 6}" y="${sy(t) + 4}" text-anchor="end">${t * 100}%</text>`).join("")}
    <text x="${(W + P) / 2}" y="${H - 2}" text-anchor="middle">Forecast probability</text>
    ${bins.map((b) => `<circle class="pt" cx="${sx(b.forecast)}" cy="${sy(b.observed)}" r="${3 + 8 * Math.sqrt(b.n / maxN)}"><title>Forecast ${pct(b.forecast)} · happened ${pct(b.observed)} · ${b.n} outcomes</title></circle>`).join("")}
  </svg>`;
}

function renderMethod() {
  const s = state.snap, p = s.params;
  $("#view").innerHTML = `<div class="panel prose">
    <h2 class="section-title">How it works</h2>
    <h3>Ratings</h3><p>Each team has an Elo rating. After every result the winner takes rating points from the loser; upsets move ratings most. ${s.hasHomeAdvantage ? `Home sides get a ${p.home}-point boost.` : "Matches are treated as neutral (no home advantage)."} ${p.mov === "none" ? "" : "Bigger winning margins move ratings more."}</p>
    <h3>Probabilities</h3><p>The rating gap becomes an expected result, ${s.hasDraws ? "split into win, draw and loss, with draws most likely between evenly matched sides." : "converted into a win probability for each side."}</p>
    <h3>No hindsight</h3><p>Every forecast uses only matches before it, exactly as if it had been made on the day. Settings are tuned on earlier seasons only; the track record is scored on later seasons the model never saw during tuning.</p>
    <h3>This competition's settings</h3><pre>${esc(JSON.stringify(p, null, 2))}</pre>
    <h3>Public API</h3><p>Free, read-only, CORS-enabled JSON:</p>
<pre>GET /api/v1/catalog
GET /api/v1/${esc(s.sport)}/${esc(s.competition.id)}
GET /api/v1/${esc(s.sport)}/${esc(s.competition.id)}/predict?home=…&amp;away=…</pre>
    <h3>Data</h3><p><a href="${esc(s.source.url)}">${esc(s.source.name)}</a>, licensed ${esc(s.source.licence)}. Snapshots refresh every 6 hours; community datasets can lag behind real life.</p>
  </div>`;
}

init();
