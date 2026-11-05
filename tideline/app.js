// Tideline demo app: play-money margin trading on live prices.

const MARKETS = [
  { id: "bitcoin", sym: "BTC", name: "Bitcoin" },
  { id: "ethereum", sym: "ETH", name: "Ethereum" },
  { id: "solana", sym: "SOL", name: "Solana" },
  { id: "binancecoin", sym: "BNB", name: "BNB" },
  { id: "ripple", sym: "XRP", name: "XRP" },
  { id: "avalanche-2", sym: "AVAX", name: "Avalanche" },
  { id: "chainlink", sym: "LINK", name: "Chainlink" },
  { id: "sui", sym: "SUI", name: "Sui" },
  { id: "dogecoin", sym: "DOGE", name: "Dogecoin" },
];
const FALLBACK = {
  bitcoin: [68420, 1.2], ethereum: [3510, -0.6], solana: [172.4, 3.1], binancecoin: [598, 0.4],
  ripple: [0.62, -1.4], "avalanche-2": [36.2, 2.2], chainlink: [17.8, 0.9], sui: [1.92, 4.6], dogecoin: [0.16, 1.7],
};

const START_HOLDINGS = {
  Solana: { asset: "SOL", amount: 25, priceId: "solana" },
  Bitcoin: { asset: "BTC", amount: 0.05, priceId: "bitcoin" },
  Arbitrum: { asset: "ETH", amount: 1.2, priceId: "ethereum" },
  Base: { asset: "USDC", amount: 1500, priceId: null },
};

const MAX_LEV = 5;
const FEE_RATE = 0.0005;
const LIQ_LOSS = 0.9; // a position is liquidated once it has lost 90% of its margin
const STORE_KEY = "tideline-demo-v1";

// ---------- State ----------
let state = load() || freshState();
// Sample prices for display until TidePrices returns real ones (trading stays locked until then)
let prices = Object.fromEntries(Object.entries(FALLBACK).map(([id, [usd, chg]]) => [id, { usd, chg }]));
let pricesLive = false;
const PRICES_DOWN = "Live prices are unavailable right now. Try again in a minute.";
let selected = "bitcoin";
let side = 1;
let chartDays = 1;

function freshState() {
  return { wallet: null, collateral: 0, positions: [], history: [] };
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: demo still works for this visit */ }
}

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const market = (id) => MARKETS.find((m) => m.id === id);
const price = (id) => (id ? prices[id].usd : 1);

const usd = (n, signed = false) => {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "−$" : signed && n > 0 ? "+$" : "$") + s;
};
const px = (n) => "$" + n.toLocaleString("en-US", {
  minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : n < 100 ? 3 : 2,
});
const qtyFmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const timeStr = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- Account math ----------
// Play-money collateral plus any real test USDC held in TideVault
const totalCollateral = () => state.collateral + TideChain.toNumber(TideChain.state.vaultUsdc);
const pnlOf = (p) => Math.max(p.side * p.qty * (price(p.coin) - p.entry), -p.margin);
const liqPrice = (entry, s, lev) => entry * (1 - s * (LIQ_LOSS / lev));

function account() {
  const upnl = state.positions.reduce((a, p) => a + pnlOf(p), 0);
  const used = state.positions.reduce((a, p) => a + p.margin, 0);
  const equity = totalCollateral() + upnl;
  const free = Math.max(0, equity - used);
  const health = used === 0 ? 100 : Math.max(0, Math.min(100, 100 * (1 - (used * LIQ_LOSS * 0.5) / Math.max(equity, 1e-9))));
  return { upnl, used, equity, free, power: free * MAX_LEV, health };
}

// ---------- Prices ----------
async function loadPrices() {
  const { data, live } = await TidePrices.get();
  if (data) for (const m of MARKETS) if (data[m.id]) prices[m.id] = data[m.id];
  pricesLive = !!data && live;
  $("demo-banner").textContent = `Test network only · no real money · ${pricesLive ? "prices are live from CoinGecko" : "live prices unavailable, showing sample prices"}`;
  // Never liquidate on stale or sample prices
  if (pricesLive) checkLiquidations();
  render();
}

