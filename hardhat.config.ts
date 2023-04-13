import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "hardhat-abi-exporter";
import "hardhat-spdx-license-identifier";
import "hardhat-tracer";
import "solidity-docgen";
import "@typechain/hardhat";

import { config } from "./config";

module.exports = {
    networks: {
        hardhat: {
            forking: {
                enabled: false,
                url: "https://YOUR_RPC_NODE",
                //blockNumber: 17130449

                // If using blockNumber, RPC node should be archive
            },
            allowBlocksWithSameTimestamp: true,
        },
        ethereumMainnet: {
            url: "https://rinkeby.infura.io/v3/" + config.infuraIdProject,
            accounts: config.mainnetAccounts,
        },
        sepolia: {
            url: "https://sepolia.infura.io/v3/" + config.infuraIdProject,
            accounts: config.testnetAccounts,
        },
        bscMainnet: {
            url: "https://bsc-dataseed3.binance.org",
            accounts: config.mainnetAccounts,
        },
        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            accounts: config.testnetAccounts,
        },
        polygonMainnet: {
            url: "https://rpc-mainnet.maticvigil.com",
            accounts: config.mainnetAccounts,
        },
        polygonTestnet: {
            url: "https://matic-mumbai.chainstacklabs.com",
            accounts: config.testnetAccounts,
        },
    },
    // docs: https://www.npmjs.com/package/@nomiclabs/hardhat-etherscan
    etherscan: {
        apiKey: {
            mainnet: config.apiKeyEtherscan,
            sepolia: config.apiKeyEtherscan,

            bsc: config.apiKeyBscScan,
            bscTestnet: config.apiKeyBscScan,

            polygon: config.apiKeyPolygonScan,
            polygonMumbai: config.apiKeyPolygonScan,

            // to get all supported networks
            // npx hardhat verify --list-networks
        },
    },
    namedAccounts: {
        deployer: 0,
    },
    solidity: {
        compilers: [
            {
                version: "0.8.19",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 999999,
                    },
                },
            },
        ],
    },
    mocha: {
        timeout: 100000,
    },
    // docs: https://www.npmjs.com/package/hardhat-contract-sizer
    contractSizer: {
        alphaSort: true,
        runOnCompile: true,
        disambiguatePaths: false,
        except: ["@openzeppelin/contracts/", "test/"],
    },
    // docs: https://www.npmjs.com/package/hardhat-gas-reporter
    gasReporter: {
        currency: "USD",
        token: "ETH", // ETH, BNB, MATIC, AVAX, HT, MOVR
        coinmarketcap: config.coinmarketcapApi,
        excludeContracts: ["@openzeppelin/contracts/", "test/"],
    },
    // docs: https://www.npmjs.com/package/hardhat-abi-exporter
    abiExporter: {
        path: "./data/abi",
        runOnCompile: true,
        clear: true,
        flat: true,
        spacing: 2,
        except: ["@openzeppelin/contracts/", "interface/", "test/"],
    },
    spdxLicenseIdentifier: {
        overwrite: true,
        runOnCompile: true,
    },
    // docs: https://www.npmjs.com/package/solidity-docgen
    // config info: https://github.com/OpenZeppelin/solidity-docgen/blob/master/src/config.ts
    docgen: {
        pages: "items",
        exclude: ["@openzeppelin/contracts/", "interface/", "test/"],
    },
} as HardhatUserConfig;
