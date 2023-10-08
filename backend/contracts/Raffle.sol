//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

// Enter lottery 
// Pick random winner
// Winner to be selected every X mins (automated completely)
//Chainlink Oracle --> Randomness and automated execution (keepers)

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransactionFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
   
    // Type declarations
    enum RaffleState {
        OPEN,
        CALCULATING
    }


    uint256 private immutable i_entranceFee; 
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant NUM_WORDS = 1;
   

    /*  Lottery Variables  */
    address private s_recentWinner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimestamp;
    uint256 private immutable i_interval;

    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    constructor(address vrfCoordinatorV2, uint256 entranceFee, bytes32 gasLane, uint64 subscriptionId, uint32 callbackGasLimit, uint256 interval) VRFConsumerBaseV2(vrfCoordinatorV2) {
       i_entranceFee = entranceFee;
       i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
       i_gasLane = gasLane;
       i_subscriptionId = subscriptionId;
       i_callbackGasLimit = callbackGasLimit;
       s_raffleState = RaffleState.OPEN;
       s_lastTimestamp = block.timestamp;
       i_interval = interval;
    }


    function enterRaffle() public payable { 

        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered(); 
        }

        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__NotOpen();
        }

        s_players.push(payable(msg.sender));

        // Events
        // EVM uses log (which is a data structure to keep track of changes that happen to the blockchain). Events allow you to print stuff to this log. Events and log are in a data structure not accessible by smart contracts so it is cheaper.
        // Events are tied to the account address or smart contract that emitted the event.
        // There are indexed and non-indexed parameters in events. We can have only 3 indexed parameters aka topics.
        // Indexed parameters are easier to search and query.
        // Good naming convention for events is is with the function name reversed.

        emit RaffleEnter(msg.sender);
    }
    

    /**
        * @dev This is the function that the Chainlink keeper nodes call
        * They look for upkeepNeeded to return true
        * The following should return true if:
                1. Time interval has passed
                2. Lottery should have atleast 1 player and have some ETH
                3. Our subscription needs to be funded with LINK
                4. Lottery should be in "open" state
    */

    function checkUpkeep(bytes memory /*  checkData */) public override returns(bool upkeepNeeded, bytes memory /* performData */) {
        bool isOpen = (RaffleState.OPEN == s_raffleState); 
        bool timePassed = ((block.timestamp - s_lastTimestamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    function performUpkeep(bytes calldata /* performData */ ) external override {

        (bool upkeepNeeded, ) = checkUpkeep("");

        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(address(this).balance, s_players.length, uint256(s_raffleState));
        }


        s_raffleState = RaffleState.CALCULATING;

        // Request for number. Once we get number, do something with it. --> 2 transaction process i_vrfCoordinator.requestRandomWords(
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane, 
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );

        emit RequestedRaffleWinner(requestId);
    }

    function fulfillRandomWords(uint256 /*requestId*/, uint256[] memory randomWords) internal override {
        uint256 winnerIndex = randomWords[1] % s_players.length; 
        address payable recentWinner = s_players[winnerIndex];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimestamp = block.timestamp;
        (bool success, ) = recentWinner.call{value: address(this).balance}("");

        if (!success) {
            revert Raffle__TransactionFailed(); 
        }
        emit WinnerPicked(recentWinner);
    }

    function getEntranceFee() public  view returns(uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns(address) {
        return s_players[index];
    }
    
    function getRecentWinner() public view returns(address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns(RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns(uint256) {
        return NUM_WORDS;
    }

    function getNumberOfPlayers() public view returns(uint256) {
        return s_players.length;
    }

    function getLatestTimestamp() public view returns(uint256) {
        return s_lastTimestamp;
    }

    function getRequestConfirmations() public pure returns(uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns(uint256) {
        return i_interval;
    }
}
