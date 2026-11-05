"""Tests for MockUSDC and TideVault.

Runs entirely on an in-memory test blockchain (eth-tester + py-evm), so no
network, wallet, or real money is involved.

Run from the project folder:
    python -m pytest -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from eth_utils import keccak
from web3 import EthereumTesterProvider, Web3
from web3.logs import DISCARD  # ignore logs from other contracts in a receipt

# Make scripts/compile.py importable so tests and the build use the same code.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from compile import compile_contracts  # noqa: E402

ONE = 10**6  # 1 mUSDC in base units (6 decimals)
FAUCET_AMOUNT = 10_000 * ONE
DAY = 24 * 60 * 60


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def selector(error_signature: str) -> str:
    """First 4 bytes of keccak(signature) as hex, e.g. 'ZeroAmount()' -> '0x...'."""
    return "0x" + keccak(text=error_signature)[:4].hex()


def revert_data(err: BaseException) -> str:
    """Dig the raw revert bytes (error selector + encoded args) out of an exception.

    Depending on the web3 / eth-tester version, the bytes may sit in `.data`,
    in the exception args, or in a chained exception (`Revert(b'...')`).
    """
    seen = set()
    stack = [err]
    while stack:
        item = stack.pop()
        if id(item) in seen or item is None:
            continue
        seen.add(id(item))
        if isinstance(item, (bytes, bytearray)):
            return "0x" + bytes(item).hex()
        if isinstance(item, str) and item.startswith("0x"):
            return item
        if isinstance(item, BaseException):
            stack.extend([getattr(item, "data", None), item.__cause__, item.__context__])
            stack.extend(item.args)
        elif isinstance(item, (tuple, list)):
            stack.extend(item)
    return ""


def expect_revert(error_signature: str, fn, *args, **tx):
    """Assert that calling fn(*args).transact(tx) reverts with the custom error."""
    with pytest.raises(Exception) as exc_info:
        fn(*args).transact(tx)
    data = revert_data(exc_info.value)
    assert data.startswith(selector(error_signature)), (
        f"expected {error_signature}, got {exc_info.value!r}"
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def artifacts():
    """Compile once per test session (compiling is the slow part)."""
    return compile_contracts()


@pytest.fixture
def w3():
    """A fresh in-memory chain for every test, with funded test accounts."""
    return Web3(EthereumTesterProvider())


@pytest.fixture
def accounts(w3):
    owner, alice, bob = w3.eth.accounts[:3]
    return {"owner": owner, "alice": alice, "bob": bob}


def deploy(w3, artifact, sender, *ctor_args):
    factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    tx_hash = factory.constructor(*ctor_args).transact({"from": sender})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return w3.eth.contract(address=receipt.contractAddress, abi=artifact["abi"])


@pytest.fixture
def usdc(w3, artifacts, accounts):
    return deploy(w3, artifacts["MockUSDC"], accounts["owner"])


@pytest.fixture
def vault(w3, artifacts, accounts, usdc):
    return deploy(w3, artifacts["TideVault"], accounts["owner"], usdc.address)


@pytest.fixture
def funded_alice(usdc, vault, accounts):
    """Alice has used the faucet and approved the vault for 1,000 mUSDC."""
    alice = accounts["alice"]
    usdc.functions.faucet().transact({"from": alice})
    usdc.functions.approve(vault.address, 1_000 * ONE).transact({"from": alice})
    return alice


def time_travel(w3, seconds: int) -> None:
    """Move the test chain's clock forward by mining a block in the future."""
    latest = w3.eth.get_block("latest")["timestamp"]
    w3.provider.ethereum_tester.time_travel(latest + seconds)


# ---------------------------------------------------------------------------
# MockUSDC
# ---------------------------------------------------------------------------

def test_token_metadata(usdc):
    assert usdc.functions.name().call() == "Mock USD Coin"
    assert usdc.functions.symbol().call() == "mUSDC"
    assert usdc.functions.decimals().call() == 6
    assert usdc.functions.totalSupply().call() == 0


