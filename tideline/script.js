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

async function loadVaultTotal() {
  const el = document.getElementById("vault-total");
  try {
    const res = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: VAULT, data: TOTAL_DEPOSITS }, "latest"] }),
    });
    const { result } = await res.json();
    el.textContent = (Number(BigInt(result)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
  } catch {
    el.textContent = "Unavailable";
  }
}
loadVaultTotal();
setInterval(loadVaultTotal, 60_000);

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
