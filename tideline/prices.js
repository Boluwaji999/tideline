// Shared price feed for the landing page and the demo app.
// - One request covers every coin either page needs.
// - Results are cached in localStorage, so both pages (and reloads) share them.
// - After a failure (usually CoinGecko's free rate limit) it waits longer before retrying.
window.TidePrices = (() => {
  const API = "https://api.coingecko.com/api/v3";
  const IDS = ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "avalanche-2", "chainlink", "sui", "dogecoin"];
  const PRICE_KEY = "tideline-prices";
  const FRESH_MS = 55_000;        // reuse prices younger than this instead of fetching
  const USABLE_MS = 5 * 60_000;   // real prices up to this old are still fine to trade on
  const HISTORY_MS = 5 * 60_000;

  let backoffUntil = 0;
  let backoffMs = 30_000;
  let inflight = null;

  const key = () => (window.TIDELINE_CONFIG && window.TIDELINE_CONFIG.coingeckoKey) || "";
  const withKey = (url) => (key() ? `${url}&x_cg_demo_api_key=${encodeURIComponent(key())}` : url);

  function read(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  }

  // Returns { data: {id: {usd, chg}} | null, live: boolean, age: ms }
  async function get() {
    const cached = read(PRICE_KEY);
    const age = cached ? Date.now() - cached.at : Infinity;
    if (age < FRESH_MS || Date.now() < backoffUntil) {
      return { data: cached ? cached.data : null, live: age < USABLE_MS, age };
    }
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await fetch(withKey(`${API}/simple/price?ids=${IDS.join(",")}&vs_currencies=usd&include_24hr_change=true`));
          if (!res.ok) throw new Error(res.status);
          const json = await res.json();
          const data = {};
          for (const id of IDS) {
            if (json[id]) data[id] = { usd: json[id].usd, chg: json[id].usd_24h_change ?? 0 };
          }
          write(PRICE_KEY, { at: Date.now(), data });
          backoffMs = 30_000;
          return { data, live: true, age: 0 };
        } catch {
          backoffUntil = Date.now() + backoffMs;
          backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
          return { data: cached ? cached.data : null, live: age < USABLE_MS, age };
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  }

  // Price history for charts: [[timestamp, price], ...] or null
  async function history(id, days) {
    const k = `tideline-history-${id}-${days}`;
    const cached = read(k);
    if (cached && Date.now() - cached.at < HISTORY_MS) return cached.points;
    try {
      const res = await fetch(withKey(`${API}/coins/${id}/market_chart?vs_currency=usd&days=${days}`));
      if (!res.ok) throw new Error(res.status);
      const points = (await res.json()).prices;
      write(k, { at: Date.now(), points });
      return points;
    } catch {
      return cached ? cached.points : null; // an older chart beats a sample one
    }
  }

  return { get, history, hasKey: () => !!key() };
})();
