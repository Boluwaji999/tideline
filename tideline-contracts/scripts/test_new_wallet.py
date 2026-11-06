"""Act like a new user on Sepolia: create a wallet, fund it, claim, deposit, withdraw.

Test network only. Each step is skipped if an earlier run already finished it, so it
is safe to run again after a dropped connection.
"""
import json
import time
from pathlib import Path

from eth_account import Account

from deploy_sepolia import EXPLORER, OUTPUT, ROOT, SEPOLIA_CHAIN_ID, connect, load_wallet
from smoke_test_sepolia import UNIT, contract, send

USER_KEY_FILE = ROOT / "sepolia-test-user.key"
FUNDING_WEI = 2 * 10**15  # 0.002 SepoliaETH covers this wallet's fees


def load_user():
    if USER_KEY_FILE.exists():
        return Account.from_key(USER_KEY_FILE.read_text().strip())
    user = Account.create()
    USER_KEY_FILE.write_text(user.key.hex())
    print(f"Created wallet {user.address}")
    return user


def fund(w3, funder, user):
    if w3.eth.get_balance(user.address) >= FUNDING_WEI // 2:
        return
    transfer = {"from": funder.address, "to": user.address, "value": FUNDING_WEI}
    tx = {
        "to": user.address,
        "value": FUNDING_WEI,
        # Ask the node: a plain 21,000 ran out of gas sending to this brand-new address
        "gas": w3.eth.estimate_gas(transfer) * 3 // 2,
        "gasPrice": w3.eth.gas_price * 2,
        "nonce": w3.eth.get_transaction_count(funder.address, "pending"),
        "chainId": SEPOLIA_CHAIN_ID,
    }
    tx_hash = w3.eth.send_raw_transaction(funder.sign_transaction(tx).raw_transaction)
    assert w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300).status == 1, "Funding failed"
    print(f"Funded: {EXPLORER}/tx/{tx_hash.to_0x_hex()}")
    for _ in range(10):  # public nodes can lag behind
        if w3.eth.get_balance(user.address) > 0:
            return
        time.sleep(3)


def main():
    w3 = connect()
    user = load_user()
    deployed = json.loads(Path(OUTPUT).read_text())
    usdc = contract(w3, "MockUSDC", deployed["MockUSDC"])
    vault = contract(w3, "TideVault", deployed["TideVault"])
    me = user.address
    print(f"Wallet: {me}")

    fund(w3, load_wallet(), user)

    in_vault = vault.functions.balanceOf(me).call()
    if in_vault == 0:
        if usdc.functions.balanceOf(me).call() < 100 * UNIT:
            send(w3, user, usdc.functions.faucet(), "Claim 10,000 mUSDC")
        send(w3, user, usdc.functions.approve(vault.address, 100 * UNIT), "Approve 100")
        send(w3, user, vault.functions.deposit(100 * UNIT), "Deposit 100")
        in_vault = 100 * UNIT
    if in_vault == 100 * UNIT:
        send(w3, user, vault.functions.withdraw(40 * UNIT), "Withdraw 40")
        time.sleep(15)  # let the node catch up before reading balances

    vault_balance = vault.functions.balanceOf(me).call()
    wallet_balance = usdc.functions.balanceOf(me).call()
    total = vault.functions.totalDeposits().call()
    print(f"In vault: {vault_balance / UNIT} mUSDC, wallet: {wallet_balance / UNIT} mUSDC, vault total: {total / UNIT}")
    assert vault_balance == 60 * UNIT and wallet_balance == 9940 * UNIT


if __name__ == "__main__":
    main()
