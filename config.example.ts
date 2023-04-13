import { BigNumber } from "ethers";

const decimals = 8;
const oneToken = BigNumber.from(10).pow(decimals);

export const config = {
    // global constants

    // Private key that will be used for testnets
    testnetAccounts: ["0000000000000000000000000000000000000000000000000000000000000000"],
    // Private key that will be used for mainnets
    mainnetAccounts: ["0000000000000000000000000000000000000000000000000000000000000000"],

    // Project id from https://infura.io/
    infuraIdProject: "abcd1234...",

    // API key from explorers
    // for https://etherscan.io/
    apiKeyEtherscan: "abcd1234...",
    // for https://bscscan.com/
    apiKeyBscScan: "abcd1234...",
    // for https://polygonscan.com/
    apiKeyPolygonScan: "abcd1234...",

    // API key from https://coinmarketcap.com/
    coinmarketcapApi: "abcd1234...",

    // deploy constants
    deploy: {
        token: {
            ethereumMainnet: "0xaD22f63404f7305e4713CcBd4F296f34770513f4",
        },
        minStakeAmount: oneToken.mul(50),
        // percent denominator is 100_00 (100%)
        apr: 20_00,
    },
};
