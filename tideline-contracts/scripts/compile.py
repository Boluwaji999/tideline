"""Compile the Tideline contracts and write ABI + bytecode JSON files to build/.

Usage (from the project folder):
    python scripts/compile.py

The first run downloads the official solc 0.8.24 compiler via py-solc-x.
Output: build/MockUSDC.json and build/TideVault.json, each containing
{"contractName", "abi", "bytecode", "compiler"}. A frontend only needs the ABI
plus the deployed contract address.
"""

from __future__ import annotations

import json
from pathlib import Path

import solcx

SOLC_VERSION = "0.8.24"
ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = ROOT / "contracts"
BUILD_DIR = ROOT / "build"
CONTRACT_FILES = ["MockUSDC.sol", "TideVault.sol"]


def ensure_solc() -> None:
    """Install the pinned solc version if it is not already installed."""
    if SOLC_VERSION not in [str(v) for v in solcx.get_installed_solc_versions()]:
        solcx.install_solc(SOLC_VERSION)
    solcx.set_solc_version(SOLC_VERSION)


def compile_contracts() -> dict[str, dict]:
    """Compile all contracts. Returns {ContractName: {"abi": ..., "bytecode": ...}}."""
    ensure_solc()
    sources = {
        name: {"content": (CONTRACTS_DIR / name).read_text(encoding="utf-8")}
        for name in CONTRACT_FILES
    }
    output = solcx.compile_standard(
        {
            "language": "Solidity",
            "sources": sources,
            "settings": {
                "optimizer": {"enabled": True, "runs": 200},
                # "paris" avoids the PUSH0 opcode so the bytecode runs on
                # every EVM, including older local test chains.
                "evmVersion": "paris",
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}},
            },
        },
        solc_version=SOLC_VERSION,
    )
    result: dict[str, dict] = {}
    for file_contracts in output["contracts"].values():
        for contract_name, data in file_contracts.items():
            bytecode = data["evm"]["bytecode"]["object"]
            if not bytecode:  # skip interfaces (e.g. IERC20) - nothing to deploy
                continue
            result[contract_name] = {"abi": data["abi"], "bytecode": "0x" + bytecode}
    return result


def main() -> None:
    BUILD_DIR.mkdir(exist_ok=True)
    for name, artifact in compile_contracts().items():
        out = BUILD_DIR / f"{name}.json"
        out.write_text(
            json.dumps(
                {"contractName": name, "compiler": f"solc {SOLC_VERSION}", **artifact},
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
