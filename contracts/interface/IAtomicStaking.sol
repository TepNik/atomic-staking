// SPDX-License-Identifier: UNLICENSED

pragma solidity >=0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAtomicStaking {
    struct StakeState {
        uint256 stakeAmount;
        uint256 claimedAmount;
        uint256 contractDeptToUser;
    }
    struct WithdrawState {
        address user;
        uint64 withdrawTimestamp;
        uint256 amount;
    }

    /* PUBLIC STATE VARIABLES */

    /// @notice The `MANAGER_ROLE` identifier.
    /// This role can manage contract (call admins' functions), but can't add or remove other managers.
    function MANAGER_ROLE() external view returns (bytes32);

    /// @notice Address of the token that the contract is staking.
    function TOKEN() external view returns (IERC20);

    /// @notice Minimum amount of a stake.
    /// @dev The change of this variable will affect only new stakes.
    function minStakeAmount() external view returns (uint256);

    /// @notice The APR of the staking. The denominator is `100_00`.
    /// @dev In case of chaging of the APR, this change doesn't affect the rewards that the users earned before it.
    /// It only affects new earnings.
    function apr() external view returns (uint256);

    /// @notice Amount of the tokens that users have staked.
    function totalStaked() external view returns (uint256);

    /// @notice Timestamp of the contract's last update.
    function lastRateUpdateTimestamp() external view returns (uint256);

    /* USERS' FUNCTIONS */

    /// @notice Function for a user to stake his tokens.
    /// @param amount Amount to stake
    function stake(uint256 amount) external;

    /// @notice Function for a user to request a withdraw of his tokens. Withdrawn tokens are locked for a cooling period.
    /// @param amount Amount a user wants to withdraw
    /// @return withdrawId Id of a withdrawal request. This id should be used to fully withdraw cooled tokens.
    function requestWithdraw(uint256 amount) external returns (uint256 withdrawId);

    /// @notice Function for a user to finalize a withdrawn of his tokens.
    /// @param withdrawId A withdraw id that should be finalized
    function finalizeWithdraw(uint256 withdrawId) external;

    /// @notice Function for a user to claim his rewards.
    function claimRewards() external;

    /// @notice Function to donate tokens to this contract.
    /// @dev Open to anyone. Also, the tokens can be transfered to the contract by the ordinary `transfer` function.
    /// The contract looks in the `balanceOf` function.
    /// @param amount Amount of tokens to donate
    function donateTokensToRewards(uint256 amount) external;

    /* ADMINS' FUNCTIONS */

    /// @notice Admins' function to set the `minStakeAmount` global variable to the new value `newAmount`.
    /// @param newAmount New value of the `minStakeAmount` global variable
    function setMinStakeAmount(uint256 newAmount) external;

    /// @notice Admins' function to set the `apr` global variable to the new value `newValue`.
    /// @dev The `newValue` argument can't be bigger than `_PERCENT_DENOMINATOR` to prevent too big values.
    /// @param newValue New value of the `apr` global variable
    function setApr(uint256 newValue) external;

    /// @notice Admins' function to get excessive balance of the contract. Excessive balance is everithing that is bigger than total staked tokens.
    /// @param amount Amount ot withdraw
    /// @dev The function is available to the `DEFAULT_ADMIN_ROLE` role only. The amount will be ceiled by the available amount to withdraw.
    function receiveExcessiveBalance(uint256 amount) external;

    /* GETTERS */

    /// @notice Function to get amount of tokens that are available to claim right now.
    /// @param user Address of a user
    /// @return rewardsToClaim Amount of tokens that are available to claim right now
    function availableRewardsToClaim(address user) external view returns (uint256 rewardsToClaim);

    /// @notice The mapping that connects users' addresses with their stake state.
    /// @param user A user's address
    /// @return stakeState The `StakeState` structure that holds information about the user's stake
    function stakeStates(address user) external view returns (StakeState memory stakeState);

    /// @notice The mapping that connects withdraw id with their withdraw state.
    /// @param withdrawId A withdraw id, that the `requestWithdraw` function returned
    /// @return withdrawState The `WithdrawState` structure that holds information about the user's withdraw
    function withdrawStates(
        uint256 withdrawId
    ) external view returns (WithdrawState memory withdrawState);
}
