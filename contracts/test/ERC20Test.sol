// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Test is ERC20("Name", "Symbol") {
    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