function checkLiquidations() {
  const hit = state.positions.filter((p) => p.side * (price(p.coin) - p.liq) <= 0);
  hit.forEach((p) => closePosition(p.id, true));
}

// ---------- Rendering ----------
function render() {
  const connected = !!state.wallet;
  $("gate").hidden = connected;
  $("app").hidden = !connected;
  $("reset-btn").hidden = !connected;
  const cb = $("connect-btn");
  if (connected) {
    cb.className = "addr";
    cb.innerHTML = `<i></i>${state.wallet.address.slice(0, 6)}…${state.wallet.address.slice(-4)}`;
    cb.title = "Demo wallet";
  } else {
    cb.className = "btn btn-primary btn-sm";
    cb.textContent = "Connect demo wallet";
  }
  if (!connected) return;

  renderAccount();
  renderVault();
  renderMarkets();
  renderChartHead();
  renderTicket();
  renderTabs();
}

function renderAccount() {
  const a = account();
  $("a-equity").textContent = usd(a.equity);
  $("a-pnl").textContent = usd(a.upnl, true);
  $("a-pnl").className = cls(a.upnl);
  $("a-used").textContent = usd(a.used);
  $("a-power").textContent = usd(a.power);
  const bar = $("a-health");
  bar.style.width = a.health + "%";
  bar.style.background = a.health > 60 ? "var(--up)" : a.health > 30 ? "var(--warn)" : "var(--down)";
  $("a-health-label").textContent =
    totalCollateral() === 0 && !state.positions.length ? "Deposit to start"
      : `${a.health > 60 ? "Healthy" : a.health > 30 ? "Caution" : "At risk"} · ${Math.round(a.health)}%`;
}

function renderMarkets() {
  $("market-list").innerHTML = MARKETS.map((m) => {
    const p = prices[m.id];
    return `<li><button class="mkt ${m.id === selected ? "active" : ""}" data-id="${m.id}">
      <b>${m.sym}</b><span class="px">${px(p.usd)}</span>
      <span class="name">${m.name}</span><span class="chg ${cls(p.chg)}">${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(2)}%</span>
    </button></li>`;
  }).join("");
}

function renderChartHead() {
  const m = market(selected);
  const p = prices[selected];
  $("c-name").textContent = `${m.name} · ${m.sym}-PERP`;
  $("c-price").textContent = px(p.usd);
  $("c-change").textContent = `${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(2)}% 24h` + (pricesLive ? "" : " · waiting for live price");
  $("c-change").className = cls(p.chg);
}

function ticketInputs() {
  const margin = parseFloat($("t-margin").value) || 0;
  const lev = parseInt($("t-lev").value, 10);
  return { margin, lev, size: margin * lev, fee: margin * lev * FEE_RATE };
}

function renderTicket() {
  const { lev, size, fee } = ticketInputs();
  const entry = price(selected);
  const sym = market(selected).sym;
  $("t-lev-label").textContent = lev + "×";
  $("t-size").textContent = usd(size);
  $("t-entry").textContent = px(entry);
  $("t-liq").textContent = px(liqPrice(entry, side, lev));
  $("t-fee").textContent = usd(fee);
  const btn = $("t-submit");
  btn.textContent = `${side > 0 ? "Long" : "Short"} ${sym}`;
  btn.classList.toggle("short-mode", side < 0);
  document.querySelectorAll(".side-toggle button").forEach((b) => b.classList.toggle("active", +b.dataset.side === side));
  $("t-error").textContent = totalCollateral() === 0 && !state.positions.length ? "Deposit collateral to place trades." : "";
}

