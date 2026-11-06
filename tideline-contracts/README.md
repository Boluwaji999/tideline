# Tideline Contracts (demo)

Tideline is a demo concept for an onchain brokerage where every user has one account
that holds their funds. This folder has the two smart contracts behind that idea, plus
tests you can run on your own computer.

> **WARNING: TEST NETWORKS ONLY**
>
> - These contracts are for learning. **They are not audited.** Do not use them with real money.
> - Deploy only to a **test network** (Sepolia or Base Sepolia), where the ETH is free and worthless.
> - Use a **separate MetaMask wallet made only for testing**. Never type the seed phrase
>   (the 12 or 24 secret words) or private key of a wallet that holds real funds into
>   any website, script, or chat. Nobody legitimate will ask you for it.
> - Nothing in this project needs a private key. Remix and MetaMask handle signing,
>   and you approve every step yourself in MetaMask.

---

## What's inside

```
tideline-contracts/
├── contracts/
│   ├── MockUSDC.sol      fake "dollar" token with a free faucet
│   └── TideVault.sol     the "one account": deposit and withdraw mUSDC
├── tests/test_vault.py   automated tests (run on a local fake blockchain)
├── scripts/compile.py    compiles contracts, writes ABIs + bytecode to build/
├── requirements.txt      Python packages (exact tested versions)
└── pytest.ini            test settings
```

### `MockUSDC.sol`: a fake dollar token

A minimal **ERC20** token. ERC20 is the standard that makes a token show up in wallets
and work with apps.

- Name "Mock USD Coin", symbol **mUSDC**, **6 decimals** (like real USDC).
  On chain, amounts are whole numbers: `1 mUSDC = 1,000,000` units, so
  `10 mUSDC = 10000000`.
- `faucet()`: anyone can call it to get **10,000 mUSDC** for free, **once every 24 hours**
  per address. Calling it too early fails with `FaucetCooldown(availableAt)`.
- Standard functions: `transfer`, `approve`, `transferFrom`, `balanceOf`, `allowance`,
  `totalSupply`, plus the `Transfer` and `Approval` events.

### `TideVault.sol`: the "one account"

- `deposit(amount)` moves mUSDC from your wallet into the vault and credits your account.
  **You must first call `approve(vaultAddress, amount)` on MockUSDC.** That step gives the
  vault permission to take the tokens. This two-step pattern is how all ERC20 deposits work.
- `withdraw(amount)` sends mUSDC from your vault balance back to your wallet.
- `balanceOf(user)` is one user's balance. `totalDeposits` is the sum across everyone.
- Events: `Deposited(user, amount)`, `Withdrawn(user, amount)`, `Paused`, `Unpaused`.
- The **owner** (the address that deployed the vault) can `pause()` and `unpause()`.
  Pausing blocks **deposits only**. **Withdrawals always work**, so the owner can never
  lock anyone's funds.
- Safety patterns, explained in comments in the code:
  - **Checks-Effects-Interactions**: check the inputs, then update balances, and only then
    call the token contract.
  - **Reentrancy guard**: stops a malicious contract from calling back in while a
    deposit or withdraw is still running.
  - **Custom errors**: `ZeroAmount`, `InsufficientBalance`, `NotOwner`, `DepositsPaused`, and others.

---

## Running the tests (Windows)

You need Python 3.12. You do not need Node.js.

### Why the virtual environment is not in this folder

This project sits in a very deep folder path (over 200 characters). Windows normally
limits file paths to 260 characters, and Python packages add long nested paths, so a
`.venv` inside this folder breaks. The environment lives at a short path instead:

```
%USERPROFILE%\.tideline-venv
```

That folder is already set up. If you copy the project to a short path (for example
`C:\dev\tideline-contracts`), a normal `.venv` inside the project works fine. The
commands for that case are under "Starting from scratch" below.

### Easiest: run-tests.cmd

Double-click `run-tests.cmd` in this folder, or run it from any terminal:

```powershell
& "$HOME\OneDrive\Desktop\Tideline\tideline-contracts\run-tests.cmd"
```

It switches to this folder first, so it works wherever your terminal is.

> Running `pytest` from your home folder (`C:\Users\<you>`) makes it search your whole
> user profile, which prints lots of `PermissionError` and `PytestCollectionWarning`
> lines. Nothing is wrong, it is just in the wrong folder. Use `run-tests.cmd`, or `cd`
> into this folder first.

### Run the tests (PowerShell)

Open PowerShell in the `tideline-contracts` folder and run:

```powershell
& "$env:USERPROFILE\.tideline-venv\Scripts\python.exe" -m pytest -v
```

The last line should read `14 passed`.

Git Bash version:

```bash
"$USERPROFILE/.tideline-venv/Scripts/python.exe" -m pytest -v
```

The tests run on an **in-memory fake blockchain** (eth-tester / py-evm). No network,
wallet, or money is involved. They check:

