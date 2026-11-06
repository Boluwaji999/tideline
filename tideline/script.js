const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Live price ticker (CoinGecko free API, with fallback values) ----------
const COINS = [
  ["bitcoin", "BTC"], ["ethereum", "ETH"], ["solana", "SOL"], ["binancecoin", "BNB"],
  ["ripple", "XRP"], ["avalanche-2", "AVAX"], ["chainlink", "LINK"], ["sui", "SUI"],
];
const FALLBACK = {
  bitcoin: [68420, 1.2], ethereum: [3510, -0.6], solana: [172.4, 3.1], binancecoin: [598, 0.4],
  ripple: [0.62, -1.4], "avalanche-2": [36.2, 2.2], chainlink: [17.8, 0.9], sui: [1.92, 4.6],
};

const fmtPrice = (n) =>
  "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 3 : n < 1000 ? 2 : 0 });

let prices = FALLBACK;

function renderTicker(data) {
  prices = data;
  updateJourney();
  const items = COINS.map(([id, sym]) => {
    const [price, change] = data[id];
    const cls = change >= 0 ? "up" : "down";
    const sign = change >= 0 ? "+" : "";
    return `<span class="ticker-item"><b>${sym}</b>${fmtPrice(price)}<span class="${cls}">${sign}${change.toFixed(2)}%</span></span>`;
  }).join("");
  // Duplicate the list so the CSS scroll loops seamlessly
  document.getElementById("ticker").innerHTML = items + items;
}

async function loadPrices() {
  const { data: live } = await TidePrices.get();
  if (!live) return; // keep showing the sample prices until real ones arrive
  const data = {};
  for (const [id] of COINS) data[id] = live[id] ? [live[id].usd, live[id].chg] : FALLBACK[id];
  renderTicker(data);
}
// ---------- Deposit journey: pick a chain, watch Tide Flow route it ----------
const JOURNEY = {
  Solana: ["SOL", 12.5, "solana"],
  Bitcoin: ["BTC", 0.035, "bitcoin"],
  Arbitrum: ["ETH", 0.8, "ethereum"],
  Base: ["USDC", 2500, null],
};
let journeyChain = "Solana";
const tasks = document.querySelectorAll(".j-tasks li");
let taskTimers = [];

function updateJourney() {
  const [asset, amount, priceId] = JOURNEY[journeyChain];
  const usd = priceId ? amount * prices[priceId][0] : amount;
  document.getElementById("j-amount").textContent = `${amount} ${asset}`;
  document.getElementById("j-chain").textContent = journeyChain;
  document.getElementById("j-usd").textContent =
    "$" + usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  tasks[1].textContent = asset === "USDC" ? "Already USDC, no swap" : `Swapped ${asset} to USDC`;
}

function runJourney() {
  taskTimers.forEach(clearTimeout);
  tasks.forEach((t) => t.classList.remove("on"));
  tasks.forEach((t, i) => taskTimers.push(setTimeout(() => t.classList.add("on"), 350 + i * 450)));
}

document.querySelectorAll(".j-chains button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".j-chains .active").classList.remove("active");
    btn.classList.add("active");
    journeyChain = btn.dataset.chain;
    updateJourney();
    runJourney();
  });
});

renderTicker(FALLBACK);
runJourney();
loadPrices();
setInterval(loadPrices, 60_000);

// ---------- Network visual: chain nodes with packets flowing to the core ----------
const CHAINS = ["BTC", "ETH", "SOL", "BASE", "ARB", "OP", "SUI", "AVAX"];
const NS = "http://www.w3.org/2000/svg";
const spokes = document.getElementById("spokes");
const C = 260;

CHAINS.forEach((name, i) => {
  const angle = (i / CHAINS.length) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 ? 140 : 210;
  const x = C + Math.cos(angle) * r;
  const y = C + Math.sin(angle) * r;

  const line = document.createElementNS(NS, "line");
  Object.entries({ x1: x, y1: y, x2: C, y2: C, class: "spoke" }).forEach(([k, v]) => line.setAttribute(k, v));
  spokes.appendChild(line);

  if (!reduceMotion) {
    const packet = document.createElementNS(NS, "circle");
    packet.setAttribute("r", 3);
    packet.setAttribute("class", "packet");
    const anim = document.createElementNS(NS, "animateMotion");
    anim.setAttribute("dur", `${2 + (i % 3) * 0.6}s`);
    anim.setAttribute("begin", `${i * 0.35}s`);
    anim.setAttribute("repeatCount", "indefinite");
    anim.setAttribute("path", `M${x},${y} L${C},${C}`);
    packet.appendChild(anim);
    spokes.appendChild(packet);
  }

  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "node");
  g.innerHTML = `<circle cx="${x}" cy="${y}" r="24"/><text x="${x}" y="${y + 4}">${name}</text>`;
  spokes.appendChild(g);
});

