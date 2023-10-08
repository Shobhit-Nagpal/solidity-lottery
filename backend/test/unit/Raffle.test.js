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

        describe("Testing performUpkeep", function() {
            it("Can only run if checkupKeep is true", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]) // use a higher number here if this test fails
                await network.provider.send("evm_mine", []);
                const tx = await raffle.performUpkeep("0x");
                assert(tx);
            });

            it("Reverts when checkUpkeep returns false", async function() {
                await expect(raffle.performUpkeep("0x")).to.be.revertedWithCustomError(raffle, "Raffle__UpkeepNotNeeded");
            });

            it("Updates raffle state, emits event, calls vrfCoordinator", async function() {
                 await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]) // use a higher number here if this test fails
                await network.provider.send("evm_mine", []);
                const txResponse = await raffle.performUpkeep("0x");
                const txReceipt = await txResponse.wait(1);
                const requestId = txReceipt.logs[1].args.requestId;

                const raffleState = await raffle.getRaffleState();

                assert(Number(requestId > 0));
                assert(raffleState.toString() === "1");
            });
        });

        describe("Testing fulfillRandomWords", function() {
            beforeEach(async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [Number(interval) + 1]) // use a higher number here if this test fails
                await network.provider.send("evm_mine", []);
            });

            it("Can only be called after performUpkeep", async function() {
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.getAddress())).to.be.revertedWith("nonexistent request");
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.getAddress())).to.be.revertedWith("nonexistent request");
            });

            //BIG PROMISE TEST
            it("Picks a winner, resets lottery, sends money", async function() {
                const additionalEntrants = 3;
                const startingAccountIndex = 1; // as deployer's index is 0
                const accounts = await ethers.getSigners();

                for(let i = startingAccountIndex ; i < startingAccountIndex + additionalEntrants ; i++) {
                    const accountConnectedRaffle = raffle.connect(accounts[i]);
                    const tx = await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                    await tx.wait(1);
                }

                const startingTimestamp = await raffle.getLatestTimestamp();

                //performUpkeep (Mock being the keeper)
                //fulfillRandomWords (Mock being VRF)
                
                //We have to wait for fulfillRandomWords to be called

                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        console.log("WinnerPicked event fired!")
                          // assert throws an error if it fails, so we need to wrap
                          // it in a try/catch so that the promise returns event
                          // if it fails.
                          try {
                              // Now lets get the ending values...
                              const recentWinner = await raffle.getRecentWinner();
                              console.log("DEEZNUTS");
                              console.log(`HELP HELP HELP HELP ${recentWinner}`);
                              const raffleState = await raffle.getRaffleState();
                              const endingTimeStamp = await raffle.getLastTimeStamp();
                              const numPlayers = await raffle.getNumberOfPlayers();

                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(raffleState.toString(), "0");
                              assert(endingTimeStamp > startingTimestamp);
                          } catch (e) { 
                              reject(e); // if try fails, rejects the promise
                          }
                        resolve();
                    });

                    const tx = await raffle.performUpkeep([]);
                    const txReceipt = await tx.wait(1);
                    await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.logs[1].args.requestId, raffle.target);
                });
            });
        });
    });
