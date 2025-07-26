import { ByteArray, formatEther, parseEther, type Hex } from "viem";
import {
    elizaLogger,
    AgentRuntime,
    composePrompt,
    parseJSONObjectFromText,
    createActionResult,
    createMessageMemory,
    HandlerCallback,
    Action,
    v1,
    v2,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";

import { WalletProvider } from "../providers/wallet";
import { ADDRESS_PRECOMPILE_ABI, ADDRESS_PRECOMPILE_ADDRESS, ChainWithName } from "../types";
import { sei, seiTestnet } from "viem/chains";

// Create simplified interfaces to avoid deep type instantiation
interface SimpleTransferParams {
    amount: string;
    toAddress: string;
}

interface SimpleTransferResponse {
    hash: string;
    to: string;
}

interface TransferParams {
    amount: string;
    toAddress: string;
    data?: string;
}

interface Transaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    data: string;
}

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

Current message: "{{currentMessage}}"
`;

// Exported for tests
export class TransferAction {
    constructor(private walletProvider: WalletProvider) {}

    async transfer(params: TransferParams): Promise<Transaction> {
        const chain = this.walletProvider.getCurrentChain();
        elizaLogger.log(
            `Transferring: ${params.amount} tokens to ${params.toAddress} on ${chain.name}`
        );
        
        let recipientAddress: `0x${string}`;

        // Handle SEI bech32 address conversion
        if (params.toAddress.startsWith("sei")) {
            const publicClient = this.walletProvider.getEvmPublicClient();
            
            try {
                const evmAddress = await publicClient.readContract({
                    address: ADDRESS_PRECOMPILE_ADDRESS as `0x${string}`,
                    abi: ADDRESS_PRECOMPILE_ABI,
                    functionName: 'getEvmAddr',
                    args: [params.toAddress],
                } as any);

                if (!evmAddress || typeof evmAddress !== 'string' || !evmAddress.startsWith("0x")) {
                    throw new Error(`ERROR: Recipient does not have valid EVM address. Got: ${evmAddress}`);
                }

                elizaLogger.log(`Translated address ${params.toAddress} to EVM address ${evmAddress}`);
                recipientAddress = evmAddress as `0x${string}`;
            } catch (error) {
                throw new Error(`Failed to translate SEI address: ${error.message}`);
            }
        } else {
            // Handle EVM address
            if (!params.toAddress.startsWith("0x") || params.toAddress.length !== 42) {
                throw new Error(`ERROR: Recipient address must be valid EVM address (0x...). Got: ${params.toAddress}`);
            }
            recipientAddress = params.toAddress as `0x${string}`;
        }

        // Get wallet client and validate account
        const walletClient = this.walletProvider.getEvmWalletClient();
        if (!walletClient?.account?.address) {
            throw new Error("Wallet client account is undefined or invalid");
        }

        try {
            // Execute the transfer
            elizaLogger.log(`Sending transaction from ${walletClient.account.address} to ${recipientAddress}`);
            
            const valueInWei = parseEther(params.amount);
            const transactionRequest = {
                to: recipientAddress,
                value: valueInWei,
                data: (params.data as Hex) || '0x',
            };

            // Use type assertion to avoid deep type issues
            const hash = await (walletClient as any).sendTransaction(transactionRequest);

            if (!hash || typeof hash !== 'string') {
                throw new Error('Invalid transaction hash received');
            }

            elizaLogger.log(`Transaction sent successfully. Hash: ${hash}`);

            return {
                hash,
                from: walletClient.account.address,
                to: params.toAddress,
                value: parseEther(params.amount).toString(),
                data: (params.data as Hex) || '0x',
            };

        } catch (error) {
            elizaLogger.error(`Transfer failed: ${error.message}`);
            throw new Error(`Transfer failed: ${error.message}`);
        }
    }

    /**
     * Validate transfer parameters before execution
     */
    validateParams(params: TransferParams): void {
        if (!params.amount || isNaN(Number(params.amount)) || Number(params.amount) <= 0) {
            throw new Error('Invalid amount: must be a positive number');
        }

        if (!params.toAddress || params.toAddress.length === 0) {
            throw new Error('Invalid recipient address: cannot be empty');
        }

        // Validate SEI bech32 address format
        if (params.toAddress.startsWith('sei')) {
            if (params.toAddress.length !== 43) {
                throw new Error('Invalid SEI address: must be 43 characters long');
            }
        }
        // Validate EVM address format
        else if (params.toAddress.startsWith('0x')) {
            if (params.toAddress.length !== 42) {
                throw new Error('Invalid EVM address: must be 42 characters long');
            }
        } else {
            throw new Error('Invalid address format: must start with "sei" or "0x"');
        }
    }

    /**
     * Get estimated gas for the transfer
     */
    async estimateGas(params: TransferParams): Promise<bigint> {
        try {
            this.validateParams(params);
            
            const publicClient = this.walletProvider.getEvmPublicClient();
            const walletClient = this.walletProvider.getEvmWalletClient();
            
            if (!walletClient?.account?.address) {
                throw new Error("Wallet account not available for gas estimation");
            }

            let recipientAddress: `0x${string}`;
            
            if (params.toAddress.startsWith("sei")) {
                const evmAddress = await publicClient.readContract({
                    address: ADDRESS_PRECOMPILE_ADDRESS as `0x${string}`,
                    abi: ADDRESS_PRECOMPILE_ABI,
                    functionName: 'getEvmAddr',
                    args: [params.toAddress],
                } as any);
                recipientAddress = evmAddress as `0x${string}`;
            } else {
                recipientAddress = params.toAddress as `0x${string}`;
            }

            const gasEstimate = await (publicClient as any).estimateGas({
                account: walletClient.account.address,
                to: recipientAddress,
                value: parseEther(params.amount),
                data: (params.data as Hex) || '0x',
            });

            return gasEstimate;
        } catch (error) {
            elizaLogger.error(`Gas estimation failed: ${error.message}`);
            // Return a conservative estimate if estimation fails
            return BigInt(21000);
        }
    }
}

export const transferAction: Action = {
    name: "TRANSFER_TOKENS",
    similes: [
        "SEND_TOKENS", 
        "TOKEN_TRANSFER", 
        "MOVE_TOKENS", 
        "SEND_SEI",
        "TRANSFER"
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        try {
            const privateKey = runtime.getSetting?.("SEI_PRIVATE_KEY");
            if (!privateKey || !privateKey.startsWith("0x")) {
                return false;
            }

            const text = message.content.text.toLowerCase();
            return (
                (text.includes("transfer") || text.includes("send") || text.includes("move")) &&
                (text.includes("sei") || text.includes("token")) &&
                (text.includes("0x") || text.includes("sei1"))
            );
        } catch (error) {
            elizaLogger.error("Transfer validation error:", error);
            return false;
        }
    },
    description: "Transfer SEI tokens between addresses on the Sei network",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any, // Use any instead of complex Record type
        callback?: any // Simplify callback type
    ): Promise<void> => {
        elizaLogger.debug("Transfer action handler called");
        
        try {
            // Build transfer parameters
            const params = await buildTransferDetails(message, runtime);
            
            const walletProvider = await initWalletProvider(runtime);
            const action = new TransferAction(walletProvider);

            const transferResp = await action.transfer(params);
            
            if (callback) {
                // Store values in variables to break type complexity
                const chainName = String(walletProvider.getCurrentChain().name);
                const hash = String(transferResp.hash);
                const recipient = String(transferResp.to);
                const amount = String(params.amount);
                const toAddress = String(params.toAddress);
                
                const successMessage = `✅ Successfully transferred ${amount} SEI to ${toAddress}\n\n📄 Transaction Hash: ${hash}\n🔗 Chain: ${chainName}`;
                
                // Create simple response object
                const response = {
                    text: successMessage,
                    content: {
                        success: true,
                        hash,
                        amount,
                        recipient,
                        chain: chainName,
                    },
                };
                
                (callback as any)(response);
            }
            
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            elizaLogger.error("Error during token transfer:", error);
            
            if (callback) {
                const errorResponse = {
                    text: `❌ Transfer failed: ${errorMessage}`,
                    content: { 
                        error: true, 
                        message: errorMessage 
                    },
                };
                
                (callback as any)(errorResponse);
            }
        }
    },
    
    examples: [
        [
            {
                name: "{{user1}}",
                content: {
                    text: "Transfer 1 SEI to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                },
            },
            {
                name: "{{agentName}}",
                content: {
                    text: "I'll help you transfer 1 SEI to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                },
            },
        ],
        [
            {
                name: "{{user1}}",
                content: {
                    text: "Send 5 SEI to sei1abc123def456",
                },
            },
            {
                name: "{{agentName}}",
                content: {
                    text: "Transferring 5 SEI to sei1abc123def456",
                },
            },
        ],
    ],
};

// Simplified helper functions
async function buildTransferDetails(message: Memory, runtime: IAgentRuntime): Promise<TransferParams> {
    // Use optional chaining with fallback
    const messageText = message?.content?.text ?? "";
    
    if (!messageText.trim()) {
        throw new Error("Invalid message: empty or missing text content");
    }

    const params = parseTransferParams(messageText);
    
    if (!params) {
        throw new Error("Could not parse transfer parameters. Please specify amount and recipient address.\n\nExample: 'Send 100 SEI to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e'");
    }
    
    return params;
}

function parseTransferParams(text: string): SimpleTransferParams | null {
    // Extract amount and address using regex
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:SEI|sei)/i);
    const addressMatch = text.match(/(0x[a-fA-F0-9]{40}|sei1[a-z0-9]{38})/);
    
    if (!amountMatch || !addressMatch) {
        return null;
    }
    
    return {
        amount: amountMatch[1],
        toAddress: addressMatch[1]
    };
}

// Define configuration with type assertions upfront
class ChainConfigFactory {
    private static configs = new Map([
        ['mainnet', { name: 'sei-mainnet', chain: sei }],
        ['testnet', { name: 'sei-testnet', chain: seiTestnet }],
        ['atlantic-2', { name: 'sei-testnet', chain: seiTestnet }]
    ]);

    static create(network: string): ChainWithName {
        const config = this.configs.get(network.toLowerCase());
        
        if (!config) {
            throw new Error(`Unsupported network: ${network}. Supported: ${Array.from(this.configs.keys()).join(', ')}`);
        }
        
        return {
            name: config.name,
            chain: config.chain as any // Type assertion
        };
    }
}

function createChainWithName(network: string): ChainWithName {
    return ChainConfigFactory.create(network);
}

// Update your initWalletProvider function
async function initWalletProvider(runtime: IAgentRuntime): Promise<WalletProvider> {
    const privateKey = runtime.getSetting("SEI_PRIVATE_KEY");
    const network = runtime.getSetting("SEI_NETWORK") || "testnet";
    
    if (!privateKey || !privateKey.startsWith("0x")) {
        throw new Error("Invalid or missing SEI_PRIVATE_KEY");
    }

    // Create the proper ChainWithName object
    const chainWithName = createChainWithName(network);
    
    return new WalletProvider(privateKey as `0x${string}`, chainWithName);
}