function renderTabs() {
  $("pos-count").textContent = state.positions.length;

  $("tab-open").innerHTML = state.positions.length
    ? `<table><thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>P&amp;L</th><th></th></tr></thead><tbody>${
        state.positions.map((p) => {
          const pnl = pnlOf(p);
          const m = market(p.coin);
          return `<tr>
            <td>${m.sym}</td>
            <td><span class="pill ${p.side > 0 ? "long" : "short"}">${p.side > 0 ? "LONG" : "SHORT"} ${p.lev}×</span></td>
            <td>${qtyFmt(p.qty)} ${m.sym}</td>
            <td>${px(p.entry)}</td>
            <td>${px(price(p.coin))}</td>
            <td>${px(p.liq)}</td>
            <td class="${cls(pnl)}">${usd(pnl, true)} <small>(${((pnl / p.margin) * 100).toFixed(1)}%)</small></td>
            <td><button class="close-btn" data-close="${p.id}">Close</button></td>
          </tr>`;
        }).join("")
      }</tbody></table>`
    : `<p class="empty">No open positions. Pick a market and place a trade.</p>`;

  $("tab-history").innerHTML = state.history.length
    ? `<table><thead><tr><th>Time</th><th>Event</th><th>Amount</th></tr></thead><tbody>${
        state.history.slice().reverse().map((h) =>
          `<tr><td>${timeStr(h.t)}</td><td>${h.text}</td><td class="${h.amount != null ? cls(h.amount) : ""}">${h.amount != null ? usd(h.amount, true) : ""}</td></tr>`
        ).join("")
      }</tbody></table>`
    : `<p class="empty">Nothing yet.</p>`;

  const rows = Object.entries(state.wallet.holdings).map(([chain, h]) =>
    `<tr><td>${chain}</td><td>${qtyFmt(h.amount)} ${h.asset}</td><td>${usd(h.amount * price(h.priceId))}</td></tr>`
  ).join("");
  $("tab-wallet").innerHTML =
    `<table><thead><tr><th>Chain</th><th>Balance</th><th>Value</th></tr></thead><tbody>${rows}
     <tr><td>Tideline account</td><td>${usd(state.collateral)} USDC</td><td>${usd(state.collateral)}</td></tr>${
       TideChain.state.account ? `<tr><td>TideVault (Sepolia)</td><td>${TideChain.format(TideChain.state.vaultUsdc)} mUSDC</td><td>${usd(TideChain.toNumber(TideChain.state.vaultUsdc))}</td></tr>` : ""
     }</tbody></table>`;
}

// ---------- Onchain vault panel ----------
function renderVault() {
  const c = TideChain.state;
  const typed = $("v-amount")?.value ?? "";
  let body;
  if (!c.hasWallet) {
    body = `<p class="v-note">No browser wallet is available on this page. To use the vault, install <a href="https://metamask.io" target="_blank" rel="noopener">MetaMask</a> in Chrome and open the app with run-site.cmd from the Tideline folder.</p>`;
  } else if (!c.account) {
    body = `<button class="btn btn-primary btn-sm" data-v="connect">Connect MetaMask</button>`;
  } else if (!c.onSepolia) {
    body = `<p class="v-note">Your wallet is on a different network. This panel only works on the Sepolia test network.</p>
            <button class="btn btn-primary btn-sm" data-v="switch">Switch to Sepolia</button>`;
  } else {
    const wait = c.nextFaucet - Date.now() / 1000;
    const hours = Math.ceil(wait / 3600);
    const off = c.busy ? "disabled" : "";
    body = `<div class="v-row">
      <div class="v-stat"><small>Wallet</small><strong>${c.account.slice(0, 6)}…${c.account.slice(-4)}</strong></div>
      <div class="v-stat"><small>Wallet mUSDC</small><strong>${TideChain.format(c.walletUsdc)}</strong></div>
      <div class="v-stat"><small>In vault</small><strong class="up">${TideChain.format(c.vaultUsdc)}</strong></div>
      <div class="v-stat"><small>SepoliaETH</small><strong>${(Number(c.eth) / 1e18).toFixed(4)}</strong></div>
      <div class="v-actions">
        <button class="btn btn-ghost btn-sm" data-v="claim" ${off} ${wait > 0 ? "disabled" : ""}>${wait > 0 ? `Claim again in ${hours}h` : "Claim 10,000 mUSDC"}</button>
        <div class="input-wrap"><input id="v-amount" type="text" inputmode="decimal" placeholder="Amount" aria-label="Amount in mUSDC" autocomplete="off"></div>
        <button class="btn btn-primary btn-sm" data-v="deposit" ${off}>Deposit</button>
        <button class="btn btn-ghost btn-sm" data-v="withdraw" ${off}>Withdraw</button>
      </div>
    </div>`;
  }
  $("v-body").innerHTML = body;
  if ($("v-amount")) $("v-amount").value = typed;
  $("v-busy").textContent = c.busy;
  $("v-error").textContent = c.error;
  $("v-txs").innerHTML = c.txs.map((t) =>
    `<li>${t.label}: <a href="${TideChain.EXPLORER}/tx/${t.hash}" target="_blank" rel="noopener">${t.hash.slice(0, 10)}…${t.hash.slice(-6)} ↗</a></li>`
  ).join("");
}

