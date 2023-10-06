const { getNamedAccounts, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name) ? 
    describe.skip 
    : describe("Raffle Unit Tests", function() {
        let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
        const chainId = network.config.chainId;

        beforeEach(async function() {
            deployer = (await getNamedAccounts()).deployer;
            await deployments.fixture(["all"]);
            const raffleAddr = (await deployments.get("Raffle")).address;
            raffle = await ethers.getContractAt("Raffle", raffleAddr);
            const vrfCoordinatorV2MockAddr = (await deployments.get("VRFCoordinatorV2Mock")).address;
            vrfCoordinatorV2Mock =  await ethers.getContractAt("VRFCoordinatorV2Mock", vrfCoordinatorV2MockAddr);
            raffleEntranceFee = await raffle.getEntranceFee();
            interval = await raffle.getInterval();
        });

        describe("Constructor args", function() {
            it("Initializes Raffle correctly", async function() {
                const raffleState = await raffle.getRaffleState();
                const interval =  await raffle.getInterval();
                assert.equal(raffleState.toString(), "0");
                assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
            });
        });

        describe("Enter Raffle", function() {
            it("Reverts when you don't pay enough", async function() {
                await expect(raffle.enterRaffle()).to.be.revertedWithCustomError(raffle, "Raffle__NotEnoughETHEntered");
            });

            it("Records players when they enter", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                const playerFromContract = await raffle.getPlayer(0);
                assert.equal(playerFromContract, deployer);
            });
            
            it("Emits event on enter", async function() {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter");
            });

            it("Doesn't allow entrance when Raffle is calculating", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]);
                await network.provider.send("evm_mine", []);

                // Preteneding to be a keeper
                await raffle.performUpkeep("0x");

                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWithCustomError(raffle, "Raffle__NotOpen")
            });
        });

        describe("Testing checkUpkeep", function() {
            it("Returns false if people did not send any ETH", async function() {
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]);
                await network.provider.send("evm_mine", []);
                const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
                assert(!upkeepNeeded);
            });

            it("Returns false if Raffle is not open", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]);
                await network.provider.send("evm_mine", []);

                await raffle.performUpkeep("0x");

                const raffleState = await raffle.getRaffleState();
                const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");

                assert.equal(raffleState.toString(), "1");
                assert.equal(upkeepNeeded, false);
            });

            it("returns false if enough time hasn't passed", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [Number(interval) - 5]) // use a higher number here if this test fails
                await network.provider.send("evm_mine", []);
                const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
                assert(!upkeepNeeded)
            });

            it("returns true if enough time has passed, has players, eth, and is open", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]);
                await network.provider.send("evm_mine", []);
                const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
                assert(upkeepNeeded);
            });
        });
    });
