// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The few ERC20 functions the vault needs. Declaring an "interface"
///      lets this contract call any token that follows the ERC20 standard.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title TideVault - the Tideline "one account"
/// @notice Users deposit a token (mUSDC on test networks) into one shared
///         vault and can withdraw their own balance at any time.
/// @dev DEMO / EDUCATIONAL CODE. NOT AUDITED. TEST NETWORKS ONLY.
///
/// Safety patterns used here (worth learning):
///  1. Checks-Effects-Interactions: validate inputs first, update our own
///     storage second, and only THEN call the external token contract.
///  2. Reentrancy guard: a simple lock that stops a malicious token from
///     calling back into deposit/withdraw while one is already running.
///  3. Custom errors: cheap, descriptive reverts.
///  4. Withdrawals are never paused, so the owner can never trap user funds.
contract TideVault {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    /// @notice The token this vault accepts (set once, at deployment).
    IERC20 public immutable token;
    /// @notice The admin address; the only one allowed to pause/unpause.
    address public immutable owner;
    /// @notice When true, new deposits are blocked (withdrawals still work).
    bool public paused;
    /// @notice Sum of all users' balances held by the vault.
    uint256 public totalDeposits;
    /// @notice Each user's deposited balance.
    mapping(address => uint256) public balanceOf;

    /// @dev Reentrancy lock: 1 = not entered, 2 = entered.
    ///      (Using 1/2 instead of false/true is slightly cheaper in gas.)
    uint256 private _locked = 1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ---------------------------------------------------------------------
    // Custom errors
    // ---------------------------------------------------------------------
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 requested);
    error NotOwner();
    error DepositsPaused();
    error AlreadyInState();
    error Reentrancy();
    error TokenTransferFailed();

    // ---------------------------------------------------------------------
    // Modifiers (reusable checks that wrap a function)
    // ---------------------------------------------------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _; // the function body runs here
        _locked = 1;
    }

    /// @param token_ address of the ERC20 token to accept (e.g. MockUSDC)
    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        owner = msg.sender; // whoever deploys the vault is the owner
    }

    // ---------------------------------------------------------------------
    // User functions
    // ---------------------------------------------------------------------

    /// @notice Deposit `amount` tokens into your Tideline account.
    /// @dev You must first call `token.approve(vaultAddress, amount)`.
    function deposit(uint256 amount) external nonReentrant {
        // 1. Checks
        if (paused) revert DepositsPaused();
        if (amount == 0) revert ZeroAmount();

        // 2. Effects (update our records first)
        balanceOf[msg.sender] += amount;
        totalDeposits += amount;

        // 3. Interactions (pull tokens from the user). If this fails, the
        //    whole transaction reverts, undoing step 2 as well.
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }

        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw `amount` tokens from your Tideline account.
    /// @dev Works even while the vault is paused.
    function withdraw(uint256 amount) external nonReentrant {
        // 1. Checks
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (amount > bal) revert InsufficientBalance(bal, amount);

        // 2. Effects
        balanceOf[msg.sender] = bal - amount;
        totalDeposits -= amount;

        // 3. Interactions (send tokens back to the user)
        if (!token.transfer(msg.sender, amount)) {
            revert TokenTransferFailed();
        }

        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Admin functions
    // ---------------------------------------------------------------------

    /// @notice Stop new deposits (e.g. if something looks wrong).
    function pause() external onlyOwner {
        if (paused) revert AlreadyInState();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Allow deposits again.
    function unpause() external onlyOwner {
        if (!paused) revert AlreadyInState();
        paused = false;
        emit Unpaused(msg.sender);
    }
}
