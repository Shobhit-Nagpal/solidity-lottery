const { run } = require("hardhat");

async function verify(contractAddr, args) {
    console.log("Verifying contract...");

    try {
        await run("verify:verify", {
            address: contractAddr,
            constructorArguments: args
        });
    }
    catch (err) {
        if (err.message.toLowerCase().includes("already verified")) {
            console.log("Already verified");
        }
        else {
            console.log(err);
        }
    }
}

module.exports = { verify };