function vaultError(msg) {
  TideChain.state.error = msg;
  renderVault();
}

function vaultAction(action) {
  if (action === "connect") return TideChain.connect();
  if (action === "switch") return TideChain.switchChain();
  if (action === "claim") return TideChain.claim();
  const units = TideChain.parseAmount($("v-amount").value);
  if (!units) return vaultError("Enter an amount of mUSDC, with up to 6 decimal places.");
  if (action === "deposit") return TideChain.deposit(units);
  if (units > TideChain.state.vaultUsdc) return vaultError(`The vault only holds ${TideChain.format(TideChain.state.vaultUsdc)} mUSDC for you.`);
  if (TideChain.toNumber(units) > account().free + 1e-9) return vaultError(`Only ${usd(account().free)} is free. The rest is backing open positions.`);
  return TideChain.withdraw(units);
}

// ---------- Chart ----------
async function loadChart() {
  const key = `${selected}-${chartDays}`;
  let points = await TidePrices.history(selected, chartDays);
  let note = "";
  if (!points) {
    points = sampleSeries(price(selected), chartDays);
    note = "Sample chart: live history unavailable right now";
  }
  if (key !== `${selected}-${chartDays}`) return; // user switched while loading
  drawChart(points);
  $("chart-note").textContent = note;
}

// Random walk ending at the current price, used only when the history API fails
function sampleSeries(last, days) {
  const n = 120;
  const step = (days * 864e5) / n;
  const out = [];
  let v = last;
  for (let i = n; i >= 0; i--) {
    out.unshift([Date.now() - (n - i) * step, v]);
    v *= 1 + (Math.random() - 0.5) * 0.012;
  }
  return out;
}

function drawChart(points) {
  const svg = $("chart");
  const w = svg.clientWidth || 600;
  const h = svg.clientHeight || 280;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const vals = points.map((p) => p[1]);
  const entries = state.positions.filter((p) => p.coin === selected);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.08 || max * 0.01;
  min -= pad; max += pad;
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => h - 18 - ((v - min) / (max - min)) * (h - 30);

  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "var(--up)" : "var(--down)";
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");

  const gridLines = [0.25, 0.5, 0.75].map((f) => {
    const v = min + (max - min) * f;
    return `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.05)"/>
            <text x="${w - 4}" y="${y(v) - 4}" text-anchor="end" fill="#5d726c" font-size="10" font-family="JetBrains Mono">${px(v)}</text>`;
  }).join("");

  const entryLines = entries.filter((p) => p.entry > min && p.entry < max).map((p) =>
    `<line x1="0" x2="${w}" y1="${y(p.entry)}" y2="${y(p.entry)}" stroke="${p.side > 0 ? "var(--up)" : "var(--down)"}" stroke-dasharray="4 4" opacity="0.7"/>
     <text x="4" y="${y(p.entry) - 4}" fill="${p.side > 0 ? "var(--up)" : "var(--down)"}" font-size="10" font-family="JetBrains Mono">${p.side > 0 ? "LONG" : "SHORT"} entry</text>`
  ).join("");

  svg.innerHTML = `
    <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${up ? "#2fe3b0" : "#ff6b6b"}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${up ? "#2fe3b0" : "#ff6b6b"}" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridLines}
    <path d="${line}L${w},${h}L0,${h}Z" fill="url(#fill)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
    ${entryLines}
    <line id="cross" y1="0" y2="${h}" stroke="rgba(255,255,255,0.25)" visibility="hidden"/>
    <circle id="dot" r="4" fill="${color}" visibility="hidden"/>`;

  const tip = $("chart-tip");
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, i))];
    const cx = x(points.indexOf(p));
    svg.querySelector("#cross").setAttribute("x1", cx);
    svg.querySelector("#cross").setAttribute("x2", cx);
    svg.querySelector("#cross").setAttribute("visibility", "visible");
    const dot = svg.querySelector("#dot");
    dot.setAttribute("cx", cx); dot.setAttribute("cy", y(p[1])); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.style.left = (cx / w) * r.width + "px";
    const d = new Date(p[0]);
    tip.textContent = `${px(p[1])} · ${chartDays === 1 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString()}`;
  };
  svg.onmouseleave = () => {
    tip.hidden = true;
    svg.querySelector("#cross")?.setAttribute("visibility", "hidden");
    svg.querySelector("#dot")?.setAttribute("visibility", "hidden");
  };
}

