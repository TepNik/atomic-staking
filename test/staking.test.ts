import { expect } from "chai";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";

import {
    prepareEnv,
    prepareEnvWithoutStakingDeployment,
    prepareEnvWithoutDonation,
    prepareEnvWithAliceStake,
    prepareEnvWithAliceStakeWithoutDonation,
} from "./helpers";
import { config } from "../config";
import { ethers, network } from "hardhat";

import {
    ONE_DAY,
    ONE_YEAR,
    RATE_PRECISION,
    PERCENT_DENOMINATOR,
    COOLING_PERIOD,
} from "./constants";

describe("Tests of the AtomicStaking contract", () => {
    describe("{constructor}", () => {
        it("Deploy test", async () => {
            const env = await loadFixture(prepareEnv);

            expect(await env.stakingInst.TOKEN()).equals(env.erc20Inst.address);
            expect(await env.stakingInst.minStakeAmount()).equals(config.deploy.minStakeAmount);

            expect(await env.stakingInst.hasRole(env.DEFAULT_ADMIN_ROLE, env.deployer.address))
                .true;
            expect(await env.stakingInst.hasRole(env.MANAGER_ROLE, env.deployer.address)).false;

            expect(await env.stakingInst.hasRole(env.DEFAULT_ADMIN_ROLE, env.manager.address))
                .false;
            expect(await env.stakingInst.hasRole(env.MANAGER_ROLE, env.manager.address)).true;

            const deployTx = await env.stakingInst.deployTransaction.wait();
            expect(
                deployTx.logs.findIndex((event) => {
                    return (
                        event.topics[0] ==
                        env.stakingInst.interface.getEventTopic("MinStakeAmountChanged")
                    );
                })
            ).not.equals(-1);

            expect(
                deployTx.logs.findIndex((event) => {
                    return event.topics[0] == env.stakingInst.interface.getEventTopic("AprChanged");
                })
            ).not.equals(-1);
        });

        it("Deploy with zero {minStakeAmount}", async () => {
            const env = await loadFixture(prepareEnvWithoutStakingDeployment);

            const stakingInst = await env.StakingFactory.deploy(env.erc20Inst.address, 0, env.apr);
            const deployTx = await stakingInst.deployTransaction.wait();
            expect(
                deployTx.logs.findIndex((event) => {
                    return (
                        event.topics[0] ==
                        stakingInst.interface.getEventTopic("MinStakeAmountChanged")
                    );
                })
            ).equals(-1);
        });

        it("Deploy with zero {apr}", async () => {
            const env = await loadFixture(prepareEnvWithoutStakingDeployment);

            const stakingInst = await env.StakingFactory.deploy(
                env.erc20Inst.address,
                env.minStakeAmount,
                0
            );
            const deployTx = await stakingInst.deployTransaction.wait();
            expect(
                deployTx.logs.findIndex((event) => {
                    return event.topics[0] == stakingInst.interface.getEventTopic("AprChanged");
                })
            ).equals(-1);
        });

        describe("Reverts", () => {
            it("Should revert when passing zero address", async () => {
                const env = await loadFixture(prepareEnvWithoutStakingDeployment);

                await expect(
                    env.StakingFactory.deploy(
                        ethers.constants.AddressZero,
                        env.minStakeAmount,
                        env.apr
                    )
                ).revertedWithCustomError(env.StakingFactory, "AddressZero");
            });

            it("Should revert when too big {apr} value", async () => {
                const env = await loadFixture(prepareEnvWithoutStakingDeployment);

                await expect(
                    env.StakingFactory.deploy(env.erc20Inst.address, env.minStakeAmount, 100_01)
                )
                    .revertedWithCustomError(env.StakingFactory, "TooBigValue")
                    .withArgs(100_01, 100_00);
            });
        });
    });

    describe("{stake} function", () => {
        it("Test stake", async () => {
            const env = await loadFixture(prepareEnv);

            const stakeAmount = env.oneToken.mul(1000);
            expect(stakeAmount).greaterThanOrEqual(env.minStakeAmount, "Too small stake amount");

            await env.erc20Inst.connect(env.alice).mint(stakeAmount);
            await env.erc20Inst.connect(env.alice).approve(env.stakingInst.address, stakeAmount);

            await expect(env.stakingInst.connect(env.alice).stake(stakeAmount))
                .emit(env.stakingInst, "TokenStaked")
                .withArgs(env.alice.address, stakeAmount)
                .not.emit(env.stakingInst, "RateUpdated")
                .not.emit(env.stakingInst, "RewardsClaimed");

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                stakeAmount.add(env.donatedTokens)
            );

            const stakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(stakeState.stakeAmount).equals(stakeAmount);
            expect(stakeState.claimedAmount).equals(stakeAmount);
            expect(stakeState.contractDeptToUser).equals(0);
        });

        it("Test two stakes different users", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            // Bob stake
            const bobStakeAmount = env.aliceAmountToStake.mul(2);
            expect(bobStakeAmount).greaterThanOrEqual(env.minStakeAmount, "Too small stake amount");
            const bobStakeTimestamp = env.aliceStakeTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.bob).mint(bobStakeAmount);
            await env.erc20Inst.connect(env.bob).approve(env.stakingInst.address, bobStakeAmount);

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(bobStakeTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            await time.setNextBlockTimestamp(bobStakeTimestamp);
            await expect(env.stakingInst.connect(env.bob).stake(bobStakeAmount))
                .emit(env.stakingInst, "TokenStaked")
                .withArgs(env.bob.address, bobStakeAmount)
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .not.emit(env.stakingInst, "RewardsClaimed");

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                env.aliceAmountToStake.add(bobStakeAmount).add(env.donatedTokens)
            );

            const stakeStateBob = await env.stakingInst.stakeStates(env.bob.address);
            expect(stakeStateBob.stakeAmount).equals(bobStakeAmount);
            expect(stakeStateBob.claimedAmount).equals(
                bobStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(stakeStateBob.contractDeptToUser).equals(0);
        });

        it("Test two stakes one user", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            // Alice second stake
            const aliceSecondStakeAmount = env.aliceAmountToStake.mul(2);
            expect(aliceSecondStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const aliceSecondStakeTimestamp = env.aliceStakeTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(aliceSecondStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, aliceSecondStakeAmount);

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(aliceSecondStakeTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            await time.setNextBlockTimestamp(aliceSecondStakeTimestamp);
            await expect(env.stakingInst.connect(env.alice).stake(aliceSecondStakeAmount))
                .emit(env.stakingInst, "TokenStaked")
                .withArgs(env.alice.address, aliceSecondStakeAmount)
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "RewardsClaimed")
                .withArgs(env.alice.address, claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                env.aliceAmountToStake
                    .add(aliceSecondStakeAmount)
                    .add(env.donatedTokens)
                    .sub(claimedRewards)
            );

            const stakeStateBob = await env.stakingInst.stakeStates(env.alice.address);
            expect(stakeStateBob.stakeAmount).equals(
                env.aliceAmountToStake.add(aliceSecondStakeAmount)
            );
            expect(stakeStateBob.claimedAmount).equals(
                env.aliceAmountToStake
                    .add(aliceSecondStakeAmount)
                    .mul(newRatePerStaking)
                    .div(RATE_PRECISION)
            );
            expect(stakeStateBob.contractDeptToUser).equals(0);
        });

        describe("Reverts", () => {
            it("Should revert when supplying less than minimum amount", async () => {
                const env = await loadFixture(prepareEnv);

                const stakeAmount = env.minStakeAmount.sub(1);
                await expect(env.stakingInst.stake(stakeAmount))
                    .revertedWithCustomError(env.stakingInst, "LessThanMinAmount")
                    .withArgs(stakeAmount, env.minStakeAmount);
            });
        });
    });

    describe("{claimRewards} function", () => {
        it("Claim with enough reward balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            // Claim
            const claimTimestamp = env.aliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            await time.setNextBlockTimestamp(claimTimestamp);
            await expect(env.stakingInst.connect(env.alice).claimRewards())
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "RewardsClaimed")
                .withArgs(env.alice.address, claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                env.aliceAmountToStake.add(env.donatedTokens).sub(claimedRewards)
            );

            const secondStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(secondStakeState.stakeAmount).equals(env.aliceAmountToStake);
            expect(secondStakeState.claimedAmount).equals(
                env.aliceAmountToStake.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(secondStakeState.contractDeptToUser).equals(0);
        });

        it("Claim with almost enough reward balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

            // Claim
            const claimTimestamp = env.aliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            const tokenToDonate = claimedRewards.div(3);
            await env.erc20Inst.mint(tokenToDonate);
            await env.erc20Inst.approve(env.stakingInst.address, tokenToDonate);
            await env.stakingInst.donateTokensToRewards(tokenToDonate);

            await time.setNextBlockTimestamp(claimTimestamp);
            await expect(env.stakingInst.connect(env.alice).claimRewards())
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "DeptToUserChanged")
                .withArgs(env.alice.address, 0, claimedRewards.sub(tokenToDonate))
                .emit(env.stakingInst, "RewardsClaimed")
                .withArgs(env.alice.address, tokenToDonate);

            expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(tokenToDonate);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                env.aliceAmountToStake
            );

            const secondStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(secondStakeState.stakeAmount).equals(env.aliceAmountToStake);
            expect(secondStakeState.claimedAmount).equals(
                env.aliceAmountToStake.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(secondStakeState.contractDeptToUser).equals(claimedRewards.sub(tokenToDonate));
        });

        it("Claim with no reward balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

            // Claim rewards
            const claimTimestamp = env.aliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            await time.setNextBlockTimestamp(claimTimestamp);
            await expect(env.stakingInst.connect(env.alice).claimRewards())
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "DeptToUserChanged")
                .withArgs(env.alice.address, 0, claimedRewards)
                .not.emit(env.stakingInst, "RewardsClaimed");

            expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(0);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                env.aliceAmountToStake
            );

            const aliceStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(aliceStakeState.stakeAmount).equals(env.aliceAmountToStake);
            expect(aliceStakeState.claimedAmount).equals(
                env.aliceAmountToStake.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(aliceStakeState.contractDeptToUser).equals(claimedRewards);
        });

        describe("After first claim with no reward balance", () => {
            it("Second claim with no reward balance", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const firstClaimTimestamp = env.aliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - env.aliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );
                const thirdRatePerStaking = secondRatePerStaking.add(
                    secondRatePerStaking
                        .mul(secondClaimTimestamp - firstClaimTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                const secondClaimedRewards = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(env.aliceAmountToStake);

                const secondClaimedAmount = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = env.aliceAmountToStake
                    .mul(thirdRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(secondClaimedAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();
                await time.setNextBlockTimestamp(secondClaimTimestamp);
                await expect(env.stakingInst.connect(env.alice).claimRewards())
                    .emit(env.stakingInst, "DeptToUserChanged")
                    .withArgs(
                        env.alice.address,
                        secondClaimedRewards,
                        secondClaimedRewards.add(thirdClaimedRewards)
                    )
                    .emit(env.stakingInst, "RateUpdated")
                    .withArgs(thirdRatePerStaking)
                    .not.emit(env.stakingInst, "RewardsClaimed");

                expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(0);

                expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                    env.aliceAmountToStake
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(env.aliceAmountToStake);
                expect(thirdStakeState.claimedAmount).equals(
                    env.aliceAmountToStake.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(
                    secondClaimedRewards.add(thirdClaimedRewards)
                );
            });

            it("Second claim with enough rewards balance", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const firstClaimTimestamp = env.aliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - env.aliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );
                const thirdRatePerStaking = secondRatePerStaking.add(
                    secondRatePerStaking
                        .mul(secondClaimTimestamp - firstClaimTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                const secondClaimedRewards = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(env.aliceAmountToStake);

                const secondClaimedAmount = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = env.aliceAmountToStake
                    .mul(thirdRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(secondClaimedAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();

                const donatedTokens = env.oneToken.mul(1000);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.erc20Inst.mint(donatedTokens);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.erc20Inst.approve(env.stakingInst.address, donatedTokens);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.donateTokensToRewards(donatedTokens);

                await time.setNextBlockTimestamp(secondClaimTimestamp);
                await expect(env.stakingInst.connect(env.alice).claimRewards())
                    .emit(env.stakingInst, "DeptToUserChanged")
                    .withArgs(env.alice.address, secondClaimedRewards, 0)
                    .emit(env.stakingInst, "RateUpdated")
                    .withArgs(thirdRatePerStaking)
                    .emit(env.stakingInst, "RewardsClaimed")
                    .withArgs(env.alice.address, secondClaimedRewards.add(thirdClaimedRewards));

                expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(
                    secondClaimedRewards.add(thirdClaimedRewards)
                );

                expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                    env.aliceAmountToStake
                        .add(donatedTokens)
                        .sub(secondClaimedRewards.add(thirdClaimedRewards))
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(env.aliceAmountToStake);
                expect(thirdStakeState.claimedAmount).equals(
                    env.aliceAmountToStake.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(0);
            });

            it("Second claim with enough rewards balance only for [second stake timestamp; third stake timestamp]", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const firstClaimTimestamp = env.aliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - env.aliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );
                const thirdRatePerStaking = secondRatePerStaking.add(
                    secondRatePerStaking
                        .mul(secondClaimTimestamp - firstClaimTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                const secondClaimedRewards = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(env.aliceAmountToStake);

                const secondClaimedAmount = env.aliceAmountToStake
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = env.aliceAmountToStake
                    .mul(thirdRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(secondClaimedAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.erc20Inst.mint(thirdClaimedRewards);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.erc20Inst.approve(env.stakingInst.address, thirdClaimedRewards);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.donateTokensToRewards(thirdClaimedRewards);

                await time.setNextBlockTimestamp(secondClaimTimestamp);
                await expect(env.stakingInst.connect(env.alice).claimRewards())
                    .emit(env.stakingInst, "RateUpdated")
                    .withArgs(thirdRatePerStaking)
                    .emit(env.stakingInst, "RewardsClaimed")
                    .withArgs(env.alice.address, thirdClaimedRewards)
                    .not.emit(env.stakingInst, "DeptToUserChanged");

                expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(
                    thirdClaimedRewards
                );

                expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                    env.aliceAmountToStake
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(env.aliceAmountToStake);
                expect(thirdStakeState.claimedAmount).equals(
                    env.aliceAmountToStake.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(secondClaimedRewards);
            });

            it("Second claim with the same timestamp as the second claim", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const firstClaimTimestamp = env.aliceStakeTimestamp + ONE_DAY;

                const newRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - env.aliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                const claimedRewards = env.aliceAmountToStake
                    .mul(newRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(env.aliceAmountToStake);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await expect(env.stakingInst.connect(env.alice).claimRewards())
                    .not.emit(env.stakingInst, "DeptToUserChanged")
                    .not.emit(env.stakingInst, "RateUpdated")
                    .not.emit(env.stakingInst, "RewardsClaimed");

                expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(0);

                expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                    env.aliceAmountToStake
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(env.aliceAmountToStake);
                expect(thirdStakeState.claimedAmount).equals(
                    env.aliceAmountToStake.mul(newRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(claimedRewards);
            });
        });
    });

    describe("{requestWithdraw} function", () => {
        it("Two withdrawals different users", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            const bobStakeTimestamp = env.aliceStakeTimestamp + ONE_DAY * 2;
            const bobAmountToStake = env.oneToken.mul(1000);
            await env.erc20Inst.connect(env.bob).mint(bobAmountToStake);
            await env.erc20Inst.connect(env.bob).approve(env.stakingInst.address, bobAmountToStake);
            await time.setNextBlockTimestamp(bobStakeTimestamp);
            await env.stakingInst.connect(env.bob).stake(bobAmountToStake);

            const aliceWithdrawTimestamp = bobStakeTimestamp + ONE_DAY * 2;
            const aliceWithdrawAmount = env.aliceAmountToStake.div(3);

            const bobStakeRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(bobStakeTimestamp - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR * PERCENT_DENOMINATOR)
            );
            const aliceWithdrawRatePerStaking = bobStakeRatePerStaking.add(
                bobStakeRatePerStaking
                    .mul(aliceWithdrawTimestamp - bobStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR * PERCENT_DENOMINATOR)
            );
            const aliceClaimedAmount = env.aliceAmountToStake
                .sub(aliceWithdrawAmount)
                .mul(aliceWithdrawRatePerStaking)
                .div(RATE_PRECISION);

            const aliceWithdrawId = await env.stakingInst
                .connect(env.alice)
                .callStatic.requestWithdraw(aliceWithdrawAmount);
            expect(aliceWithdrawId).equals(1);

            await time.setNextBlockTimestamp(aliceWithdrawTimestamp);
            await expect(env.stakingInst.connect(env.alice).requestWithdraw(aliceWithdrawAmount))
                .emit(env.stakingInst, "WithdrawRequested")
                .withArgs(env.alice.address, aliceWithdrawAmount, 1);

            const aliceWithdrawState = await env.stakingInst.withdrawStates(1);
            expect(aliceWithdrawState.user).equals(env.alice.address);
            expect(aliceWithdrawState.amount).equals(aliceWithdrawAmount);
            expect(aliceWithdrawState.withdrawTimestamp).equals(aliceWithdrawTimestamp);

            const aliceStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(aliceStakeState.stakeAmount).equals(
                env.aliceAmountToStake.sub(aliceWithdrawAmount)
            );
            expect(aliceStakeState.claimedAmount).equals(aliceClaimedAmount);
            expect(aliceStakeState.contractDeptToUser).equals(0);

            const bobWithdrawTimestamp = aliceWithdrawTimestamp + ONE_DAY * 3;
            const bobWithdrawAmount = bobAmountToStake.div(2);
            const bobWithdrawRatePerStaking = aliceWithdrawRatePerStaking.add(
                aliceWithdrawRatePerStaking
                    .mul(bobWithdrawTimestamp - aliceWithdrawTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR * PERCENT_DENOMINATOR)
            );
            const bobClaimedAmount = bobAmountToStake
                .sub(bobWithdrawAmount)
                .mul(bobWithdrawRatePerStaking)
                .div(RATE_PRECISION);

            const bobWithdrawId = await env.stakingInst
                .connect(env.bob)
                .callStatic.requestWithdraw(bobWithdrawAmount);
            expect(bobWithdrawId).equals(2);

            await time.setNextBlockTimestamp(bobWithdrawTimestamp);
            await expect(env.stakingInst.connect(env.bob).requestWithdraw(bobWithdrawAmount))
                .emit(env.stakingInst, "WithdrawRequested")
                .withArgs(env.bob.address, bobWithdrawAmount, 2);

            const bobWithdrawState = await env.stakingInst.withdrawStates(2);
            expect(bobWithdrawState.user).equals(env.bob.address);
            expect(bobWithdrawState.amount).equals(bobWithdrawAmount);
            expect(bobWithdrawState.withdrawTimestamp).equals(bobWithdrawTimestamp);

            const bobStakeState = await env.stakingInst.stakeStates(env.bob.address);
            expect(bobStakeState.stakeAmount).equals(bobAmountToStake.sub(bobWithdrawAmount));
            expect(bobStakeState.claimedAmount).equals(bobClaimedAmount);
            expect(bobStakeState.contractDeptToUser).equals(0);
        });

        it("Test rewards", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            const balanceBefore = await env.erc20Inst.balanceOf(env.alice.address);

            const withdrawRequestTime = env.aliceStakeTimestamp + ONE_DAY * 2;
            await time.setNextBlockTimestamp(withdrawRequestTime);
            await mine();
            const availableRewardsToClaim = await env.stakingInst.availableRewardsToClaim(
                env.alice.address
            );
            await time.setNextBlockTimestamp(withdrawRequestTime);
            await env.stakingInst.connect(env.alice).requestWithdraw(env.aliceAmountToStake);

            const balanceAfter = await env.erc20Inst.balanceOf(env.alice.address);
            expect(balanceAfter.sub(balanceBefore)).equals(availableRewardsToClaim);
        });

        it("User's withdraw doesn't go to rewards to other users", async () => {
            const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

            const bobAmountToStake = env.aliceAmountToStake.mul(2);
            const bobStakeTimestamp = env.aliceStakeTimestamp + ONE_DAY * 3;
            await env.erc20Inst.connect(env.bob).mint(bobAmountToStake);
            await env.erc20Inst.connect(env.bob).approve(env.stakingInst.address, bobAmountToStake);
            await time.setNextBlockTimestamp(bobStakeTimestamp);
            await env.stakingInst.connect(env.bob).stake(bobAmountToStake);

            const aliceWithdrawTimestamp = bobStakeTimestamp + ONE_DAY * 5;

            await time.setNextBlockTimestamp(aliceWithdrawTimestamp);
            await mine();
            expect(await env.stakingInst.availableRewardsToClaim(env.bob.address)).equals(0);

            await time.setNextBlockTimestamp(aliceWithdrawTimestamp);
            await env.stakingInst.connect(env.alice).requestWithdraw(env.aliceAmountToStake);

            expect(await env.stakingInst.availableRewardsToClaim(env.bob.address)).equals(0);
        });

        describe("Revert", () => {
            it("Should revert if amount is zero", async () => {
                const env = await loadFixture(prepareEnv);

                await expect(env.stakingInst.requestWithdraw(0)).revertedWithCustomError(
                    env.stakingInst,
                    "ZeroValue"
                );
            });

            it("Should revert if amount is bigger than stake", async () => {
                const env = await loadFixture(prepareEnvWithAliceStake);

                await expect(env.stakingInst.requestWithdraw(1))
                    .revertedWithCustomError(env.stakingInst, "TooBigValue")
                    .withArgs(1, 0);

                await expect(
                    env.stakingInst
                        .connect(env.alice)
                        .requestWithdraw(env.aliceAmountToStake.add(1))
                )
                    .revertedWithCustomError(env.stakingInst, "TooBigValue")
                    .withArgs(env.aliceAmountToStake.add(1), env.aliceAmountToStake);
            });
        });
    });

    describe("{finalizeWithdraw} function", () => {
        it("Test", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            const aliceWithdrawAmount = env.aliceAmountToStake.div(3);
            const aliceRequestWithdrawTimestamp = env.aliceStakeTimestamp + ONE_DAY * 3;
            await time.setNextBlockTimestamp(aliceRequestWithdrawTimestamp);
            await env.stakingInst.connect(env.alice).requestWithdraw(aliceWithdrawAmount);

            const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

            await time.setNextBlockTimestamp(aliceRequestWithdrawTimestamp + COOLING_PERIOD);
            await expect(env.stakingInst.connect(env.alice).finalizeWithdraw(1))
                .emit(env.stakingInst, "WithdrawIdFinalized")
                .withArgs(env.alice.address, aliceWithdrawAmount, 1);

            const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
            expect(balanceBefore.sub(balanceAfter)).equals(aliceWithdrawAmount);
        });

        describe("Revert", () => {
            it("Should revert when withdraw id doesn't exists", async () => {
                const env = await loadFixture(prepareEnvWithoutDonation);

                await expect(env.stakingInst.finalizeWithdraw(10))
                    .revertedWithCustomError(env.stakingInst, "NoSuchWithdrawId")
                    .withArgs(10);
            });

            it("Should revert when not allowed user", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const aliceRequestWithdrawTimestamp = env.aliceStakeTimestamp + ONE_DAY * 3;
                await time.setNextBlockTimestamp(aliceRequestWithdrawTimestamp);
                await env.stakingInst.connect(env.alice).requestWithdraw(env.aliceAmountToStake);

                await expect(env.stakingInst.finalizeWithdraw(1))
                    .revertedWithCustomError(env.stakingInst, "NotAllowedUser")
                    .withArgs(env.deployer.address, env.alice.address);
            });

            it("Should revert when withdrawal request isn't finalizable yet", async () => {
                const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

                const aliceRequestWithdrawTimestamp = env.aliceStakeTimestamp + ONE_DAY * 3;
                await time.setNextBlockTimestamp(aliceRequestWithdrawTimestamp);
                await env.stakingInst.connect(env.alice).requestWithdraw(env.aliceAmountToStake);

                const aliceFinalizeRequestTimestamp = aliceRequestWithdrawTimestamp + ONE_DAY;
                await time.setNextBlockTimestamp(aliceFinalizeRequestTimestamp);
                await expect(env.stakingInst.connect(env.alice).finalizeWithdraw(1))
                    .revertedWithCustomError(env.stakingInst, "WithdrawIdNotFinalizableYet")
                    .withArgs(
                        aliceFinalizeRequestTimestamp,
                        aliceRequestWithdrawTimestamp + COOLING_PERIOD
                    );
            });
        });
    });

    describe("{availableRewardsToClaim} function", () => {
        it("Call with no available balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStakeWithoutDonation);

            const callTime = env.aliceStakeTimestamp + ONE_DAY * 2;
            await time.setNextBlockTimestamp(callTime);
            await mine();

            expect(await env.stakingInst.availableRewardsToClaim(env.alice.address)).equals(0);
        });

        it("Call with enough available balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            const callTime = env.aliceStakeTimestamp + ONE_DAY * 2;
            await time.setNextBlockTimestamp(callTime);
            await mine();

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(callTime - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );
            const returnValue = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            expect(await env.stakingInst.availableRewardsToClaim(env.alice.address)).equals(
                returnValue
            );
        });

        it("Call with almost enough available balance", async () => {
            const env = await loadFixture(prepareEnvWithAliceStake);

            const callTime = env.aliceStakeTimestamp + ONE_DAY * 2;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(callTime - env.aliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );
            const returnValue = env.aliceAmountToStake
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(env.aliceAmountToStake);

            await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);
            const donationAmount = returnValue.div(3);
            await env.erc20Inst.approve(env.stakingInst.address, donationAmount);
            await env.stakingInst.donateTokensToRewards(donationAmount);

            await time.setNextBlockTimestamp(callTime);
            await mine();

            expect(await env.stakingInst.availableRewardsToClaim(env.alice.address)).equals(
                donationAmount
            );
        });
    });

    it("{donateTokensToRewards} function", async () => {
        const env = await loadFixture(prepareEnv);

        const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

        const amountToDonate = env.oneToken.mul(100);
        await env.erc20Inst.mint(amountToDonate);
        await env.erc20Inst.approve(env.stakingInst.address, amountToDonate);

        await expect(env.stakingInst.donateTokensToRewards(amountToDonate))
            .emit(env.stakingInst, "TokensDonated")
            .withArgs(env.deployer.address, amountToDonate);

        const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
        expect(balanceAfter.sub(balanceBefore)).equals(amountToDonate);
    });

    describe("Admins' functions", () => {
        describe("{setMinStakeAmount} function", () => {
            it("Set new value", async () => {
                const env = await loadFixture(prepareEnv);

                const newValue = env.minStakeAmount.mul(2);

                await expect(env.stakingInst.connect(env.manager).setMinStakeAmount(newValue))
                    .emit(env.stakingInst, "MinStakeAmountChanged")
                    .withArgs(env.minStakeAmount, newValue);

                expect(await env.stakingInst.minStakeAmount()).equals(newValue);
            });

            describe("Reverts", () => {
                it("Should revert when a wrong user calls", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(env.stakingInst.setMinStakeAmount(0)).revertedWith(
                        "AccessControl: account " +
                            env.deployer.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.MANAGER_ROLE
                    );

                    await expect(
                        env.stakingInst.connect(env.alice).setMinStakeAmount(0)
                    ).revertedWith(
                        "AccessControl: account " +
                            env.alice.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.MANAGER_ROLE
                    );
                });

                it("Should revert when the same value", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(
                        env.stakingInst.connect(env.manager).setMinStakeAmount(env.minStakeAmount)
                    ).revertedWithCustomError(env.stakingInst, "TheSameValue");
                });
            });
        });

        describe("{setApr} function", () => {
            it("Set new value with no stakes", async () => {
                const env = await loadFixture(prepareEnv);

                const newValue = env.apr + 1;
                const setAprTimestamp = env.deployTimestamp + ONE_DAY;

                await time.setNextBlockTimestamp(setAprTimestamp);
                await expect(env.stakingInst.connect(env.manager).setApr(newValue))
                    .emit(env.stakingInst, "AprChanged")
                    .withArgs(env.apr, newValue)
                    .not.emit(env.stakingInst, "RateUpdated");

                expect(await env.stakingInst.apr()).equals(newValue);
            });

            it("Set new value with stakes", async () => {
                const env = await loadFixture(prepareEnvWithAliceStake);

                const newValue = env.apr + 1;
                const setAprTimestamp = env.aliceStakeTimestamp + ONE_DAY;
                const newRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(setAprTimestamp - env.aliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                await time.setNextBlockTimestamp(setAprTimestamp);
                await expect(env.stakingInst.connect(env.manager).setApr(newValue))
                    .emit(env.stakingInst, "AprChanged")
                    .withArgs(env.apr, newValue)
                    .emit(env.stakingInst, "RateUpdated")
                    .withArgs(newRatePerStaking);

                expect(await env.stakingInst.apr()).equals(newValue);
            });

            describe("Reverts", () => {
                it("Should revert when a wrong user calls", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(env.stakingInst.setApr(0)).revertedWith(
                        "AccessControl: account " +
                            env.deployer.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.MANAGER_ROLE
                    );

                    await expect(env.stakingInst.connect(env.alice).setApr(0)).revertedWith(
                        "AccessControl: account " +
                            env.alice.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.MANAGER_ROLE
                    );
                });

                it("Should revert when the same value", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(
                        env.stakingInst.connect(env.manager).setApr(env.apr)
                    ).revertedWithCustomError(env.stakingInst, "TheSameValue");
                });

                it("Should revert when the too big value", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(
                        env.stakingInst.connect(env.manager).setApr(PERCENT_DENOMINATOR + 1)
                    )
                        .revertedWithCustomError(env.stakingInst, "TooBigValue")
                        .withArgs(PERCENT_DENOMINATOR + 1, PERCENT_DENOMINATOR);
                });
            });
        });

        describe("{receiveExcessiveBalance} function", () => {
            it("Call with no available balance", async () => {
                const env = await loadFixture(prepareEnvWithoutDonation);

                const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

                const receiveAmount = 1;
                await expect(env.stakingInst.receiveExcessiveBalance(receiveAmount)).not.emit(
                    env.stakingInst,
                    "ExcessiveBalanceWithdrawn"
                );

                const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
                expect(balanceBefore.sub(balanceAfter)).equals(0);
            });

            it("Get amount less than available", async () => {
                const env = await loadFixture(prepareEnv);

                const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

                const receiveAmount = env.donatedTokens.div(3);
                await expect(env.stakingInst.receiveExcessiveBalance(receiveAmount))
                    .emit(env.stakingInst, "ExcessiveBalanceWithdrawn")
                    .withArgs(env.deployer.address, receiveAmount);

                const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
                expect(balanceBefore.sub(balanceAfter)).equals(receiveAmount);
            });

            it("Get amount more than available", async () => {
                const env = await loadFixture(prepareEnv);

                const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

                const receiveAmount = ethers.constants.MaxUint256;
                await expect(env.stakingInst.receiveExcessiveBalance(receiveAmount))
                    .emit(env.stakingInst, "ExcessiveBalanceWithdrawn")
                    .withArgs(env.deployer.address, env.donatedTokens);

                const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
                expect(balanceBefore.sub(balanceAfter)).equals(env.donatedTokens);
            });

            it("Get zero", async () => {
                const env = await loadFixture(prepareEnv);

                const balanceBefore = await env.erc20Inst.balanceOf(env.stakingInst.address);

                await expect(env.stakingInst.receiveExcessiveBalance(0)).not.emit(
                    env.stakingInst,
                    "ExcessiveBalanceWithdrawn"
                );

                const balanceAfter = await env.erc20Inst.balanceOf(env.stakingInst.address);
                expect(balanceBefore.sub(balanceAfter)).equals(0);
            });

            describe("Reverts", () => {
                it("Should revert when a wrong user calls", async () => {
                    const env = await loadFixture(prepareEnv);

                    await expect(
                        env.stakingInst.connect(env.manager).receiveExcessiveBalance(0)
                    ).revertedWith(
                        "AccessControl: account " +
                            env.manager.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.DEFAULT_ADMIN_ROLE
                    );

                    await expect(
                        env.stakingInst.connect(env.alice).receiveExcessiveBalance(0)
                    ).revertedWith(
                        "AccessControl: account " +
                            env.alice.address.toLocaleLowerCase() +
                            " is missing role " +
                            env.DEFAULT_ADMIN_ROLE
                    );
                });
            });
        });
    });
});