// ---------- Margin demo: health meter drifts ----------
const meter = document.getElementById("meter");
const health = document.getElementById("health");
const power = document.getElementById("power");
setInterval(() => {
  const pct = Math.round(62 + Math.random() * 20);
  meter.style.width = pct + "%";
  health.textContent = `Healthy · ${pct}%`;
  power.textContent = "$" + Math.round(50000 * (3 + pct / 100 * 2)).toLocaleString("en-US");
}, 2500);

// ---------- Real vault total, read from the deployed contract ----------
const VAULT = "0x8bf8D1D4e28cb28F73Cd281ECfaD660e2b2281CB";
const TOTAL_DEPOSITS = "0x7d882097"; // totalDeposits()

const VAULT_EVENTS = {
  "0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4": "Deposited",
  "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5": "Withdrew",
};
const SECONDS_PER_BLOCK = 12;
const MUSDC = (hex) => (Number(BigInt(hex)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

async function sepolia(method, params) {
  const res = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(error.message);
  return result;
}

async function loadVaultTotal() {
  const el = document.getElementById("vault-total");
  try {
    el.textContent = MUSDC(await sepolia("eth_call", [{ to: VAULT, data: TOTAL_DEPOSITS }, "latest"]));
  } catch {
    el.textContent = "Unavailable";
  }
}

function timeAgo(blocks) {
  const minutes = Math.round((blocks * SECONDS_PER_BLOCK) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

// Public nodes limit how far back they search, so fall back to shorter ranges
async function recentVaultLogs(latest) {
  for (const range of [40000, 8000, 1000]) {
    try {
      const fromBlock = "0x" + Math.max(0, latest - range).toString(16);
      return await sepolia("eth_getLogs", [{ address: VAULT, topics: [Object.keys(VAULT_EVENTS)], fromBlock, toBlock: "latest" }]);
    } catch { /* try a shorter range */ }
  }
  throw new Error("logs unavailable");
}

async function loadActivity() {
  const list = document.getElementById("activity");
  try {
    const latest = parseInt(await sepolia("eth_blockNumber", []), 16);
    const logs = await recentVaultLogs(latest);
    if (!logs.length) {
      list.innerHTML = `<li class="activity-empty">No deposits or withdrawals recently.</li>`;
      return;
    }
    list.innerHTML = logs.slice(-4).reverse().map((log) => {
      const who = "0x" + log.topics[1].slice(-40);
      const ago = timeAgo(latest - parseInt(log.blockNumber, 16));
      return `<li><span class="addr">${who.slice(0, 6)}…${who.slice(-4)}</span>` +
        `<span>${VAULT_EVENTS[log.topics[0]]} <b>${MUSDC(log.data)} mUSDC</b></span>` +
        `<a href="https://sepolia.etherscan.io/tx/${log.transactionHash}" target="_blank" rel="noopener">${ago} ↗</a></li>`;
    }).join("");
  } catch {
    list.innerHTML = `<li class="activity-empty">Activity is unavailable right now.</li>`;
  }
}

loadVaultTotal();
loadActivity();
setInterval(() => { loadVaultTotal(); loadActivity(); }, 60_000);

// ---------- Back-to-top button: appears once you've scrolled past the hero ----------
const toTop = document.getElementById("to-top");
window.addEventListener("scroll", () => toTop.classList.toggle("show", window.scrollY > 600), { passive: true });
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));

// ---------- Scroll reveal ----------
const revealEls = document.querySelectorAll(".live > *, .chains, .section-title, .product, .journey, .steps li, .timeline li, .dev > *, .final");
revealEls.forEach((el) => el.classList.add("reveal"));
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
revealEls.forEach((el) => io.observe(el));
