import { ethers, network } from "hardhat";

import { config } from "../config";
import { deployAndVerify } from "./utils";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer address:", deployer.address);

    if (!ethers.utils.isAddress(config.deploy.token[network.name])) {
        console.log("No token address in the config");
        return;
    }

    await deployAndVerify("AtomicStaking", [
        config.deploy.token[network.name],
        config.deploy.minStakeAmount,
        config.deploy.apr,
    ]);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
