// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockUSDC - a FAKE stablecoin for test networks only
/// @notice A minimal ERC20 token ("Mock USD Coin", symbol "mUSDC", 6 decimals,
///         just like real USDC). It has no value. Anyone can call `faucet()`
///         to receive free test tokens, at most once every 24 hours.
/// @dev Written from scratch (no OpenZeppelin) so a beginner can read every line.
///      ERC20 is the standard interface that wallets and apps use for tokens.
contract MockUSDC {
    // ---------------------------------------------------------------------
    // Token metadata (shown by wallets like MetaMask)
    // ---------------------------------------------------------------------
    string public constant name = "Mock USD Coin";
    string public constant symbol = "mUSDC";
    /// @dev 6 decimals means 1 mUSDC is stored as 1_000_000 "base units".
    uint8 public constant decimals = 6;

    // ---------------------------------------------------------------------
    // Faucet settings
    // ---------------------------------------------------------------------
    /// @notice How much one faucet call gives: 10,000 mUSDC.
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10 ** 6;
    /// @notice How long an address must wait between faucet calls.
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    /// @notice Total number of tokens that exist.
    uint256 public totalSupply;
    /// @notice How many tokens each address holds.
    mapping(address => uint256) public balanceOf;
    /// @notice allowance[owner][spender] = how many of owner's tokens
    ///         `spender` is allowed to move with transferFrom.
    mapping(address => mapping(address => uint256)) public allowance;
    /// @notice Timestamp of each address's last faucet call (0 = never).
    mapping(address => uint256) public lastFaucetAt;

    // ---------------------------------------------------------------------
    // Events (standard ERC20 events; apps listen for these)
    // ---------------------------------------------------------------------
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ---------------------------------------------------------------------
    // Custom errors (cheaper than revert strings, and easy to test)
    // ---------------------------------------------------------------------
    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientAllowance(uint256 available, uint256 required);
    error ZeroAddress();
    /// @param availableAt the timestamp when the caller may use the faucet again
    error FaucetCooldown(uint256 availableAt);

    // ---------------------------------------------------------------------
    // Faucet
    // ---------------------------------------------------------------------

    /// @notice Mint 10,000 free mUSDC to yourself. Once per 24h per address.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        // `last != 0` lets a brand-new address use the faucet immediately.
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    // ---------------------------------------------------------------------
    // Standard ERC20 functions
    // ---------------------------------------------------------------------

    /// @notice Send `value` of your tokens to `to`.
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice Allow `spender` to move up to `value` of your tokens.
    /// @dev This is how the TideVault gets permission to pull your deposit.
    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice Move `value` tokens from `from` to `to`, using the allowance
    ///         that `from` gave to the caller.
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // type(uint256).max is treated as "unlimited" approval (common convention).
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance(allowed, value);
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance(fromBalance, value);
        // `unchecked` is safe here: we just checked fromBalance >= value,
        // and the total supply can never overflow a uint256 in practice.
        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value; // checked math: reverts on overflow
        unchecked {
            balanceOf[to] += value; // cannot overflow if totalSupply didn't
        }
        // Minting is shown as a transfer from the zero address.
        emit Transfer(address(0), to, value);
    }
}
