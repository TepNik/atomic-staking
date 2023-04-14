# Solidity API

## AtomicStaking

_This contract can also be used for other ERC20 tokens as well._

### MANAGER_ROLE

```solidity
bytes32 MANAGER_ROLE
```

The `MANAGER_ROLE` identifier.
This role can manage contract (call admins' functions), but can't add or remove other managers.

### TOKEN

```solidity
contract IERC20 TOKEN
```

Address of the token that the contract is staking.

### minStakeAmount

```solidity
uint256 minStakeAmount
```

Minimum amount of a stake.

_The change of this variable will affect only new stakes._

### apr

```solidity
uint256 apr
```

The APR of the staking. The denominator is `100_00`.

_In case of chaging of the APR, this change doesn't affect the rewards that the users earned before it.
It only affects new earnings._

### TokenStaked

```solidity
event TokenStaked(address user, uint256 amount)
```

Event is emmited when a user staked the token.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The user that staked the token |
| amount | uint256 | Staked amount of the token |

### MinStakeAmountChanged

```solidity
event MinStakeAmountChanged(uint256 oldValue, uint256 newValue)
```

Event is emmited when an admin changes the `minStakeAmount` global variable.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| oldValue | uint256 | The old value of the `minStakeAmount` global variable |
| newValue | uint256 | The new value of the `minStakeAmount` global variable |

### AprChanged

```solidity
event AprChanged(uint256 oldValue, uint256 newValue)
```

Event is emmited when an admin changes the `apr` global variable.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| oldValue | uint256 | The old value of the `apr` global variable |
| newValue | uint256 | The new value of the `apr` global variable |

### RateUpdated

```solidity
event RateUpdated(uint256 newRate)
```

Event is emmited when the `_ratePerStaking` global variable is changed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| newRate | uint256 | The new value of the `_ratePerStaking` global variable |

### TokensDonated

```solidity
event TokensDonated(address donator, uint256 amount)
```

Event is emmited when the `donator` address have donated `amount` number of tokens to the contract
that will be distributed as rewards to the stakers.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| donator | address | The address of a donator |
| amount | uint256 | The donated amount |

### DeptToUserChanged

```solidity
event DeptToUserChanged(address user, uint256 oldAmount, uint256 newAmount)
```

Event is emmited when the `contractDeptToUser` field in the structure `StakeState` has changed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of a user which has this parameter changed |
| oldAmount | uint256 | The old amount of the `contractDeptToUser` field |
| newAmount | uint256 | The new amount of the `contractDeptToUser` field |

### RewardsClaimed

```solidity
event RewardsClaimed(address user, uint256 amount)
```

Event is emmited when a user claims his rewards.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | A user that has claimed his rewards |
| amount | uint256 | Amount of the tokens that the user claimed |

### ExcessiveBalanceWithdrawn

```solidity
event ExcessiveBalanceWithdrawn(address user, uint256 withdrawnAmount)
```

Event is emmited when an admin (`DEFAULT_ADMIN_ROLE` role only) withdraws
some or all tokens that were supposed to be distrubuted to the stakers as their rewards.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The admin that withdrawn tokens |
| withdrawnAmount | uint256 | Withdrawn amount |

### WithdrawRequested

```solidity
event WithdrawRequested(address user, uint256 amount, uint256 withdrawId)
```

Event is emmited when a user requests withdrawal request. Withdrawn tokens are locked for a cooling period.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | A user's address |
| amount | uint256 | Withdraw amount |
| withdrawId | uint256 | Withdraw request identifier |

### WithdrawIdFinalized

```solidity
event WithdrawIdFinalized(address user, uint256 amount, uint256 withdrawId)
```

Event is emmited when a user finalized his tokens.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | A user's address |
| amount | uint256 | Finalized amount |
| withdrawId | uint256 | Withdraw request identifier |

### AddressZero

```solidity
error AddressZero()
```

A transaction reverted with this error when a zero address is passed as an argument to a function.

### LessThanMinAmount

```solidity
error LessThanMinAmount(uint256 suppliedAmount, uint256 minStakeAmount)
```

A transaction reverted with this error when a user tries to stake the token, but
staked amount `suppliedAmount` is less than minimum allowed amount `minStakeAmount`.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| suppliedAmount | uint256 | Amount of the token that a user tried to stake |
| minStakeAmount | uint256 | Minimum amount of the token that are required for a stake |

### TheSameValue

```solidity
error TheSameValue()
```

A transaction reverted with this error when an admin tries to change a global variable to the same value.

### TooBigValue

```solidity
error TooBigValue(uint256 passedValue, uint256 maxValue)
```

A transaction reverted with this error when a user passes too big argument.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| passedValue | uint256 | The value that the user passed |
| maxValue | uint256 | The maximum allowed value |

### ZeroValue

```solidity
error ZeroValue()
```

A transaction reverted with this error when a user passes zero argument.

### NoSuchWithdrawId

```solidity
error NoSuchWithdrawId(uint256 withdrawId)
```

A transaction reverted with this error when a user tries to finalize a non-existent withdrawal request.

### NotAllowedUser

```solidity
error NotAllowedUser(address sender, address allowedUser)
```

A transaction reverted with this error when a user tries to finilize not his withdrawal request.

### WithdrawIdNotFinalizableYet

```solidity
error WithdrawIdNotFinalizableYet(uint256 timestampNow, uint256 coolingPeriodEnd)
```

A transaction reverted with this error when a user tries to finilize not finalizable withdrawal request.

### constructor

```solidity
constructor(contract IERC20 token, uint256 _minStakeAmount, uint256 _apr) public
```

_Deployer of the contract will have `DEFAULT_ADMIN_ROLE` role.
Also, the `_apr` argument can't be bigger than `_PERCENT_DENOMINATOR` to prevent too big values._

### stake

```solidity
function stake(uint256 amount) external
```

Function for a user to stake his tokens.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | Amount to stake |

### requestWithdraw

```solidity
function requestWithdraw(uint256 amount) external returns (uint256 withdrawId)
```

Function for a user to request a withdraw of his tokens. Withdrawn tokens are locked for a cooling period.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | Amount a user wants to withdraw |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| withdrawId | uint256 | Id of a withdrawal request. This id should be used to fully withdraw cooled tokens. |

### finalizeWithdraw

```solidity
function finalizeWithdraw(uint256 withdrawId) external
```

Function for a user to finalize a withdrawn of his tokens.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| withdrawId | uint256 | A withdraw id that should be finalized |

### claimRewards

```solidity
function claimRewards() external
```

Function for a user to claim his rewards.

### donateTokensToRewards

```solidity
function donateTokensToRewards(uint256 amount) external
```

Function to donate tokens to this contract.

_Open to anyone. Also, the tokens can be transfered to the contract by the ordinary `transfer` function.
The contract looks in the `balanceOf` function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | Amount of tokens to donate |

### setMinStakeAmount

```solidity
function setMinStakeAmount(uint256 newAmount) external
```

Admins' function to set the `minStakeAmount` global variable to the new value `newAmount`.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| newAmount | uint256 | New value of the `minStakeAmount` global variable |

### setApr

```solidity
function setApr(uint256 newValue) external
```

Admins' function to set the `apr` global variable to the new value `newValue`.

_The `newValue` argument can't be bigger than `_PERCENT_DENOMINATOR` to prevent too big values._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| newValue | uint256 | New value of the `apr` global variable |

### receiveExcessiveBalance

```solidity
function receiveExcessiveBalance(uint256 amount) external
```

Admins' function to get excessive balance of the contract. Excessive balance is everithing that is bigger than total staked tokens.

_The function is available to the `DEFAULT_ADMIN_ROLE` role only. The amount will be ceiled by the available amount to withdraw._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | Amount ot withdraw |

### availableRewardsToClaim

```solidity
function availableRewardsToClaim(address user) external view returns (uint256)
```

Function to get amount of tokens that are available to claim right now.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of a user |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 |  |

### stakeStates

```solidity
function stakeStates(address user) external view returns (struct IAtomicStaking.StakeState stakeState)
```

The mapping that connects users' addresses with their stake state.

_A separate getter is needed to specify in the interface that
the struct `StakeState` is the return type, not just the tuple of variables.
Without this getter the interface should have a tuple of variables as the return type of this function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | A user's address |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| stakeState | struct IAtomicStaking.StakeState | The `StakeState` structure that holds information about the user's stake |

### withdrawStates

```solidity
function withdrawStates(uint256 withdrawId) external view returns (struct IAtomicStaking.WithdrawState withdrawState)
```

The mapping that connects withdraw id with their withdraw state.

_A separate getter is needed to specify in the interface that
the struct `WithdrawState` is the return type, not just the tuple of variables.
Without this getter the interface should have a tuple of variables as the return type of this function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| withdrawId | uint256 | A withdraw id, that the `requestWithdraw` function returned |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| withdrawState | struct IAtomicStaking.WithdrawState | The `WithdrawState` structure that holds information about the user's withdraw |