- the faucet mints 10,000 mUSDC and enforces the 24-hour cooldown (the tests move the fake
  chain's clock forward)
- deposits fail without an `approve`
- deposit and withdraw update `balanceOf` and `totalDeposits` and emit events
- you cannot withdraw more than your balance
- zero amounts are rejected
- pause blocks deposits but not withdrawals
- only the owner can pause or unpause

### Compile to JSON (for a future frontend)

```powershell
& "$env:USERPROFILE\.tideline-venv\Scripts\python.exe" scripts\compile.py
```

This writes `build\MockUSDC.json` and `build\TideVault.json`. Each file contains the
`abi`, which describes the contract's functions to a frontend, and the `bytecode`.

### Starting from scratch (new machine or short path)

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -v
```

The first run downloads the official Solidity compiler (solc 0.8.24) to
`%USERPROFILE%\.solcx`.

---

## Deploying to Sepolia with Remix + MetaMask (you do these steps)

Remix is a website that compiles and deploys Solidity, so you install nothing.
You approve every transaction yourself in MetaMask.

### 1. Set up a test-only wallet

1. Install the **MetaMask** browser extension from **metamask.io** (check the address).
2. **Create a new wallet just for testing.** Write its recovery phrase on paper and keep
   it private. Do not reuse a wallet that holds real crypto.
3. In MetaMask, open the network menu, turn on **"Show test networks"**, and pick **Sepolia**.
   For Base Sepolia, add it from MetaMask's network list or from chainlist.org,
   checking that you choose the testnet entry.

### 2. Get free test ETH

You need a little Sepolia ETH to pay gas. It is free and worthless. Search for
"Sepolia faucet" and use a well-known one, such as the faucets run by Google Cloud
(Web3), Alchemy, or Infura. Paste your **wallet address** (starts with `0x...`).
**Never** give a faucet your seed phrase or private key. Base Sepolia has its own
faucets, listed in the Base docs.

### 3. Load the contracts into Remix

1. Go to **https://remix.ethereum.org**.
2. In the **File Explorer** (left sidebar), create `MockUSDC.sol` and `TideVault.sol` and
   paste in the contents of the files from this project's `contracts/` folder.

### 4. Compile

1. Open the **Solidity Compiler** tab (left sidebar).
2. Pick compiler **0.8.24** (any 0.8.24 or newer works).
3. Click **Compile MockUSDC.sol**, then **Compile TideVault.sol**. A green check means success.

### 5. Deploy MockUSDC

1. Open the **Deploy & Run Transactions** tab.
2. Set **Environment** to **"Injected Provider - MetaMask"**. MetaMask asks to connect.
   Approve it, and check that it shows **Sepolia**.
3. In the **Contract** dropdown pick **MockUSDC**, click **Deploy**, and confirm in MetaMask.
4. When it finishes, the contract appears under **Deployed Contracts**. Copy its
   **address** with the copy icon.

### 6. Deploy TideVault

1. Pick **TideVault** in the Contract dropdown.
2. Paste the **MockUSDC address** into the box next to **Deploy**. This is the `token_`
   constructor argument.
3. Click **Deploy** and confirm in MetaMask. Your wallet is now the vault's **owner**.
4. Copy the **TideVault address**.

### 7. Try it out

Expand each contract under **Deployed Contracts**. Orange buttons send transactions
(MetaMask asks you to confirm). Blue buttons only read data and are free.

1. **MockUSDC → `faucet`**: you get 10,000 mUSDC.
2. **MockUSDC → `approve`**: `spender` = TideVault address, `value` = `100000000`
   (that is 100 mUSDC, because there are 6 decimals).
3. **TideVault → `deposit`**: `amount` = `100000000`.
4. **TideVault → `balanceOf`** (your address) and **`totalDeposits`** should both show `100000000`.
5. **TideVault → `withdraw`**: `amount` = `40000000` sends 40 mUSDC back to your wallet.
6. Optional: **`pause`**, then try `deposit` (it fails) and `withdraw` (it still works),
   then **`unpause`**.

To see mUSDC in MetaMask: **Import tokens** → paste the MockUSDC address. The symbol
and decimals fill in automatically.

You can look up every transaction on **https://sepolia.etherscan.io** by pasting your
address or a contract address.

---

## Live deployment (Sepolia test network)

| Contract | Address |
|---|---|
| MockUSDC | `0x863BE4f5B669735bA8b5663E7e81381C31F324bA` |
| TideVault | `0x8bf8D1D4e28cb28F73Cd281ECfaD660e2b2281CB` |

The addresses are also in `deployments/sepolia.json`, and the website reads from them
in `tideline/onchain.js` and `tideline/script.js`.

### Scripts (no MetaMask needed)

Run these from this folder with `& "$env:USERPROFILE\.tideline-venv\Scripts\python.exe"`:

| Script | What it does |
|---|---|
| `scripts/deploy_sepolia.py address` | Shows the test wallet and its balance |
| `scripts/deploy_sepolia.py deploy` | Deploys both contracts (refuses any network but Sepolia) |
| `scripts/smoke_test_sepolia.py` | Claim, deposit and withdraw with the deploy wallet |
| `scripts/test_new_wallet.py` | Does the same as a brand-new funded wallet |

They create `sepolia-test-wallet.key` and `sepolia-test-user.key`. Those files hold private
keys in plain text, are ignored by Git, and must only ever hold test money.

---

## Known limitations (on purpose, to keep it simple)

- The owner is fixed at deployment. There is no `transferOwnership`.
- Only one token per vault, and the vault pays no interest or yield.
- The vault assumes a standard ERC20 token. Tokens that charge a fee on transfer would
  break its accounting.
- Not audited. Treat this as learning material, not production code.