def test_faucet_mints_and_emits_transfer(w3, usdc, accounts):
    alice = accounts["alice"]
    tx = usdc.functions.faucet().transact({"from": alice})
    receipt = w3.eth.wait_for_transaction_receipt(tx)

    assert usdc.functions.balanceOf(alice).call() == FAUCET_AMOUNT
    assert usdc.functions.totalSupply().call() == FAUCET_AMOUNT

    (event,) = usdc.events.Transfer().process_receipt(receipt, errors=DISCARD)
    assert event.args["from"] == "0x" + "00" * 20
    assert event.args["to"] == alice
    assert event.args["value"] == FAUCET_AMOUNT


def test_faucet_cooldown_24h(w3, usdc, accounts):
    alice, bob = accounts["alice"], accounts["bob"]
    usdc.functions.faucet().transact({"from": alice})

    # Second call right away is blocked...
    expect_revert("FaucetCooldown(uint256)", usdc.functions.faucet, **{"from": alice})
    # ...but other addresses have their own cooldown.
    usdc.functions.faucet().transact({"from": bob})

    # Still blocked just under 24h later.
    time_travel(w3, DAY - 60)
    expect_revert("FaucetCooldown(uint256)", usdc.functions.faucet, **{"from": alice})

    # Allowed once 24h have passed.
    time_travel(w3, 120)
    usdc.functions.faucet().transact({"from": alice})
    assert usdc.functions.balanceOf(alice).call() == 2 * FAUCET_AMOUNT


def test_transfer_and_transfer_from(usdc, accounts):
    alice, bob, owner = accounts["alice"], accounts["bob"], accounts["owner"]
    usdc.functions.faucet().transact({"from": alice})

    usdc.functions.transfer(bob, 100 * ONE).transact({"from": alice})
    assert usdc.functions.balanceOf(bob).call() == 100 * ONE

    # transferFrom needs an allowance.
    expect_revert(
        "InsufficientAllowance(uint256,uint256)",
        usdc.functions.transferFrom, alice, owner, ONE, **{"from": bob},
    )
    usdc.functions.approve(bob, 5 * ONE).transact({"from": alice})
    usdc.functions.transferFrom(alice, owner, 5 * ONE).transact({"from": bob})
    assert usdc.functions.balanceOf(owner).call() == 5 * ONE
    assert usdc.functions.allowance(alice, bob).call() == 0

    # Cannot send more than you have.
    expect_revert(
        "InsufficientBalance(uint256,uint256)",
        usdc.functions.transfer, alice, 1_000 * ONE, **{"from": bob},
    )


# ---------------------------------------------------------------------------
# TideVault
# ---------------------------------------------------------------------------

def test_vault_initial_state(vault, usdc, accounts):
    assert vault.functions.token().call() == usdc.address
    assert vault.functions.owner().call() == accounts["owner"]
    assert vault.functions.paused().call() is False
    assert vault.functions.totalDeposits().call() == 0


def test_deposit_requires_approval(usdc, vault, accounts):
    alice = accounts["alice"]
    usdc.functions.faucet().transact({"from": alice})
    # No approve() yet -> the token's transferFrom reverts, so deposit reverts.
    expect_revert(
        "InsufficientAllowance(uint256,uint256)",
        vault.functions.deposit, 100 * ONE, **{"from": alice},
    )
    assert vault.functions.balanceOf(alice).call() == 0
    assert vault.functions.totalDeposits().call() == 0


def test_deposit_updates_balances_and_emits(w3, usdc, vault, funded_alice):
    alice = funded_alice
    tx = vault.functions.deposit(400 * ONE).transact({"from": alice})
    receipt = w3.eth.wait_for_transaction_receipt(tx)

    assert vault.functions.balanceOf(alice).call() == 400 * ONE
    assert vault.functions.totalDeposits().call() == 400 * ONE
    assert usdc.functions.balanceOf(vault.address).call() == 400 * ONE
    assert usdc.functions.balanceOf(alice).call() == FAUCET_AMOUNT - 400 * ONE

    (event,) = vault.events.Deposited().process_receipt(receipt, errors=DISCARD)
    assert event.args["user"] == alice
    assert event.args["amount"] == 400 * ONE


