import { ByteArray, formatEther, parseEther, type Hex } from "viem";
import {
    elizaLogger,
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    AgentRuntime,
    createMessageMemory,
    composePrompt,
    createActionResult,
    v1,
    v2,
} from "@elizaos/core";

import { initWalletProvider, WalletProvider } from "../providers/wallet";
import { ADDRESS_PRECOMPILE_ABI, ADDRESS_PRECOMPILE_ADDRESS, type Transaction, type TransferParams } from "../types";

export const transferTemplate = `You are an AI assistant specialized in processing cryptocurrency transfer requests. Your task is to extract specific information from user messages and format it into a structured JSON response.

First, review the recent messages from the conversation:

<recent_messages>
{{recentMessages}}
</recent_messages>

Your goal is to extract the following information about the requested transfer:
1. Amount to transfer in SEI
2. Recipient address

Before providing the final JSON output, show your reasoning process inside <analysis> tags. Follow these steps:

1. Identify the relevant information from the user's message:
   - Quote the part mentioning the amount.
   - Quote the part mentioning the recipient address.

2. Validate each piece of information:
   - Amount: Attempt to convert the amount to a number to verify it's valid.
   - Address: Check that it either starts with "0x" or "sei1", and ensure that the address contains 42 characters,
   - Chain: Check that the chain is either mainnet, testnet, devnet or

3. If any information is missing or invalid, prepare an appropriate error message.

4. If all information is valid, summarize your findings.

5. Prepare the JSON structure based on your analysis.

After your analysis, provide the final output in a JSON markdown block. All fields except 'token' are required. The JSON should have this structure:
\`\`\`json
{
    "amount": string,
    "toAddress": string,
}
\`\`\`

Remember:
- The amount should be a string representing the SEI amount without any currency symbol.
- The recipient address must be a valid Ethereum address starting with "0x" or a vald SEI address startng with "sei1".

Now, process the user's request and provide your response.
`;

// Exported for tests
export class TransferAction {
    constructor(private walletProvider: WalletProvider) {}

    async transfer(params: TransferParams): Promise<Transaction> {
        const chain = this.walletProvider.getCurrentChain()
        elizaLogger.log(
            `Transferring: ${params.amount} tokens to (${params.toAddress} on ${chain.name})`
        );
        
        let recipientAddress: `0x${string}`;

        if (params.toAddress.startsWith("sei")) {
            const publicClient = this.walletProvider.getEvmPublicClient();
            const evmAddress = await publicClient.readContract({
                address: ADDRESS_PRECOMPILE_ADDRESS,
                abi: ADDRESS_PRECOMPILE_ABI,
                functionName: 'getEvmAddr',
                args: [params.toAddress],
            });

            if (!evmAddress || !evmAddress.startsWith("0x")) {
                throw new Error(`ERROR: Recipient does not have valid EVM address. Got: ${evmAddress}`);
            }

            elizaLogger.log(`Translated address ${params.toAddress} to EVM address ${evmAddress}`);
            recipientAddress = evmAddress as `0x${string}`;
        } else {
            if (!params.toAddress.startsWith("0x")) {
                throw new Error(`ERROR: Recipient address must start with '0x'. Got: ${params.toAddress}`);
            }
            recipientAddress = params.toAddress as `0x${string}`;
        }

        const walletClient = this.walletProvider.getEvmWalletClient();
        if (!walletClient.account) {
            throw new Error("Wallet client account is undefined");
        }

        try {
            // Simplified transaction without the problematic kzg and blob properties
            const hash = await walletClient.sendTransaction({
                account: walletClient.account,
                to: recipientAddress,
                value: parseEther(params.amount),
                data: (params.data as Hex) || '0x',
            } as any); // Cast to any to bypass type issues

            return {
                hash,
                from: walletClient.account.address,
                to: params.toAddress,
                value: parseEther(params.amount),
                data: (params.data as Hex) || '0x',
            };

        } catch (error) {
            throw new Error(`Transfer failed: ${error.message}`);
        }
    }
}

const buildTransferDetails = async (
    state: State,
    runtime: IAgentRuntime,
    _wp: WalletProvider
): Promise<TransferParams> => {
    // Simplified parameter extraction from message text
    const messageText = state.recentMessagesData?.[0]?.content?.text || "";
    
    // Extract amount and address from message using regex
    const amountMatch = messageText.match(/(\d+(?:\.\d+)?)\s*(?:SEI|sei)/i);
    const addressMatch = messageText.match(/(0x[a-fA-F0-9]{40}|sei1[a-z0-9]{38})/);
    
    if (!amountMatch || !addressMatch) {
        throw new Error("Could not extract transfer amount or recipient address from message");
    }
    
    return {
        amount: amountMatch[1],
        toAddress: addressMatch[1]
    };
};

export const transferAction: Action = {
    name: "TRANSFER_TOKENS",
    description: "Transfer SEI tokens between addresses on the Sei network",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<void> => {
        
        let updatedState = state;
        
        if (!updatedState) {
            // Use AgentRuntime's composeState method instead of runtime.composeState
            updatedState = (await (runtime as any).composeState?.(message)) as State || state;
        }

        elizaLogger.debug("Transfer action handler called");
        
        try {
            const walletProvider = await initWalletProvider(runtime);
            const action = new TransferAction(walletProvider);

            const paramOptions = await buildTransferDetails(
                updatedState,
                runtime,
                walletProvider
            );

            const transferResp = await action.transfer(paramOptions);
            
            if (callback) {
                callback({
                    text: `✅ Successfully transferred ${paramOptions.amount} SEI to ${paramOptions.toAddress}\n\n📄 Transaction Hash: ${transferResp.hash}\n🔗 Chain: ${walletProvider.getCurrentChain().name}`,
                    content: {
                        success: true,
                        hash: transferResp.hash,
                        amount: formatEther(transferResp.value),
                        recipient: transferResp.to,
                        chain: walletProvider.getCurrentChain().name,
                    },
                });
            }
            
        } catch (error) {
            elizaLogger.error("Error during token transfer:", error);
            
            if (callback) {
                callback({
                    text: `❌ Transfer failed: ${error.message}`,
                    content: { 
                        error: true, 
                        message: error.message 
                    },
                });
            }
        }
    },
    
    validate: async (runtime: IAgentRuntime) => {
        try {
            const privateKey = runtime.getSetting?.("SEI_PRIVATE_KEY") || 
                             (runtime as any).settings?.SEI_PRIVATE_KEY;
            return typeof privateKey === "string" && privateKey.startsWith("0x");
        } catch (error) {
            elizaLogger.error("Validation error:", error);
            return false;
        }
    },
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Transfer 1 SEI to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "I'll help you transfer 1 SEI to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 5 SEI to sei1vpz36punknkdjfs7ew2vkdwws8ydcquy00hhsd",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "I'll transfer 5 SEI to the sei address sei1vpz36punknkdjfs7ew2vkdwws8ydcquy00hhsd",
                },
            },
        ],
    ],
    
    similes: ["SEND_TOKENS", "TOKEN_TRANSFER", "MOVE_TOKENS", "SEND_SEI", "TRANSFER"],
};
