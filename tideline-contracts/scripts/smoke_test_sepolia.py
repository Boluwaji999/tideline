"""Try the deployed contracts on Sepolia: faucet, approve, deposit, withdraw."""
import json
import time
from pathlib import Path

from web3.exceptions import Web3RPCError

from deploy_sepolia import BUILD_DIR, EXPLORER, OUTPUT, SEPOLIA_CHAIN_ID, connect, load_wallet

UNIT = 10**6  # mUSDC has 6 decimals


def contract(w3, name, address):
    abi = json.loads((BUILD_DIR / f"{name}.json").read_text())["abi"]
    return w3.eth.contract(address=address, abi=abi)


def send(w3, account, call, label):
    # Public nodes can lag behind by a block, so retry if the nonce was stale
    for attempt in range(5):
        tx = call.build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "chainId": SEPOLIA_CHAIN_ID,
        })
        try:
            tx_hash = w3.eth.send_raw_transaction(account.sign_transaction(tx).raw_transaction)
            break
        except Web3RPCError as err:
            if "nonce" not in str(err) or attempt == 4:
                raise
            time.sleep(6)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    assert receipt.status == 1, f"{label} failed"
    print(f"{label}: {EXPLORER}/tx/{tx_hash.to_0x_hex()}")


def main():
    w3 = connect()
    account = load_wallet()
    deployed = json.loads(Path(OUTPUT).read_text())
    usdc = contract(w3, "MockUSDC", deployed["MockUSDC"])
    vault = contract(w3, "TideVault", deployed["TideVault"])
    me = account.address

    assert vault.functions.token().call() == usdc.address
    assert vault.functions.owner().call() == me
    print(f"Token: {usdc.functions.name().call()} ({usdc.functions.symbol().call()})")

    # Each step is skipped if an earlier run already did it (the faucet has a 24h cooldown)
    in_vault = vault.functions.balanceOf(me).call()
    if in_vault == 0:
        if usdc.functions.balanceOf(me).call() < 100 * UNIT:
            send(w3, account, usdc.functions.faucet(), "Faucet")
        send(w3, account, usdc.functions.approve(vault.address, 100 * UNIT), "Approve 100")
        send(w3, account, vault.functions.deposit(100 * UNIT), "Deposit 100")
        in_vault = 100 * UNIT
    if in_vault == 100 * UNIT:
        send(w3, account, vault.functions.withdraw(40 * UNIT), "Withdraw 40")
        time.sleep(15)  # let the node catch up before reading balances

    in_vault = vault.functions.balanceOf(me).call()
    total = vault.functions.totalDeposits().call()
    wallet = usdc.functions.balanceOf(me).call()
    print(f"In vault: {in_vault / UNIT} mUSDC, total deposits: {total / UNIT}, wallet: {wallet / UNIT}")
    assert in_vault == 60 * UNIT and total == 60 * UNIT


if __name__ == "__main__":
    main()
