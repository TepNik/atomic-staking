import { ethers } from "hardhat";

export const ONE_DAY = 86400;
export const ONE_YEAR = ONE_DAY * 365;
export const COOLING_PERIOD = ONE_DAY * 10;

export const Ten = ethers.BigNumber.from(10);
export const RATE_PRECISION = Ten.pow(18);
export const PERCENT_DENOMINATOR = 100_00;