def test_withdraw_updates_balances_and_emits(w3, usdc, vault, funded_alice):
    alice = funded_alice
    vault.functions.deposit(400 * ONE).transact({"from": alice})
    tx = vault.functions.withdraw(150 * ONE).transact({"from": alice})
    receipt = w3.eth.wait_for_transaction_receipt(tx)

    assert vault.functions.balanceOf(alice).call() == 250 * ONE
    assert vault.functions.totalDeposits().call() == 250 * ONE
    assert usdc.functions.balanceOf(vault.address).call() == 250 * ONE
    assert usdc.functions.balanceOf(alice).call() == FAUCET_AMOUNT - 250 * ONE

    (event,) = vault.events.Withdrawn().process_receipt(receipt, errors=DISCARD)
    assert event.args["user"] == alice
    assert event.args["amount"] == 150 * ONE


def test_total_deposits_tracks_multiple_users(usdc, vault, funded_alice, accounts):
    bob = accounts["bob"]
    usdc.functions.faucet().transact({"from": bob})
    usdc.functions.approve(vault.address, 2**256 - 1).transact({"from": bob})  # unlimited

    vault.functions.deposit(100 * ONE).transact({"from": funded_alice})
    vault.functions.deposit(300 * ONE).transact({"from": bob})
    assert vault.functions.totalDeposits().call() == 400 * ONE

    vault.functions.withdraw(300 * ONE).transact({"from": bob})
    assert vault.functions.totalDeposits().call() == 100 * ONE
    assert vault.functions.balanceOf(bob).call() == 0
    assert vault.functions.balanceOf(funded_alice).call() == 100 * ONE


def test_cannot_withdraw_more_than_balance(vault, funded_alice, accounts):
    alice = funded_alice
    vault.functions.deposit(100 * ONE).transact({"from": alice})
    expect_revert(
        "InsufficientBalance(uint256,uint256)",
        vault.functions.withdraw, 100 * ONE + 1, **{"from": alice},
    )
    # Someone with no deposit cannot withdraw Alice's funds.
    expect_revert(
        "InsufficientBalance(uint256,uint256)",
        vault.functions.withdraw, ONE, **{"from": accounts["bob"]},
    )
    assert vault.functions.balanceOf(alice).call() == 100 * ONE


def test_zero_amount_reverts(vault, funded_alice):
    expect_revert("ZeroAmount()", vault.functions.deposit, 0, **{"from": funded_alice})
    expect_revert("ZeroAmount()", vault.functions.withdraw, 0, **{"from": funded_alice})


def test_pause_blocks_deposit_but_not_withdraw(w3, vault, funded_alice, accounts):
    alice, owner = funded_alice, accounts["owner"]
    vault.functions.deposit(200 * ONE).transact({"from": alice})

    tx = vault.functions.pause().transact({"from": owner})
    (event,) = vault.events.Paused().process_receipt(
        w3.eth.wait_for_transaction_receipt(tx), errors=DISCARD
    )
    assert event.args["by"] == owner
    assert vault.functions.paused().call() is True

    expect_revert("DepositsPaused()", vault.functions.deposit, ONE, **{"from": alice})

    # Withdrawals still work while paused - funds can never be trapped.
    vault.functions.withdraw(200 * ONE).transact({"from": alice})
    assert vault.functions.balanceOf(alice).call() == 0

    vault.functions.unpause().transact({"from": owner})
    assert vault.functions.paused().call() is False
    vault.functions.deposit(ONE).transact({"from": alice})
    assert vault.functions.balanceOf(alice).call() == ONE


def test_only_owner_can_pause_and_unpause(vault, accounts):
    alice, owner = accounts["alice"], accounts["owner"]
    expect_revert("NotOwner()", vault.functions.pause, **{"from": alice})

    vault.functions.pause().transact({"from": owner})
    expect_revert("NotOwner()", vault.functions.unpause, **{"from": alice})
    # Pausing twice is rejected too.
    expect_revert("AlreadyInState()", vault.functions.pause, **{"from": owner})


def test_constructor_rejects_zero_token(w3, artifacts, accounts):
    factory = w3.eth.contract(
        abi=artifacts["TideVault"]["abi"], bytecode=artifacts["TideVault"]["bytecode"]
    )
    with pytest.raises(Exception):
        factory.constructor("0x" + "00" * 20).transact({"from": accounts["owner"]})
