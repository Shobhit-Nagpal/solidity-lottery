const { network, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../helper-hardhat-config");
const { verify } = require("../helper-hardhat-config");

const VRF_SUB_FUND_AMT = ethers.parseEther("2");

module.exports = async function({ getNamedAccounts, deployments }) {
    
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = network.config.chainId;
    let vrfCoordinatorV2Mock, vrfCoordinatorV2Address, subscriptionId;

    if (developmentChains.includes(network.name)) {
        vrfCoordinatorV2Address = (await deployments.get("VRFCoordinatorV2Mock")).address;
        console.log(vrfCoordinatorV2Address);
        vrfCoordinatorV2Mock = await ethers.getContractAt("VRFCoordinatorV2Mock", vrfCoordinatorV2Address);
        const txResponse = await vrfCoordinatorV2Mock.createSubscription();
        const txReceipt = await txResponse.wait(1);
        subscriptionId = txReceipt.logs[0].args.subId;

        // Fund the subscription
        // Usually, we need link token on a real network
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMT);
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatorV2"];
        subscriptionId = networkConfig[chainId]["subscriptionId"];
    }

    const entranceFee = networkConfig[chainId]["entranceFee"];
    const gasLane = networkConfig[chainId]["gasLane"];
    const callbackGasLimit = networkConfig[chainId]["callbackGasLimit"];
    const interval  = networkConfig[chainId]["interval"];
    const args = [vrfCoordinatorV2Address, entranceFee, gasLane, subscriptionId, callbackGasLimit, interval]
    
    const raffle = await deploy("Raffle", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: network.config.blockConfirmations || 1    
    });

    const raffleAddr = (await deployments.get("Raffle")).address;
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffleAddr)
    if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        log("Verifying...");
        await verify(raffleAddr, args);
    }

    log("--------------------------");
}

module.exports.tags = ["all", "raffle"];
