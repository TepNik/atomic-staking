// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAtomicStaking} from "./interface/IAtomicStaking.sol";

/// @title The contract for staking the ERC20 token Atomic Wallet Coin ($AWC).
/// @author TepNik
/// @dev This contract can also be used for other ERC20 tokens as well.
contract AtomicStaking is AccessControl, ReentrancyGuard, IAtomicStaking {
    using SafeERC20 for IERC20;

    /* PUBLIC STATE VARIABLES */

    /// @inheritdoc IAtomicStaking
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @inheritdoc IAtomicStaking
    IERC20 public immutable override TOKEN;

    /// @inheritdoc IAtomicStaking
    uint256 public override minStakeAmount;

    /// @inheritdoc IAtomicStaking
    uint256 public override apr;

    /* PRIVATE VARIABLES */

    uint256 private constant _COOLING_PERIOD = 10 days;
    uint256 private constant _ONE_YEAR = (1 days) * 365;

    uint256 private constant _RATE_PRECISION = 1e18;
    uint256 private constant _PERCENT_DENOMINATOR = 100_00;

    // stake stats
    mapping(address => StakeState) private _stakeStates;
    uint256 private _totalStaked;
    // rate info
    uint256 private _ratePerStaking = _RATE_PRECISION;
    uint256 private _lastRateUpdateTimestamp;
    // withdraw stats
    uint256 private _lastWithdrawId;
    mapping(uint256 => WithdrawState) private _withdrawStates;

    /* EVENTS */

    /// @notice Event is emmited when a user staked the token.
    /// @param user The user that staked the token
    /// @param amount Staked amount of the token
    event TokenStaked(address indexed user, uint256 amount);

    /// @notice Event is emmited when an admin changes the `minStakeAmount` global variable.
    /// @param oldValue The old value of the `minStakeAmount` global variable
    /// @param newValue The new value of the `minStakeAmount` global variable
    event MinStakeAmountChanged(uint256 oldValue, uint256 newValue);

    /// @notice Event is emmited when an admin changes the `apr` global variable.
    /// @param oldValue The old value of the `apr` global variable
    /// @param newValue The new value of the `apr` global variable
    event AprChanged(uint256 oldValue, uint256 newValue);

    /// @notice Event is emmited when the `_ratePerStaking` global variable is changed.
    /// @param newRate The new value of the `_ratePerStaking` global variable
    event RateUpdated(uint256 newRate);

    /// @notice Event is emmited when the `donator` address have donated `amount` number of tokens to the contract
    /// that will be distributed as rewards to the stakers.
    /// @param donator The address of a donator
    /// @param amount The donated amount
    event TokensDonated(address indexed donator, uint256 amount);

    /// @notice Event is emmited when the `contractDeptToUser` field in the structure `StakeState` has changed.
    /// @param user Address of a user which has this parameter changed
    /// @param oldAmount The old amount of the `contractDeptToUser` field
    /// @param newAmount The new amount of the `contractDeptToUser` field
    event DeptToUserChanged(address indexed user, uint256 oldAmount, uint256 newAmount);

    /// @notice Event is emmited when a user claims his rewards.
    /// @param user A user that has claimed his rewards
    /// @param amount Amount of the tokens that the user claimed
    event RewardsClaimed(address indexed user, uint256 amount);

    /// @notice Event is emmited when an admin (`DEFAULT_ADMIN_ROLE` role only) withdraws
    /// some or all tokens that were supposed to be distrubuted to the stakers as their rewards.
    /// @param user The admin that withdrawn tokens
    /// @param withdrawnAmount Withdrawn amount
    event ExcessiveBalanceWithdrawn(address indexed user, uint256 withdrawnAmount);

    /// @notice Event is emmited when a user requests withdrawal request. Withdrawn tokens are locked for a cooling period.
    /// @param user A user's address
    /// @param amount Withdraw amount
    /// @param withdrawId Withdraw request identifier
    event WithdrawRequested(address indexed user, uint256 amount, uint256 withdrawId);

    /// @notice Event is emmited when a user finalized his tokens.
    /// @param user A user's address
    /// @param amount Finalized amount
    /// @param withdrawId Withdraw request identifier
    event WithdrawIdFinalized(address indexed user, uint256 amount, uint256 withdrawId);

    /* ERRORS */

    /// @notice A transaction reverted with this error when a zero address is passed as an argument to a function.
    error AddressZero();
    /// @notice A transaction reverted with this error when a user tries to stake the token, but
    /// staked amount `suppliedAmount` is less than minimum allowed amount `minStakeAmount`.
    /// @param suppliedAmount Amount of the token that a user tried to stake
    /// @param minStakeAmount Minimum amount of the token that are required for a stake
    error LessThanMinAmount(uint256 suppliedAmount, uint256 minStakeAmount);
    /// @notice A transaction reverted with this error when an admin tries to change a global variable to the same value.
    error TheSameValue();
    /// @notice A transaction reverted with this error when a user passes too big argument.
    /// @param passedValue The value that the user passed
    /// @param maxValue The maximum allowed value
    error TooBigValue(uint256 passedValue, uint256 maxValue);
    /// @notice A transaction reverted with this error when a user passes zero argument.
    error ZeroValue();
    /// @notice A transaction reverted with this error when a user tries to finalize a non-existent withdrawal request.
    error NoSuchWithdrawId(uint256 withdrawId);
    /// @notice A transaction reverted with this error when a user tries to finilize not his withdrawal request.
    error NotAllowedUser(address sender, address allowedUser);
    /// @notice A transaction reverted with this error when a user tries to finilize not finalizable withdrawal request.
    error WithdrawIdNotFinalizableYet(uint256 timestampNow, uint256 coolingPeriodEnd);

    /// @dev Deployer of the contract will have `DEFAULT_ADMIN_ROLE` role.
    /// Also, the `_apr` argument can't be bigger than `_PERCENT_DENOMINATOR` to prevent too big values.
    constructor(IERC20 token, uint256 _minStakeAmount, uint256 _apr) {
        if (address(token) == address(0)) {
            revert AddressZero();
        }
        // apr can't be more than 100% to prevent too big values
        if (_apr > _PERCENT_DENOMINATOR) {
            revert TooBigValue(_apr, _PERCENT_DENOMINATOR);
        }

        TOKEN = token;

        if (_apr != 0) {
            apr = _apr;

            emit AprChanged(0, _apr);
        }

        if (_minStakeAmount != 0) {
            minStakeAmount = _minStakeAmount;

            emit MinStakeAmountChanged(0, _minStakeAmount);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* USERS' FUNCTIONS */

    /// @inheritdoc IAtomicStaking
    function stake(uint256 amount) external override nonReentrant {
        uint256 _minStakeAmount = minStakeAmount;
        if (amount < _minStakeAmount) {
            revert LessThanMinAmount(amount, _minStakeAmount);
        }

        _collectRewards(msg.sender);

        uint256 newStakedAmount = _stakeStates[msg.sender].stakeAmount + amount;
        _stakeStates[msg.sender].stakeAmount = newStakedAmount;
        _stakeStates[msg.sender].claimedAmount =
            (newStakedAmount * _ratePerStaking) /
            _RATE_PRECISION;

        _totalStaked += amount;

        TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit TokenStaked(msg.sender, amount);
    }

    /// @inheritdoc IAtomicStaking
    function requestWithdraw(
        uint256 amount
    ) external override nonReentrant returns (uint256 withdrawId) {
        if (amount == 0) {
            revert ZeroValue();
        }

        uint256 stakeAmount = _stakeStates[msg.sender].stakeAmount;
        if (stakeAmount < amount) {
            revert TooBigValue(amount, stakeAmount);
        }

        _collectRewards(msg.sender);

        withdrawId = ++_lastWithdrawId;

        uint256 newStakeAmount = stakeAmount - amount;
        _stakeStates[msg.sender].stakeAmount = newStakeAmount;
        _stakeStates[msg.sender].claimedAmount =
            (newStakeAmount * _ratePerStaking) /
            _RATE_PRECISION;

        _withdrawStates[withdrawId].user = msg.sender;
        _withdrawStates[withdrawId].withdrawTimestamp = uint64(block.timestamp);
        _withdrawStates[withdrawId].amount = amount;

        emit WithdrawRequested(msg.sender, amount, withdrawId);
    }

    /// @inheritdoc IAtomicStaking
    function finalizeWithdraw(uint256 withdrawId) external override nonReentrant {
        WithdrawState memory withdrawState = _withdrawStates[withdrawId];
        delete _withdrawStates[withdrawId];
        if (withdrawState.withdrawTimestamp == 0) {
            revert NoSuchWithdrawId(withdrawId);
        }
        if (withdrawState.user != msg.sender) {
            revert NotAllowedUser(msg.sender, withdrawState.user);
        }
        if (withdrawState.withdrawTimestamp + _COOLING_PERIOD > block.timestamp) {
            revert WithdrawIdNotFinalizableYet(
                block.timestamp,
                withdrawState.withdrawTimestamp + _COOLING_PERIOD
            );
        }

        _totalStaked -= withdrawState.amount;

        TOKEN.safeTransfer(msg.sender, withdrawState.amount);

        emit WithdrawIdFinalized(msg.sender, withdrawState.amount, withdrawId);
    }

    /// @inheritdoc IAtomicStaking
    function claimRewards() external nonReentrant {
        _collectRewards(msg.sender);
    }

    /// @inheritdoc IAtomicStaking
    function donateTokensToRewards(uint256 amount) external override nonReentrant {
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit TokensDonated(msg.sender, amount);
    }

    /* ADMINS' FUNCTIONS */

    /// @inheritdoc IAtomicStaking
    function setMinStakeAmount(
        uint256 newAmount
    ) external override nonReentrant onlyRole(MANAGER_ROLE) {
        uint256 oldAmount = minStakeAmount;
        if (newAmount == oldAmount) {
            revert TheSameValue();
        }

        minStakeAmount = newAmount;

        emit MinStakeAmountChanged(oldAmount, newAmount);
    }

    /// @inheritdoc IAtomicStaking
    function setApr(uint256 newValue) external override nonReentrant onlyRole(MANAGER_ROLE) {
        if (newValue > _PERCENT_DENOMINATOR) {
            revert TooBigValue(newValue, _PERCENT_DENOMINATOR);
        }

        uint256 oldValue = apr;
        if (newValue == oldValue) {
            revert TheSameValue();
        }

        // to calculate previous rewards
        _updateRate();

        apr = newValue;

        emit AprChanged(oldValue, newValue);
    }

    /// @inheritdoc IAtomicStaking
    function receiveExcessiveBalance(
        uint256 amount
    ) external override nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) {
            return;
        }

        uint256 totalBalance = TOKEN.balanceOf(address(this));
        uint256 totalStaked = _totalStaked;
        if (totalBalance <= totalStaked) {
            return;
        }

        uint256 possibleToWithdraw = totalBalance - totalStaked;
        uint256 toWithdraw = possibleToWithdraw <= amount ? possibleToWithdraw : amount;

        TOKEN.safeTransfer(msg.sender, toWithdraw);

        emit ExcessiveBalanceWithdrawn(msg.sender, toWithdraw);
    }

    /* GETTERS */

    /// @inheritdoc IAtomicStaking
    function availableRewardsToClaim(address user) external view override returns (uint256) {
        uint256 totalBalance = TOKEN.balanceOf(address(this));
        uint256 totalStaked = _totalStaked;
        if (totalBalance <= totalStaked) {
            return 0;
        }

        (uint256 earnedRewards, ) = _earnedRewards(user);
        uint256 totalRewards = _stakeStates[user].contractDeptToUser + earnedRewards;

        uint256 availableBalance = totalBalance - totalStaked;
        if (totalRewards <= availableBalance) {
            return totalRewards;
        } else {
            return availableBalance;
        }
    }

    /// @inheritdoc IAtomicStaking
    /// @dev A separate getter is needed to specify in the interface that
    /// the struct `StakeState` is the return type, not just the tuple of variables.
    /// Without this getter the interface should have a tuple of variables as the return type of this function.
    function stakeStates(
        address user
    ) external view override returns (StakeState memory stakeState) {
        return _stakeStates[user];
    }

    /// @inheritdoc IAtomicStaking
    /// @dev A separate getter is needed to specify in the interface that
    /// the struct `WithdrawState` is the return type, not just the tuple of variables.
    /// Without this getter the interface should have a tuple of variables as the return type of this function.
    function withdrawStates(
        uint256 withdrawId
    ) external view override returns (WithdrawState memory withdrawState) {
        return _withdrawStates[withdrawId];
    }

    /* PRIVATE FUNCTIONS */

    function _updateRate() private {
        uint256 totalStaked = _totalStaked;
        if (totalStaked == 0) {
            _lastRateUpdateTimestamp = block.timestamp;
            return;
        }

        (uint256 newRatePerStaking, bool needUpdate) = _getNewRatePerStaking();
        if (needUpdate) {
            _ratePerStaking = newRatePerStaking;

            _lastRateUpdateTimestamp = block.timestamp;

            emit RateUpdated(newRatePerStaking);
        }
    }

    function _collectRewards(address user) private {
        _updateRate();

        (uint256 earnedRewards, uint256 allRewards) = _earnedRewards(user);
        uint256 contractDeptToUser = _stakeStates[user].contractDeptToUser;
        uint256 totalRewards = earnedRewards + contractDeptToUser;
        if (totalRewards > 0) {
            if (earnedRewards > 0) {
                _stakeStates[user].claimedAmount = allRewards;
            }

            uint256 totalBalance = TOKEN.balanceOf(address(this));
            uint256 totalStaked = _totalStaked;
            if (totalBalance <= totalStaked) {
                if (totalRewards != contractDeptToUser) {
                    _stakeStates[user].contractDeptToUser = totalRewards;

                    emit DeptToUserChanged(user, contractDeptToUser, totalRewards);
                }
                return;
            }

            uint256 availableBalance = totalBalance - totalStaked;
            if (availableBalance < totalRewards) {
                uint256 newContractDeptToUser = totalRewards - availableBalance;
                if (newContractDeptToUser != contractDeptToUser) {
                    _stakeStates[user].contractDeptToUser = newContractDeptToUser;

                    emit DeptToUserChanged(
                        user,
                        contractDeptToUser,
                        totalRewards - availableBalance
                    );
                }

                // availableBalance > 0
                TOKEN.safeTransfer(user, availableBalance);

                emit RewardsClaimed(user, availableBalance);
            } else {
                if (contractDeptToUser > 0) {
                    _stakeStates[user].contractDeptToUser = 0;

                    emit DeptToUserChanged(user, contractDeptToUser, 0);
                }

                TOKEN.safeTransfer(user, totalRewards);

                emit RewardsClaimed(user, totalRewards);
            }
        }
    }

    function _earnedRewards(
        address user
    ) private view returns (uint256 earnedRewards, uint256 allRewards) {
        uint256 stakeAmount = _stakeStates[user].stakeAmount;

        if (stakeAmount == 0) {
            return (0, 0);
        }

        uint256 claimedAmount = _stakeStates[user].claimedAmount;
        (uint256 ratePerStaking, ) = _getNewRatePerStaking();
        allRewards = (stakeAmount * ratePerStaking) / _RATE_PRECISION;

        if (allRewards <= claimedAmount) {
            return (0, allRewards);
        }
        return (allRewards - claimedAmount, allRewards);
    }

    function _getNewRatePerStaking()
        private
        view
        returns (uint256 newRatePerStaking, bool needUpdate)
    {
        uint256 lastRateUpdateTimestamp = _lastRateUpdateTimestamp;
        if (lastRateUpdateTimestamp == block.timestamp) {
            return (_ratePerStaking, false);
        } else {
            uint256 oldRatePerStaking = _ratePerStaking;
            newRatePerStaking =
                oldRatePerStaking +
                (oldRatePerStaking * (block.timestamp - lastRateUpdateTimestamp) * apr) /
                (_ONE_YEAR * _PERCENT_DENOMINATOR);
            return (newRatePerStaking, true);
        }
    }
}
