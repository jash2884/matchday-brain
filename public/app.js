const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const team = (n) => n.replace(/\s+(FC|AFC|CF|SC)$/, "").replace(/^(FC|AC|SSC|AS|US)\s+/, "");
const pct = (v) => `${Math.round(v * 100)}%`;
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const pickLabel = { H: "Home win", D: "Draw", A: "Away win" };

let state = { league: localStorageGet("league") || "en.1", tab: "next", data: null };

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

async function init() {
  const leagues = await fetch("/api/leagues").then((r) => r.json());
  $(".leagues").innerHTML = leagues
    .map((l) => `<button class="chip" role="tab" data-code="${l.code}" aria-selected="${l.code === state.league}">${esc(l.name)}</button>`)
    .join("");
  $(".leagues").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.league = b.dataset.code;
    localStorageSet("league", state.league);
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-selected", c === b));
    load();
  });
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) showTab(b.dataset.tab);
  });
  const fromHash = location.hash.slice(1);
  if (["next", "ratings", "accuracy", "how"].includes(fromHash)) state.tab = fromHash;
  showTab(state.tab);
  load();
}

function showTab(tab) {
  state.tab = tab;
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  for (const id of ["next", "ratings", "accuracy", "how"]) $("#tab-" + id).hidden = id !== tab;
}

