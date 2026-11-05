// Talks to the deployed Tideline contracts on the Sepolia TEST network through the
// visitor's browser wallet (MetaMask). Addresses come from
// tideline-contracts/deployments/sepolia.json.
window.TideChain = (() => {
  const USDC = "0x863BE4f5B669735bA8b5663E7e81381C31F324bA";
  const VAULT = "0x8bf8D1D4e28cb28F73Cd281ECfaD660e2b2281CB";
  const CHAIN_ID = "0xaa36a7"; // 11155111, Sepolia
  const EXPLORER = "https://sepolia.etherscan.io";
  const DECIMALS = 6;
  const UNIT = 10n ** BigInt(DECIMALS);
  const FAUCET_COOLDOWN = 24 * 60 * 60;

  // First 4 bytes of each function's hash, as printed from the compiled ABI
  const FN = {
    allowance: "dd62ed3e", approve: "095ea7b3", balanceOf: "70a08231",
    deposit: "b6b55f25", faucet: "de5f72fd", lastFaucetAt: "2681616e",
    paused: "5c975abb", withdraw: "2e1a7d4d",
  };
  const ERRORS = {
    "12272bab": "The faucet can only be used once every 24 hours.",
    "2a1b2dd8": "The vault isn't approved to spend that much yet.",
    cf479181: "That's more than the available balance.",
    deeb6943: "Deposits are paused on the vault right now.",
    "1f2a2005": "Enter an amount above zero.",
    "045c4b02": "The token transfer failed.",
  };

  const s = {
    hasWallet: false, account: null, onSepolia: false,
    walletUsdc: 0n, vaultUsdc: 0n, eth: 0n, allowance: 0n, nextFaucet: 0,
    busy: "", error: "", txs: [],
  };
  let listener = () => {};
  let onTx = () => {};

  const provider = () => window.ethereum;
  const emit = () => listener(s);
  const pad = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const num = (v) => pad(BigInt(v).toString(16));
  const call = (to, data) => provider().request({ method: "eth_call", params: [{ to, data }, "latest"] });
  const uint = async (to, data) => {
    const out = await call(to, data);
    return out === "0x" ? 0n : BigInt(out);
  };

  // "12.5" -> 12500000n. Returns null if it isn't a valid amount.
  function parseAmount(text) {
    const t = String(text).trim();
    if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
    const [whole, frac = ""] = t.split(".");
    if (frac.length > DECIMALS) return null;
    return BigInt(whole || "0") * UNIT + BigInt(frac.padEnd(DECIMALS, "0") || "0");
  }
  function format(units) {
    const frac = (units % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
    const whole = (units / UNIT).toLocaleString("en-US");
    return frac ? `${whole}.${frac}` : whole;
  }
  const toNumber = (units) => Number(units) / Number(UNIT);

  function explain(err) {
    if (err?.code === 4001 || err?.info?.error?.code === 4001) return "You rejected the request in MetaMask.";
    const data = err?.data?.data || err?.data?.originalError?.data || err?.data;
    const hex = typeof data === "string" ? data : String(err?.message || "").match(/0x[0-9a-f]{8}/i)?.[0];
    if (hex && ERRORS[hex.slice(2, 10)]) return ERRORS[hex.slice(2, 10)];
    return err?.message || "Something went wrong.";
  }

  async function refresh() {
    if (!s.account || !s.onSepolia) return emit();
    try {
      const me = pad(s.account);
      const [walletUsdc, vaultUsdc, allowance, last, eth] = await Promise.all([
        uint(USDC, "0x" + FN.balanceOf + me),
        uint(VAULT, "0x" + FN.balanceOf + me),
        uint(USDC, "0x" + FN.allowance + me + pad(VAULT)),
        uint(USDC, "0x" + FN.lastFaucetAt + me),
        provider().request({ method: "eth_getBalance", params: [s.account, "latest"] }).then(BigInt),
      ]);
      Object.assign(s, { walletUsdc, vaultUsdc, allowance, eth });
      s.nextFaucet = last === 0n ? 0 : Number(last) + FAUCET_COOLDOWN;
    } catch (err) {
      s.error = explain(err);
    }
    emit();
  }

  async function syncChain() {
    s.onSepolia = (await provider().request({ method: "eth_chainId" })) === CHAIN_ID;
  }

  async function connect() {
    s.error = "";
    if (!provider()) return emit();
    try {
      const [account] = await provider().request({ method: "eth_requestAccounts" });
      s.account = account || null;
      await syncChain();
      if (!s.onSepolia) await switchChain();
    } catch (err) {
      s.error = explain(err);
    }
    await refresh();
  }

  async function switchChain() {
    s.error = "";
    try {
      await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID }] });
    } catch (err) {
      if (err?.code !== 4902) { s.error = explain(err); return emit(); }
      try {
        await provider().request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_ID,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "SepoliaETH", decimals: 18 },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: [EXPLORER],
          }],
        });
      } catch (addErr) {
        s.error = explain(addErr);
        return emit();
      }
    }
    await syncChain();
    await refresh();
  }

  async function send(to, data, label) {
    // Dry run first, so a transaction that would fail shows a clear reason and costs nothing
    await provider().request({ method: "eth_call", params: [{ from: s.account, to, data }, "latest"] });
    s.busy = `${label}: confirm in MetaMask…`;
    emit();
    const hash = await provider().request({
      method: "eth_sendTransaction",
      params: [{ from: s.account, to, data }],
    });
    s.busy = `${label}: waiting for the network…`;
    emit();
    for (let i = 0; i < 90; i++) {
      const receipt = await provider().request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error(`${label} failed onchain.`);
        s.txs.unshift({ label, hash });
        s.txs = s.txs.slice(0, 5);
        return hash;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${label} is taking too long. Check MetaMask's activity list.`);
  }

  async function run(task) {
    if (s.busy) return;
    s.error = "";
    try {
      await task();
    } catch (err) {
      s.error = explain(err);
    }
    s.busy = "";
    await refresh();
  }

  const claim = () => run(async () => {
    await send(USDC, "0x" + FN.faucet, "Claim test USDC");
    onTx("Claimed 10,000 mUSDC from the faucet");
  });

  const deposit = (units) => run(async () => {
    if (units > s.walletUsdc) throw new Error(`Your wallet only has ${format(s.walletUsdc)} mUSDC.`);
    const allowed = () => uint(USDC, "0x" + FN.allowance + pad(s.account) + pad(VAULT));
    if ((await allowed()) < units) {
      await send(USDC, "0x" + FN.approve + pad(VAULT) + num(units), "Step 1 of 2: approve");
      // Nodes can lag a block behind, so wait until the approval is visible
      for (let i = 0; i < 15 && (await allowed()) < units; i++) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    await send(VAULT, "0x" + FN.deposit + num(units), "Deposit");
    onTx(`Deposited ${format(units)} mUSDC into TideVault`, toNumber(units));
  });

  const withdraw = (units) => run(async () => {
    await send(VAULT, "0x" + FN.withdraw + num(units), "Withdraw");
    onTx(`Withdrew ${format(units)} mUSDC from TideVault`, -toNumber(units));
  });

  async function init(onChange, onTransaction) {
    listener = onChange;
    onTx = onTransaction;
    s.hasWallet = !!provider();
    if (!provider()) return emit();
    provider().on?.("accountsChanged", (accounts) => { s.account = accounts[0] || null; refresh(); });
    provider().on?.("chainChanged", async () => { await syncChain(); refresh(); });
    try {
      // Reconnect silently if this site was approved before
      const [account] = await provider().request({ method: "eth_accounts" });
      s.account = account || null;
      await syncChain();
    } catch { /* wallet locked: wait for the Connect button */ }
    await refresh();
  }

  return {
    state: s, init, connect, switchChain, refresh, claim, deposit, withdraw,
    parseAmount, format, toNumber, EXPLORER, USDC, VAULT,
  };
})();