// ---------- Actions ----------
function connect() {
  const hex = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  state.wallet = { address: "0x" + hex, holdings: structuredClone(START_HOLDINGS) };
  state.history.push({ t: Date.now(), text: "Demo wallet connected" });
  save();
  render();
  loadChart();
  toast("Demo wallet connected with play-money balances");
}

function placeOrder() {
  const { margin, lev, size, fee } = ticketInputs();
  const a = account();
  const err = $("t-error");
  if (!pricesLive) return (err.textContent = PRICES_DOWN);
  if (margin <= 0) return (err.textContent = "Enter a margin amount.");
  if (margin + fee > a.free + 1e-9) return (err.textContent = `Not enough free collateral. Max margin at ${lev}×: ${usd(a.free / (1 + lev * FEE_RATE))}.`);

  const entry = price(selected);
  const m = market(selected);
  state.collateral -= fee;
  state.positions.push({
    id: Date.now().toString(36),
    coin: selected, side, lev, margin, entry,
    qty: size / entry,
    liq: liqPrice(entry, side, lev),
    t: Date.now(),
  });
  state.history.push({ t: Date.now(), text: `Opened ${side > 0 ? "long" : "short"} ${m.sym} ${lev}× · ${usd(size)} at ${px(entry)}`, amount: -fee });
  save();
  render();
  loadChart();
  showTab("open");
  toast(`${side > 0 ? "Long" : "Short"} ${m.sym} opened`);
}

function closePosition(id, liquidated = false) {
  const p = state.positions.find((q) => q.id === id);
  if (!p) return;
  if (!pricesLive) return toast(PRICES_DOWN);
  const pnl = pnlOf(p);
  const sym = market(p.coin).sym;
  state.collateral += pnl;
  state.positions = state.positions.filter((q) => q.id !== id);
  state.history.push({ t: Date.now(), text: `${liquidated ? "Liquidated" : "Closed"} ${p.side > 0 ? "long" : "short"} ${sym} at ${px(price(p.coin))}`, amount: pnl });
  save();
  if (!liquidated) {
    render();
    loadChart();
    toast(`Closed ${sym}: ${usd(pnl, true)}`);
  } else {
    toast(`${sym} position was liquidated`);
  }
}

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["open", "history", "wallet"].forEach((t) => ($("tab-" + t).hidden = t !== name));
}

// ---------- Deposit (Tide Flow) ----------
let depChain = "Base";

function openDeposit() {
  $("dep-pick").hidden = false;
  $("dep-progress").hidden = true;
  $("dep-error").textContent = "";
  const firstWithFunds = Object.keys(state.wallet.holdings).find((c) => state.wallet.holdings[c].amount > 0);
  depChain = state.wallet.holdings[depChain]?.amount > 0 ? depChain : firstWithFunds || "Base";
  renderSources();
  $("dep-amount").value = "";
  updateQuote();
  $("deposit-modal").showModal();
}

function renderSources() {
  $("dep-sources").innerHTML = Object.entries(state.wallet.holdings).map(([chain, h]) =>
    `<button type="button" class="src ${chain === depChain ? "active" : ""}" data-chain="${chain}">
      <b>${h.asset} on ${chain}</b><small>${qtyFmt(h.amount)} · ${usd(h.amount * price(h.priceId))}</small>
    </button>`
  ).join("");
  const h = state.wallet.holdings[depChain];
  $("dep-avail").textContent = `Available: ${qtyFmt(h.amount)} ${h.asset}`;
}

function updateQuote() {
  const h = state.wallet.holdings[depChain];
  const amt = parseFloat($("dep-amount").value) || 0;
  $("dep-usd").textContent = usd(amt * price(h.priceId));
}

