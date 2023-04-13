import { ethers } from "hardhat";

import { config } from "../config";
import { deployAndVerify } from "./utils";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer address:", deployer.address);

    await deployAndVerify("AtomicStaking", [
        config.deploy.token.ethereumMainnet,
        config.deploy.minStakeAmount,
        config.deploy.apr
    ]);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
