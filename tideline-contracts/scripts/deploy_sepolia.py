"""Deploy MockUSDC and TideVault to the Sepolia TEST network, without MetaMask.

Usage (from the tideline-contracts folder):
    python scripts/deploy_sepolia.py address   # show the test wallet and its balance
    python scripts/deploy_sepolia.py deploy    # deploy both contracts

The first run creates a throwaway wallet in sepolia-test-wallet.key. Never send real
funds to it: the key is a plain text file on this PC, so it is for test money only.
The script refuses to run on any network except Sepolia.
"""
import json
import sys
from pathlib import Path

from eth_account import Account
from web3 import Web3

ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = ROOT / "sepolia-test-wallet.key"
BUILD_DIR = ROOT / "build"
OUTPUT = ROOT / "deployments" / "sepolia.json"

SEPOLIA_CHAIN_ID = 11155111
RPC_URLS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
    "https://1rpc.io/sepolia",
]
MIN_BALANCE_ETH = 0.01
EXPLORER = "https://sepolia.etherscan.io"


def connect():
    for url in RPC_URLS:
        w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 20}))
        try:
            if w3.eth.chain_id == SEPOLIA_CHAIN_ID:
                return w3
        except Exception:
            continue
    sys.exit("Could not reach the Sepolia network. Check your internet and try again.")


def load_wallet():
    if KEY_FILE.exists():
        return Account.from_key(KEY_FILE.read_text().strip())
    account = Account.create()
    KEY_FILE.write_text(account.key.hex())
    print(f"Created a new test wallet in {KEY_FILE.name}")
    return account


def deploy_contract(w3, account, name, *args):
    artifact = json.loads((BUILD_DIR / f"{name}.json").read_text())
    contract = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    tx = contract.constructor(*args).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "chainId": SEPOLIA_CHAIN_ID,
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"{name}: sent {tx_hash.to_0x_hex()}, waiting for it to confirm...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    if receipt.status != 1:
        sys.exit(f"{name} deployment failed: {EXPLORER}/tx/{tx_hash.to_0x_hex()}")
    print(f"{name}: {receipt.contractAddress}")
    return receipt.contractAddress


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "address"
    w3 = connect()
    account = load_wallet()
    balance = w3.from_wei(w3.eth.get_balance(account.address), "ether")
    print(f"Network: Sepolia\nTest wallet: {account.address}\nBalance: {balance} SepoliaETH")

    if command != "deploy":
        return
    if OUTPUT.exists():
        sys.exit(f"Already deployed, see {OUTPUT}. Delete that file to deploy again.")
    if balance < MIN_BALANCE_ETH:
        sys.exit(f"Need at least {MIN_BALANCE_ETH} SepoliaETH. Use a faucet, then run this again.")

    usdc = deploy_contract(w3, account, "MockUSDC")
    vault = deploy_contract(w3, account, "TideVault", usdc)

    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "network": "sepolia",
        "chainId": SEPOLIA_CHAIN_ID,
        "owner": account.address,
        "MockUSDC": usdc,
        "TideVault": vault,
    }, indent=2))
    print(f"Done.\n{EXPLORER}/address/{usdc}\n{EXPLORER}/address/{vault}")


if __name__ == "__main__":
    main()