function runDeposit() {
  const h = state.wallet.holdings[depChain];
  const amt = parseFloat($("dep-amount").value) || 0;
  if (!pricesLive && h.priceId) return ($("dep-error").textContent = PRICES_DOWN);
  if (amt <= 0) return ($("dep-error").textContent = "Enter an amount.");
  if (amt > h.amount + 1e-12) return ($("dep-error").textContent = `You only have ${qtyFmt(h.amount)} ${h.asset}.`);

  const value = amt * price(h.priceId);
  $("dep-pick").hidden = true;
  $("dep-progress").hidden = false;
  $("dep-done").disabled = true;
  $("dep-swap-step").textContent = h.asset === "USDC" ? "Already USDC, no swap needed" : `Swapping ${h.asset} to USDC`;

  const steps = [...document.querySelectorAll(".dep-steps li")];
  steps.forEach((s) => (s.className = ""));
  steps.forEach((s, i) => {
    setTimeout(() => s.classList.add("busy"), i * 800);
    setTimeout(() => { s.classList.remove("busy"); s.classList.add("on"); }, i * 800 + 750);
  });
  setTimeout(() => {
    h.amount = Math.max(0, h.amount - amt);
    state.collateral += value;
    state.history.push({ t: Date.now(), text: `Deposited ${qtyFmt(amt)} ${h.asset} from ${depChain}`, amount: value });
    save();
    render();
    $("dep-done").disabled = false;
    toast(`${usd(value)} USDC added to your account`);
  }, steps.length * 800);
}

// ---------- Events ----------
$("connect-btn").addEventListener("click", () => { if (!state.wallet) connect(); });
$("gate-connect").addEventListener("click", connect);
$("gate-metamask").addEventListener("click", async () => {
  await TideChain.connect();
  if (!state.wallet) connect();
});
$("v-contract").href = `${TideChain.EXPLORER}/address/${TideChain.VAULT}`;
document.querySelector(".vault").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (b && !b.disabled) vaultAction(b.dataset.v);
});
$("reset-btn").addEventListener("click", () => {
  if (!confirm("Reset the demo? This clears your play-money balances, positions and history.")) return;
  state = freshState();
  save();
  render();
});

$("market-list").addEventListener("click", (e) => {
  const b = e.target.closest(".mkt");
  if (!b) return;
  selected = b.dataset.id;
  render();
  loadChart();
});

document.querySelector(".range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  chartDays = +b.dataset.days;
  document.querySelectorAll(".range button").forEach((x) => x.classList.toggle("active", x === b));
  loadChart();
});

document.querySelector(".side-toggle").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  side = +b.dataset.side;
  renderTicket();
});
$("t-margin").addEventListener("input", renderTicket);
$("t-lev").addEventListener("input", renderTicket);
$("t-max").addEventListener("click", () => {
  const lev = parseInt($("t-lev").value, 10);
  const max = account().free / (1 + lev * FEE_RATE);
  $("t-margin").value = Math.floor(max * 100) / 100;
  renderTicket();
});
$("t-submit").addEventListener("click", placeOrder);

document.querySelector(".positions").addEventListener("click", (e) => {
  const tab = e.target.closest(".tabs button");
  if (tab) return showTab(tab.dataset.tab);
  const close = e.target.closest("[data-close]");
  if (close) closePosition(close.dataset.close);
});

$("deposit-btn").addEventListener("click", openDeposit);
$("dep-sources").addEventListener("click", (e) => {
  const b = e.target.closest(".src");
  if (!b) return;
  depChain = b.dataset.chain;
  $("dep-amount").value = "";
  renderSources();
  updateQuote();
});
$("dep-amount").addEventListener("input", updateQuote);
$("dep-max").addEventListener("click", () => {
  $("dep-amount").value = state.wallet.holdings[depChain].amount;
  updateQuote();
});
$("dep-go").addEventListener("click", runDeposit);

let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (state.wallet) loadChart(); }, 200);
});

// ---------- Boot ----------
render();
TideChain.init(render, (text, amount) => {
  state.history.push({ t: Date.now(), text, amount });
  save();
});
loadPrices().then(() => { if (state.wallet) loadChart(); });
setInterval(loadPrices, 20_000); // TidePrices only hits the network when its cache is about a minute old
