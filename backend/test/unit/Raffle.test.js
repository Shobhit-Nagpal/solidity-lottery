const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.scip
    : describe("Raffle Unit Test", async function () {
          let raffle, vrfCoordinatorV2Mock, deployer, raffleEntranceFee, interval
          const chainId = network.config.chainId
          const value = ethers.parseEther("0.015")
          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer
              const fix = await deployments.fixture("all")
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", function () {
              it("set the correct state ", async () => {
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
              })

              it("set the correct inteval", async () => {
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("Enters Raffle", function () {
              it("Reverts if you dont pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWithCustomError(
                      raffle,
                      "Raffle__NotEnoughETHEntered",
                  )
              })

              it("Records players when they enter", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                const playerFromContract = await raffle.getPlayer(0);
                assert.equal(playerFromContract, deployer);
              });
              
              it("Emits event on enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })

                  await expect(raffle.enterRaffle({ value: raffleEntranceFee }))
                      .to.emit(raffle, "RaffleEnter")
                      .withArgs(deployer)
              })

              it("doesnt allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep("0x")
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee }),
                  ).to.be.revertedWithCustomError(raffle, "Raffle__NotOpen")
              })
          })
          describe("CheckUpkeep", function () {
              it("returns false if people havent sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert(!upkeepNeeded)
              })
              it("Returns false if Raffle isn`t open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep("0x")
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert.equal(raffleState.toString(), "1")
                  assert(!upkeepNeeded)
              })
              it("Retuns false if enough time hasn`t passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) - 15])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert(upkeepNeeded)
              })
          })
          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  assert(await raffle.performUpkeep("0x"))
              })

              it("it will revert if no need to upkeep ", async () => {
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWithCustomError(
                      raffle,
                      "Raffle__UpkeepNotNeeded",
                  )
              })

              it("updates raffle state, emits event, and calls the vrfcoordinator", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
                  //   await expect(raffle.performUpkeep("0x")).to.emit(raffle, "RequestedRaffleWinner")
                  const tx = await raffle.performUpkeep("0x")
                  const txReceipt = await tx.wait(1)
                  const requestId = txReceipt.logs[1].args.requestId
                  assert(requestId > 0)
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "1")
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.target),
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.target),
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner, resets lottery, and sends money", async () => {
                  const addedPlayers = 3
                  const initialPlayer = 1
                  const accounts = await ethers.getSigners()

                  for (i = initialPlayer; i < initialPlayer + addedPlayers; i++) {
                      const connectedContact = raffle.connect(accounts[i])
                      await connectedContact.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLatestTimestamp()

                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event fired!")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              const winnerEndingBalance = await ethers.provider.getBalance(
                                  accounts[1].address,
                              )
                              const numberOfPlayers = await raffle.getNumberOfPlayers()
                              const lastTimeStamp = await raffle.getLatestTimestamp()
                              const raffleState = await raffle.getRaffleState()
                              assert.equal(recentWinner, accounts[1].address)
                              assert.equal(numberOfPlayers, 0n)
                              assert(lastTimeStamp > startingTimeStamp)
                              assert.equal(raffleState, 0n)
                              assert.equal(
                                  winnerEndingBalance,
                                  winnerStartingBalance + totalNumbersOfPlayers * raffleEntranceFee,
                              )
                              resolve()
                          } catch (error) {
                              reject(error)
                          }
                      })
                      const winnerStartingBalance = await ethers.provider.getBalance(
                          accounts[1].address,
                      )
                      const totalNumbersOfPlayers = await raffle.getNumberOfPlayers()
                      const tx = await raffle.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.logs[1].args.requestId,
                          raffle.target,
                      )
                  })
              })
          })
      })
