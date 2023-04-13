import { expect } from "chai";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";

import { prepareEnv, prepareEnvWithoutStakingDeployment } from "./helpers";
import { config } from "../config";
import { ethers, network } from "hardhat";

import { ONE_DAY, ONE_YEAR, RATE_PRECISION, PERCENT_DENOMINATOR } from "./constants";

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
            const env = await loadFixture(prepareEnv);

            // Alice stake
            const aliceStakeAmount = env.oneToken.mul(1000);
            expect(aliceStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const aliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(aliceStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, aliceStakeAmount);

            await time.setNextBlockTimestamp(aliceStakeTimestamp);
            await expect(env.stakingInst.connect(env.alice).stake(aliceStakeAmount))
                .emit(env.stakingInst, "TokenStaked")
                .withArgs(env.alice.address, aliceStakeAmount)
                .not.emit(env.stakingInst, "RateUpdated")
                .not.emit(env.stakingInst, "RewardsClaimed");

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                aliceStakeAmount.add(env.donatedTokens)
            );

            const stakeStateAlice = await env.stakingInst.stakeStates(env.alice.address);
            expect(stakeStateAlice.stakeAmount).equals(aliceStakeAmount);
            expect(stakeStateAlice.claimedAmount).equals(aliceStakeAmount);
            expect(stakeStateAlice.contractDeptToUser).equals(0);

            // Bob stake
            const bobStakeAmount = aliceStakeAmount.mul(2);
            expect(bobStakeAmount).greaterThanOrEqual(env.minStakeAmount, "Too small stake amount");
            const bobStakeTimestamp = aliceStakeTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.bob).mint(bobStakeAmount);
            await env.erc20Inst.connect(env.bob).approve(env.stakingInst.address, bobStakeAmount);

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(bobStakeTimestamp - aliceStakeTimestamp)
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
                aliceStakeAmount.add(bobStakeAmount).add(env.donatedTokens)
            );

            const stakeStateBob = await env.stakingInst.stakeStates(env.bob.address);
            expect(stakeStateBob.stakeAmount).equals(bobStakeAmount);
            expect(stakeStateBob.claimedAmount).equals(
                bobStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(stakeStateBob.contractDeptToUser).equals(0);
        });

        it("Test two stakes one user", async () => {
            const env = await loadFixture(prepareEnv);

            // Alice first stake
            const aliceFirstStakeAmount = env.oneToken.mul(1000);
            expect(aliceFirstStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const aliceFirstStakeTimestamp = env.deployTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(aliceFirstStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, aliceFirstStakeAmount);

            await time.setNextBlockTimestamp(aliceFirstStakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(aliceFirstStakeAmount);

            // Alice second stake
            const aliceSecondStakeAmount = aliceFirstStakeAmount.mul(2);
            expect(aliceSecondStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const aliceSecondStakeTimestamp = aliceFirstStakeTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(aliceSecondStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, aliceSecondStakeAmount);

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(aliceSecondStakeTimestamp - aliceFirstStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = aliceFirstStakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(aliceFirstStakeAmount);

            await time.setNextBlockTimestamp(aliceSecondStakeTimestamp);
            await expect(env.stakingInst.connect(env.alice).stake(aliceSecondStakeAmount))
                .emit(env.stakingInst, "TokenStaked")
                .withArgs(env.alice.address, aliceSecondStakeAmount)
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "RewardsClaimed")
                .withArgs(env.alice.address, claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                aliceFirstStakeAmount
                    .add(aliceSecondStakeAmount)
                    .add(env.donatedTokens)
                    .sub(claimedRewards)
            );

            const stakeStateBob = await env.stakingInst.stakeStates(env.alice.address);
            expect(stakeStateBob.stakeAmount).equals(
                aliceFirstStakeAmount.add(aliceSecondStakeAmount)
            );
            expect(stakeStateBob.claimedAmount).equals(
                aliceFirstStakeAmount
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
            const env = await loadFixture(prepareEnv);

            // First stake
            const firstStakeAmount = env.oneToken.mul(1000);
            expect(firstStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, firstStakeAmount);

            await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

            // Claim
            const claimTimestamp = firstAliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - firstAliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = firstStakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(firstStakeAmount);

            await time.setNextBlockTimestamp(claimTimestamp);
            await expect(env.stakingInst.connect(env.alice).claimRewards())
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "RewardsClaimed")
                .withArgs(env.alice.address, claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(claimedRewards);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                firstStakeAmount.add(env.donatedTokens).sub(claimedRewards)
            );

            const secondStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(secondStakeState.stakeAmount).equals(firstStakeAmount);
            expect(secondStakeState.claimedAmount).equals(
                firstStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(secondStakeState.contractDeptToUser).equals(0);
        });

        it("Claim with almost enough reward balance", async () => {
            const env = await loadFixture(prepareEnv);

            await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

            // First stake
            const firstStakeAmount = env.oneToken.mul(1000);
            expect(firstStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, firstStakeAmount);

            await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

            // Claim
            const claimTimestamp = firstAliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - firstAliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = firstStakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(firstStakeAmount);

            const tokenToDonate = claimedRewards.div(3);
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

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(firstStakeAmount);

            const secondStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(secondStakeState.stakeAmount).equals(firstStakeAmount);
            expect(secondStakeState.claimedAmount).equals(
                firstStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(secondStakeState.contractDeptToUser).equals(claimedRewards.sub(tokenToDonate));
        });

        it("Claim with no reward balance", async () => {
            const env = await loadFixture(prepareEnv);

            await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

            // First stake
            const firstStakeAmount = env.oneToken.mul(1000);
            expect(firstStakeAmount).greaterThanOrEqual(
                env.minStakeAmount,
                "Too small stake amount"
            );
            const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

            await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
            await env.erc20Inst
                .connect(env.alice)
                .approve(env.stakingInst.address, firstStakeAmount);

            await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

            // Claim rewards
            const claimTimestamp = firstAliceStakeTimestamp + ONE_DAY;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(claimTimestamp - firstAliceStakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );

            const claimedRewards = firstStakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(firstStakeAmount);

            await time.setNextBlockTimestamp(claimTimestamp);
            await expect(env.stakingInst.connect(env.alice).claimRewards())
                .emit(env.stakingInst, "RateUpdated")
                .withArgs(newRatePerStaking)
                .emit(env.stakingInst, "DeptToUserChanged")
                .withArgs(env.alice.address, 0, claimedRewards)
                .not.emit(env.stakingInst, "RewardsClaimed");

            expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(0);

            expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(firstStakeAmount);

            const aliceStakeState = await env.stakingInst.stakeStates(env.alice.address);
            expect(aliceStakeState.stakeAmount).equals(firstStakeAmount);
            expect(aliceStakeState.claimedAmount).equals(
                firstStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
            );
            expect(aliceStakeState.contractDeptToUser).equals(claimedRewards);
        });

        describe("After first claim with no reward balance", () => {
            it("Second claim with no reward balance", async () => {
                const env = await loadFixture(prepareEnv);

                await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

                // First stake
                const firstStakeAmount = env.oneToken.mul(1000);
                expect(firstStakeAmount).greaterThanOrEqual(
                    env.minStakeAmount,
                    "Too small stake amount"
                );
                const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

                const firstClaimTimestamp = firstAliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
                await env.erc20Inst
                    .connect(env.alice)
                    .approve(env.stakingInst.address, firstStakeAmount);

                await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
                await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - firstAliceStakeTimestamp)
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

                const secondClaimedRewards = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(firstStakeAmount);

                const secondClaimedAmount = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = firstStakeAmount
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
                    firstStakeAmount
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(firstStakeAmount);
                expect(thirdStakeState.claimedAmount).equals(
                    firstStakeAmount.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(
                    secondClaimedRewards.add(thirdClaimedRewards)
                );
            });

            it("Second claim with enough rewards balance", async () => {
                const env = await loadFixture(prepareEnv);

                await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

                // First stake
                const firstStakeAmount = env.oneToken.mul(1000);
                expect(firstStakeAmount).greaterThanOrEqual(
                    env.minStakeAmount,
                    "Too small stake amount"
                );
                const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

                const firstClaimTimestamp = firstAliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
                await env.erc20Inst
                    .connect(env.alice)
                    .approve(env.stakingInst.address, firstStakeAmount);

                await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
                await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - firstAliceStakeTimestamp)
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

                const secondClaimedRewards = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(firstStakeAmount);

                const secondClaimedAmount = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = firstStakeAmount
                    .mul(thirdRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(secondClaimedAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.erc20Inst.approve(env.stakingInst.address, env.donatedTokens);
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.donateTokensToRewards(env.donatedTokens);

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
                    firstStakeAmount
                        .add(env.donatedTokens)
                        .sub(secondClaimedRewards.add(thirdClaimedRewards))
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(firstStakeAmount);
                expect(thirdStakeState.claimedAmount).equals(
                    firstStakeAmount.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(0);
            });

            it("Second claim with enough rewards balance only for [second stake timestamp; third stake timestamp]", async () => {
                const env = await loadFixture(prepareEnv);

                await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

                // First stake
                const firstStakeAmount = env.oneToken.mul(1000);
                expect(firstStakeAmount).greaterThanOrEqual(
                    env.minStakeAmount,
                    "Too small stake amount"
                );
                const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

                const firstClaimTimestamp = firstAliceStakeTimestamp + ONE_DAY;
                const secondClaimTimestamp = firstClaimTimestamp + ONE_DAY * 2;

                await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
                await env.erc20Inst
                    .connect(env.alice)
                    .approve(env.stakingInst.address, firstStakeAmount);

                await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
                await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

                const secondRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - firstAliceStakeTimestamp)
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

                const secondClaimedRewards = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(firstStakeAmount);

                const secondClaimedAmount = firstStakeAmount
                    .mul(secondRatePerStaking)
                    .div(RATE_PRECISION);
                const thirdClaimedRewards = firstStakeAmount
                    .mul(thirdRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(secondClaimedAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();

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
                    firstStakeAmount
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(firstStakeAmount);
                expect(thirdStakeState.claimedAmount).equals(
                    firstStakeAmount.mul(thirdRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(secondClaimedRewards);
            });

            it("Second claim with the same timestamp as the second claim", async () => {
                const env = await loadFixture(prepareEnv);

                await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

                // First stake
                const firstStakeAmount = env.oneToken.mul(1000);
                expect(firstStakeAmount).greaterThanOrEqual(
                    env.minStakeAmount,
                    "Too small stake amount"
                );
                const firstAliceStakeTimestamp = env.deployTimestamp + ONE_DAY;

                const firstClaimTimestamp = firstAliceStakeTimestamp + ONE_DAY;

                await env.erc20Inst.connect(env.alice).mint(firstStakeAmount);
                await env.erc20Inst
                    .connect(env.alice)
                    .approve(env.stakingInst.address, firstStakeAmount);

                await time.setNextBlockTimestamp(firstAliceStakeTimestamp);
                await env.stakingInst.connect(env.alice).stake(firstStakeAmount);

                const newRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(firstClaimTimestamp - firstAliceStakeTimestamp)
                        .mul(env.apr)
                        .div(ONE_YEAR)
                        .div(PERCENT_DENOMINATOR)
                );

                const claimedRewards = firstStakeAmount
                    .mul(newRatePerStaking)
                    .div(RATE_PRECISION)
                    .sub(firstStakeAmount);

                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await env.stakingInst.connect(env.alice).claimRewards();
                await time.setNextBlockTimestamp(firstClaimTimestamp);
                await expect(env.stakingInst.connect(env.alice).claimRewards())
                    .not.emit(env.stakingInst, "DeptToUserChanged")
                    .not.emit(env.stakingInst, "RateUpdated")
                    .not.emit(env.stakingInst, "RewardsClaimed");

                expect(await env.erc20Inst.balanceOf(env.alice.address)).equals(0);

                expect(await env.erc20Inst.balanceOf(env.stakingInst.address)).equals(
                    firstStakeAmount
                );

                const thirdStakeState = await env.stakingInst.stakeStates(env.alice.address);
                expect(thirdStakeState.stakeAmount).equals(firstStakeAmount);
                expect(thirdStakeState.claimedAmount).equals(
                    firstStakeAmount.mul(newRatePerStaking).div(RATE_PRECISION)
                );
                expect(thirdStakeState.contractDeptToUser).equals(claimedRewards);
            });
        });
    });

    describe("{availableRewardsToClaim} function", () => {
        it("Call with no available balance", async () => {
            const env = await loadFixture(prepareEnv);

            await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

            const stakeTimestamp = env.deployTimestamp + ONE_DAY;
            const stakeAmount = env.oneToken.mul(100);
            await env.erc20Inst.connect(env.alice).mint(stakeAmount);
            await env.erc20Inst.connect(env.alice).approve(env.stakingInst.address, stakeAmount);
            await time.setNextBlockTimestamp(stakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(stakeAmount);

            const callTime = stakeTimestamp + ONE_DAY * 2;
            await time.setNextBlockTimestamp(callTime);
            await mine();

            expect(await env.stakingInst.availableRewardsToClaim(env.alice.address)).equals(0);
        });

        it("Call with enough available balance", async () => {
            const env = await loadFixture(prepareEnv);

            const stakeTimestamp = env.deployTimestamp + ONE_DAY;
            const stakeAmount = env.oneToken.mul(100);
            await env.erc20Inst.connect(env.alice).mint(stakeAmount);
            await env.erc20Inst.connect(env.alice).approve(env.stakingInst.address, stakeAmount);
            await time.setNextBlockTimestamp(stakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(stakeAmount);

            const callTime = stakeTimestamp + ONE_DAY * 2;
            await time.setNextBlockTimestamp(callTime);
            await mine();

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(callTime - stakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );
            const returnValue = stakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(stakeAmount);

            expect(await env.stakingInst.availableRewardsToClaim(env.alice.address)).equals(
                returnValue
            );
        });

        it("Call with almost enough available balance", async () => {
            const env = await loadFixture(prepareEnv);

            const stakeTimestamp = env.deployTimestamp + ONE_DAY;
            const stakeAmount = env.oneToken.mul(100);
            await env.erc20Inst.connect(env.alice).mint(stakeAmount);
            await env.erc20Inst.connect(env.alice).approve(env.stakingInst.address, stakeAmount);
            await time.setNextBlockTimestamp(stakeTimestamp);
            await env.stakingInst.connect(env.alice).stake(stakeAmount);

            const callTime = stakeTimestamp + ONE_DAY * 2;

            const newRatePerStaking = RATE_PRECISION.add(
                RATE_PRECISION.mul(callTime - stakeTimestamp)
                    .mul(env.apr)
                    .div(ONE_YEAR)
                    .div(PERCENT_DENOMINATOR)
            );
            const returnValue = stakeAmount
                .mul(newRatePerStaking)
                .div(RATE_PRECISION)
                .sub(stakeAmount);

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
                const env = await loadFixture(prepareEnv);

                const stakeTimestamp = env.deployTimestamp + ONE_DAY;
                const stakeAmount = env.oneToken.mul(100);
                await env.erc20Inst.connect(env.alice).mint(stakeAmount);
                await env.erc20Inst
                    .connect(env.alice)
                    .approve(env.stakingInst.address, stakeAmount);
                await time.setNextBlockTimestamp(stakeTimestamp);
                await env.stakingInst.connect(env.alice).stake(stakeAmount);

                const newValue = env.apr + 1;
                const setAprTimestamp = stakeTimestamp + ONE_DAY;
                const newRatePerStaking = RATE_PRECISION.add(
                    RATE_PRECISION.mul(setAprTimestamp - stakeTimestamp)
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
                const env = await loadFixture(prepareEnv);

                await env.stakingInst.receiveExcessiveBalance(ethers.constants.MaxUint256);

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