async function load() {
  $("#status").hidden = false;
  $("#status").textContent = "Crunching ratings…";
  try {
    const res = await fetch(`/api/league/${state.league}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load this league.");
    state.data = data;
    render();
    $("#status").hidden = true;
  } catch (e) {
    $("#status").textContent = `Sorry, ${e.message} Please try again in a minute.`;
  }
}

function render() {
  const d = state.data;
  const notice = $("#notice");
  notice.hidden = false;
  notice.innerHTML = `<strong>${esc(d.league.name)} ${esc(d.season)}</strong> &middot; results in the source data run through <strong>${fmtDate(d.updatedThrough)}</strong>${d.missingResults ? ` (${d.missingResults} earlier result${d.missingResults > 1 ? "s" : ""} not yet recorded)` : ""}. The community dataset can lag behind real life, so "next up" fixtures may already have been played.`;
  renderNext(d);
  renderRatings(d);
  renderAccuracy(d);
}

function form(f) {
  return `<div class="form">${[...(f || "")].map((c) => `<span class="f ${c}">${c}</span>`).join("")}</div>`;
}

function renderNext(d) {
  if (!d.nextUp.length) {
    $("#tab-next").innerHTML = `<div class="card">No upcoming fixtures in the data yet.</div>`;
    return;
  }
  $("#tab-next").innerHTML = `<h2>${esc(d.nextUp[0].round)}</h2><div class="grid">${d.nextUp.map((m) => `
    <article class="card match">
      <div class="meta"><span>${fmtDate(m.date)}</span><span class="pick">${pickLabel[m.pick]}</span></div>
      <div class="teams">
        <div class="t home">${esc(team(m.home))}${form(m.formHome)}</div>
        <span class="vs">vs</span>
        <div class="t away">${esc(team(m.away))}${form(m.formAway)}</div>
      </div>
      <div class="bar" role="img" aria-label="Home ${pct(m.probs.home)}, draw ${pct(m.probs.draw)}, away ${pct(m.probs.away)}">
        <i class="h" style="width:${m.probs.home * 100}%"></i><i class="d" style="width:${m.probs.draw * 100}%"></i><i class="a" style="width:${m.probs.away * 100}%"></i>
      </div>
      <div class="pct"><span>Home <b>${pct(m.probs.home)}</b></span><span>Draw <b>${pct(m.probs.draw)}</b></span><span>Away <b>${pct(m.probs.away)}</b></span></div>
      <p class="why">${esc(m.why)}</p>
    </article>`).join("")}</div>`;
}

function renderRatings(d) {
  const max = d.table[0]?.rating ?? 1600, min = d.table.at(-1)?.rating ?? 1400;
  $("#tab-ratings").innerHTML = `<div class="card"><h2>Power ratings</h2>
    <p class="muted">Current Elo rating for every team in the ${esc(d.season)} season. 1500 is average; a 100-point gap is roughly a 64% expected score on neutral ground.</p>
    <table><thead><tr><th>#</th><th>Team</th><th>Rating</th><th></th></tr></thead><tbody>
    ${d.table.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(team(t.team))}</td><td class="num">${t.rating}</td>
      <td><div class="rbar" style="width:${Math.max(4, ((t.rating - min) / Math.max(1, max - min)) * 100)}%"></div></td></tr>`).join("")}
    </tbody></table></div>`;
}

function renderAccuracy(d) {
  const { metrics, calibration, recent, seasons } = d.evaluation;
  const m = metrics.model, base = metrics.baseRates, home = metrics.alwaysHome;
  const better = (a, b, lowerIsBetter) => ((lowerIsBetter ? a < b : a > b) ? `<span class="better">better</span>` : `<span class="no">worse</span>`);
  $("#tab-accuracy").innerHTML = `
    <p class="muted">Scored on ${m.matches} matches from ${seasons.map(esc).join(" and ")}, seasons the model never saw while its settings were tuned.</p>
    <div class="stats">
      <div class="card stat"><div class="k">Correct picks</div><div class="v">${pct(m.accuracy)}</div>
        <div class="c">vs ${pct(home.accuracy)} for "always pick the home team" (${better(m.accuracy, home.accuracy)})</div></div>
      <div class="card stat"><div class="k">Brier score (lower is better)</div><div class="v">${m.brier.toFixed(3)}</div>
        <div class="c">vs ${base.brier.toFixed(3)} for league-average odds (${better(m.brier, base.brier, true)})</div></div>
      <div class="card stat"><div class="k">Log loss (lower is better)</div><div class="v">${m.logLoss.toFixed(3)}</div>
        <div class="c">vs ${base.logLoss.toFixed(3)} for league-average odds (${better(m.logLoss, base.logLoss, true)})</div></div>
    </div>
    <div class="two">
      <div class="card calib"><h2>Calibration</h2>
        <p class="muted">When the model says 60%, does it happen about 60% of the time? Dots near the dashed line mean honest probabilities. Bigger dots mean more data.</p>
        ${calibChart(calibration)}</div>
      <div class="card recent"><h2>Latest scored predictions</h2><ul>
        ${recent.map((x) => `<li><span>${esc(team(x.home))} ${x.result[0]}&ndash;${x.result[1]} ${esc(team(x.away))}</span>
          <span>${pickLabel[x.pick]} <span class="${x.pick === x.outcome ? "ok" : "no"}">${x.pick === x.outcome ? "&#10003;" : "&#10007;"}</span></span></li>`).join("")}
      </ul></div>
    </div>`;
}

function calibChart(bins) {
  const W = 320, H = 260, P = 34, sx = (v) => P + v * (W - P - 10), sy = (v) => H - P - v * (H - P - 10);
  const maxN = Math.max(...bins.map((b) => b.n));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration chart of forecast probability against observed frequency">
    <line class="axis" x1="${P}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(0)}" /><line class="axis" x1="${P}" y1="${sy(0)}" x2="${P}" y2="${sy(1)}" />
    <line class="diag" x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" />
    ${ticks.map((t) => `<text x="${sx(t)}" y="${H - 14}" text-anchor="middle">${t * 100}%</text><text x="${P - 6}" y="${sy(t) + 4}" text-anchor="end">${t * 100}%</text>`).join("")}
    <text x="${(W + P) / 2}" y="${H - 1}" text-anchor="middle">Model's forecast</text>
    ${bins.map((b) => `<circle class="pt" cx="${sx(b.forecast)}" cy="${sy(b.observed)}" r="${3 + 7 * Math.sqrt(b.n / maxN)}"><title>Forecast ${pct(b.forecast)}, happened ${pct(b.observed)} (${b.n} outcomes)</title></circle>`).join("")}
  </svg>`;
}

init().catch((e) => { $("#status").textContent = `Sorry, the app failed to start: ${e.message}`; });
