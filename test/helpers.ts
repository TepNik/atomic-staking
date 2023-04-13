import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import "../typechain-types";

import { config } from "../config";
import { Ten } from "./constants";

export async function prepareEnv() {
    const prevEnv = await loadFixture(prepareEnvWithoutStakingDeployment);

    const stakingInst = await prevEnv.StakingFactory.deploy(
        prevEnv.erc20Inst.address,
        prevEnv.minStakeAmount,
        prevEnv.apr
    );
    const deployBlockNumber = stakingInst.deployTransaction.blockNumber;
    const deployBlock = await ethers.provider.getBlock(deployBlockNumber ?? "latest");
    const deployTimestamp = deployBlock.timestamp;

    const DEFAULT_ADMIN_ROLE = await stakingInst.DEFAULT_ADMIN_ROLE();
    const MANAGER_ROLE = await stakingInst.MANAGER_ROLE();

    await stakingInst.grantRole(MANAGER_ROLE, prevEnv.manager.address);

    const donatedTokens = prevEnv.oneToken.mul(100_000);
    await prevEnv.erc20Inst.mint(donatedTokens);
    await prevEnv.erc20Inst.approve(stakingInst.address, donatedTokens);
    await stakingInst.donateTokensToRewards(donatedTokens);

    return {
        ...prevEnv,

        DEFAULT_ADMIN_ROLE,
        MANAGER_ROLE,

        stakingInst,
        deployTimestamp,
        donatedTokens,
    };
}

export async function prepareEnvWithoutStakingDeployment() {
    const [deployer, manager, bob, alice, ...signers] = await ethers.getSigners();

    const ERC20TestFactory = await ethers.getContractFactory("ERC20Test");
    const erc20Inst = await ERC20TestFactory.deploy();

    const decimals = await erc20Inst.decimals();
    const oneToken = Ten.pow(decimals);
    const minStakeAmount = oneToken.mul(50);
    expect(minStakeAmount).greaterThan(0, "Too small minStakeAmount");

    const apr = config.deploy.apr;
    expect(apr).lessThanOrEqual(100_00, "Too big APR");

    const StakingFactory = await ethers.getContractFactory("AtomicStaking");

    return {
        deployer,
        manager,
        bob,
        alice,

        erc20Inst,
        oneToken,
        minStakeAmount,
        apr,

        StakingFactory,
    };
}
