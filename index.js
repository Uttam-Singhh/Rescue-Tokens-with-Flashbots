const { JsonRpcProvider, Wallet, ethers } = require("ethers"); //import https://docs.ethers.org/
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require("@flashbots/ethers-provider-bundle") //import https://www.npmjs.com/package/@flashbots/ethers-provider-bundle
const { exit } = require('process');
require('dotenv').config();

// sepolia
const FLASHBOTS_ENDPOINT = 'https://relay-sepolia.flashbots.net'//change for mainnet
const CHAIN_ID = 11155111;
const recipientAddress = ""; // Address where you want to send ERC20 tokens
const tokenAddress = ""; // Address of the ERC20 token contract
const amount = ethers.parseUnits("1000", 18); //change accordingly

// mainnet
// const FLASHBOTS_ENDPOINT = "https://relay.flashbots.net";
// const CHAIN_ID = 1;

// a normal ethers.js provider, to perform gas estimiations and nonce lookups
const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/${process.env.SPONSOR_KEY}");

// `authSigner` is an Ethereum private key that does NOT store funds and is NOT your bot's primary key.
// This is an identifying key for signing payloads to establish reputation and whitelisting, only for signing request payloads, not transactions
// In production, this should be used across multiple bundles to build relationship. In this example, we generate a new wallet each time
const authSigner = ethers.Wallet.createRandom();

// Account sponsoring the gas fee
const sponsor = new ethers.Wallet(process.env.SPONSOR_KEY).connect(provider);
// compromised account
const compromised = new ethers.Wallet(process.env.COMPROMISED_KEY).connect(provider);

// Create a contract instance for the ERC20 token (Dai)
// ABI definition for the transfer function of ERC20 token
const tokenContract = new ethers.Contract(tokenAddress, [
    "function transfer(address recipient, uint256 amount) external returns (bool)"
], compromised);

// Encode the function data for the transfer function
const transactionData = tokenContract.interface.encodeFunctionData(
    "transfer", 
    [recipientAddress, amount]
);


let i = 0;
const main = async () => {

    // bundle both the transaction
    const transactionBundle = [
        {   // send the compromised wallet some eth
            transaction: {
                chainId: CHAIN_ID,
                type: 2, // EIP 1559
                value: ethers.parseEther("0.01"),
                to: compromised.address,
                maxFeePerGas: ethers.parseUnits("100", "gwei"),
                maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"),
                gasLimit: 50000,
            }, 
            signer: sponsor, // ethers signer
        },
            // Transfer Token
        {   transaction: {
                chainId: CHAIN_ID,
                type: 2, // EIP 1559
                value: 0,
                to: tokenAddress, //contract address
                maxFeePerGas: ethers.parseUnits("100", "gwei"),
                maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"),
                gasLimit: 100000,
                data: transactionData,
            },
            signer: compromised, // ethers signer
        }
    ]


    console.log("Entering Dark Forest...");

    // Flashbots provider requires passing in a standard provider, gives us flashbotsProvider object setup
    // Connect to the flashbots relayer -- this will communicate your bundle of transactions to miners directly, and will bypass the mempool.
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_ENDPOINT, 'sepolia')

    // Every time a new block has been detected, attempt to relay the bundle to miners for the next block
    // Since these transactions aren't in the mempool you need to submit this for every block until it
    // is filled. You don't have to worry about repeat transactions because nonce isn't changing. So you can
    // leave this running until it fills.
    provider.on("block", async (blockNumber) => {
        console.log(`Current Block: ${blockNumber}`);
        const targetBlockNumber = blockNumber + 1;
        console.log(`Preparing bundle for next block: ${targetBlockNumber}`);

        const signedBundle = await flashbotsProvider.signBundle(transactionBundle);

        //run simulation
        console.log(new Date());
        const simulation = await flashbotsProvider.simulate(signedBundle, targetBlockNumber)
        console.log(new Date());
        if ("error" in simulation) {
            console.error(`Simulation error: ${simulation.error.message}`);
            return;
        }

        console.log("Simulation successful. Sending bundle.");

        //send bundle
        const flashbotsTransactionResponse = await flashbotsProvider.sendRawBundle(
            signedBundle,
            targetBlockNumber
        );


        console.log("Bundle response:", flashbotsTransactionResponse);

        if ("error" in flashbotsTransactionResponse) {
            console.error(`Error sending bundle: ${flashbotsTransactionResponse.error.message}`);
            return;
        }

        console.log(`Bundle sent, waiting for inclusion in block ${targetBlockNumber}`);

        // Wait for response
        const waitResponse = await flashbotsTransactionResponse.wait();
        console.log("Resolution:", waitResponse);

        if (waitResponse === FlashbotsBundleResolution.BundleIncluded) {
            console.log(`Success: Bundle included in block ${targetBlockNumber}`, waitResponse);
            exit(0);
        } else if (waitResponse === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
            console.log(`Warning: Bundle not included in block ${targetBlockNumber}`, waitResponse);
        } else if (waitResponse === FlashbotsBundleResolution.AccountNonceTooHigh) {
            console.error("Error: Nonce too high, exiting", waitResponse);
            exit(1);
        } else {
            console.error(`Unexpected waitResponse: ${waitResponse}`, waitResponse);
        }
        i++;

    })

}
main()
