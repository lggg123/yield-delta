import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  elizaLogger,
} from "@elizaos/core";
import { validateSeiConfig } from "../environment";
import { WalletProvider, seiChains } from "../providers/wallet";
import { erc20Abi, encodeFunctionData } from 'viem';
import type { SendTransactionParameters } from 'viem';

export interface DragonSwapTradeParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  slippage?: number; // in basis points (100 = 1%)
}

export interface DragonSwapPoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  price: string;
}

class DragonSwapAPI {
  private baseUrl: string;
  private walletProvider: WalletProvider;
  private routerAddress: `0x${string}`;

  constructor(walletProvider: WalletProvider, isTestnet: boolean = false) {
    this.baseUrl = isTestnet
      ? 'https://api-testnet.dragonswap.app/v1'
      : 'https://api.dragonswap.app/v1';
    this.walletProvider = walletProvider;
    
    // Replace with actual DragonSwap router contract addresses
    this.routerAddress = isTestnet 
      ? '0x...' as `0x${string}`  // Testnet router
      : '0x...' as `0x${string}`; // Mainnet router
  }

  async getPoolInfo(tokenA: string, tokenB: string): Promise<DragonSwapPoolInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/pools/${tokenA}/${tokenB}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      elizaLogger.error("Failed to get pool info:", error);
      return null;
    }
  }

  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<{ amountOut: string; priceImpact: number } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn,
          tokenOut,
          amountIn
        })
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      elizaLogger.error("Failed to get quote:", error);
      return null;
    }
  }

  async executeSwap(params: DragonSwapTradeParams): Promise<string | null> {
    try {
      elizaLogger.log(`Executing swap: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut}`);

      // Validate wallet connection
      const walletClient = this.walletProvider.getEvmWalletClient();
      if (!walletClient.account) {
        throw new Error("Wallet not connected");
      }

      // Get quote first
      const quote = await this.getQuote(params.tokenIn, params.tokenOut, params.amountIn);
      if (!quote) {
        throw new Error("Could not get swap quote");
      }

      // Validate quote
      if (parseFloat(quote.amountOut) <= 0) {
        throw new Error("Invalid quote amount");
      }

      // Check slippage
      const slippageMultiplier = 1 - (params.slippage || 100) / 10000;
      const minAmountOut = (parseFloat(quote.amountOut) * slippageMultiplier).toString();

      // Approve token if it's not native SEI
      if (params.tokenIn !== "SEI" && !this.isNativeToken(params.tokenIn)) {
        elizaLogger.log(`Approving token ${params.tokenIn} for swap`);
        await this.approveToken(params.tokenIn, params.amountIn);
      }

      // Prepare transaction parameters
      const transactionRequest = {
        to: this.routerAddress,
        data: this.buildSwapCalldata({
          ...params,
          minAmountOut
        }) as `0x${string}`,
        value: BigInt(params.tokenIn === "SEI" ? params.amountIn : "0")
      };

      // Execute transaction
      const txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        ...transactionRequest
      } as any);
      
      elizaLogger.log(`Swap executed: ${txHash}`);
      return txHash;
    } catch (error) {
      elizaLogger.error("Failed to execute swap:", error);
      return null;
    }
  }

  private buildSwapCalldata(params: DragonSwapTradeParams & { minAmountOut: string }): string {
    const swapRouterAbi = [
      {
        name: 'swapExactTokensForTokens',
        type: 'function',
        inputs: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'path', type: 'address[]' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      {
        name: 'swapExactETHForTokens',
        type: 'function',
        inputs: [
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'path', type: 'address[]' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' }
        ]
      }
    ] as const;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
    const walletAddress = this.walletProvider.getEvmWalletClient().account!.address;

    // Define WSEI address for SEI network
    const WSEI_ADDRESS = "0x..."; // Replace with actual wrapped SEI address

    try {
      if (params.tokenIn === "SEI") {
        // Native SEI to token swap
        return encodeFunctionData({
          abi: swapRouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [
            BigInt(params.minAmountOut),
            [WSEI_ADDRESS as `0x${string}`, params.tokenOut as `0x${string}`], // Use WSEI in path
            walletAddress,
            deadline
          ]
        });
      } else {
        // Token to token swap (or token to SEI)
        const path = params.tokenOut === "SEI" 
          ? [params.tokenIn as `0x${string}`, WSEI_ADDRESS as `0x${string}`]
          : [params.tokenIn as `0x${string}`, params.tokenOut as `0x${string}`];
          
        return encodeFunctionData({
          abi: swapRouterAbi,
          functionName: 'swapExactTokensForTokens',
          args: [
            BigInt(params.amountIn),
            BigInt(params.minAmountOut),
            path,
            walletAddress,
            deadline
          ]
        });
      }
    } catch (error) {
      elizaLogger.error("Failed to encode swap calldata:", error);
      throw new Error("Failed to build transaction data");
    }
  }

  private async approveToken(tokenAddress: string, amount: string): Promise<void> {
    const walletClient = this.walletProvider.getEvmWalletClient();
    
    // Check current allowance first
    const currentAllowance = await this.checkAllowance(tokenAddress, walletClient.account!.address);
    
    if (BigInt(currentAllowance) >= BigInt(amount)) {
      elizaLogger.log(`Token ${tokenAddress} already approved with sufficient allowance`);
      return;
    }
    
    // Encode the approve function call
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [this.routerAddress, BigInt(amount)]
    });
    
    // Send transaction using sendTransaction
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: tokenAddress as `0x${string}`,
      data,
      value: BigInt(0)
    } as any);
    
    elizaLogger.log(`Token approval transaction: ${txHash}`);
  }

  private async checkAllowance(tokenAddress: string, ownerAddress: string): Promise<string> {
    try {
      // Get a public client for reading contract data
      const publicClient = this.walletProvider.getEvmPublicClient(); // Use public client instead
    
      const allowance = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ownerAddress as `0x${string}`, this.routerAddress]
      });
      
      return allowance.toString();
    } catch (error) {
      elizaLogger.error("Failed to check token allowance:", error);
      return "0";
    }
  }

  private isNativeToken(tokenAddress: string): boolean {
    // Check if the token is the native SEI token or wrapped SEI
    const nativeTokens = [
      "SEI",
      "0x0000000000000000000000000000000000000000", // Common representation for native token
      // Add other native token representations for SEI network
    ];
    
    return nativeTokens.includes(tokenAddress.toLowerCase());
  }
}

export const dragonSwapTradeAction: Action = {
  name: "DRAGONSWAP_TRADE",
  similes: [
    "SWAP_ON_DRAGONSWAP",
    "TRADE_DRAGONSWAP",
    "EXCHANGE_TOKENS",
    "SWAP_SEI_TOKENS"
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = await validateSeiConfig(runtime);
    
    // Check if message contains trade intent
    const text = message.content.text.toLowerCase();
    return (
      (text.includes("swap") || text.includes("trade") || text.includes("exchange")) &&
      (text.includes("dragonswap") || text.includes("dragon")) &&
      (text.includes("sei") || text.includes("token"))
    );
  },

  description: "Execute token swaps on DragonSwap DEX on Sei Network",

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ) => {
    elizaLogger.log("Processing DragonSwap trade request");

    try {
      const config = await validateSeiConfig(runtime);
      
      const walletProvider = new WalletProvider(
        config.SEI_PRIVATE_KEY as `0x${string}`,
        runtime.cacheManager,
        { name: config.SEI_NETWORK, chain: seiChains[config.SEI_NETWORK] }
      );

      const dragonSwap = new DragonSwapAPI(
        walletProvider, 
        config.SEI_NETWORK !== "mainnet"
      );

      // Parse trade parameters from message
      const tradeParams = await parseTradeParams(message.content.text);
      if (!tradeParams) {
        callback({
          text: "I couldn't understand the trade parameters. Please specify tokens and amounts. Example: 'Swap 10 SEI for USDC on DragonSwap'",
          error: true
        });
        return;
      }

      // Get current pool info and quote
      const poolInfo = await dragonSwap.getPoolInfo(tradeParams.tokenIn, tradeParams.tokenOut);
      if (!poolInfo) {
        callback({
          text: `No liquidity pool found for ${tradeParams.tokenIn}/${tradeParams.tokenOut} on DragonSwap`,
          error: true
        });
        return;
      }

      const quote = await dragonSwap.getQuote(
        tradeParams.tokenIn, 
        tradeParams.tokenOut, 
        tradeParams.amountIn
      );

      if (!quote) {
        callback({
          text: "Could not get price quote for this trade",
          error: true
        });
        return;
      }

      // Execute the swap
      const txHash = await dragonSwap.executeSwap({
        ...tradeParams,
        minAmountOut: quote.amountOut
      });

      if (txHash) {
        callback({
          text: `✅ Successfully swapped ${tradeParams.amountIn} ${tradeParams.tokenIn} for ~${quote.amountOut} ${tradeParams.tokenOut}\n` +
                `Transaction: ${txHash}\n` +
                `Price Impact: ${quote.priceImpact.toFixed(2)}%`,
        });
      } else {
        callback({
          text: "Failed to execute swap. Please try again later.",
          error: true
        });
      }

    } catch (error) {
      elizaLogger.error("DragonSwap trade error:", error);
      callback({
        text: `Error executing trade: ${error.message}`,
        error: true
      });
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Swap 10 SEI for USDC on DragonSwap" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll execute that swap for you on DragonSwap…",
          action: "DRAGONSWAP_TRADE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Trade 5 USDC for SEI using DragonSwap with 1% slippage" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Executing USDC to SEI swap with 1% slippage tolerance…",
          action: "DRAGONSWAP_TRADE"
        }
      }
    ]
  ]
};

// Helper function to parse trade parameters from natural language
async function parseTradeParams(text: string): Promise<DragonSwapTradeParams | null> {
  const lowerText = text.toLowerCase();

  // Extract amount and tokens using regex patterns
  const amountMatch = lowerText.match(/(?:swap|trade|exchange)\s+(\d+(?:.\d+)?)\s+(\w+)/);
  const forTokenMatch = lowerText.match(/for\s+(\w+)/);
  const slippageMatch = lowerText.match(/(\d+(?:.\d+)?)\s*%\s*slippage/);

  if (!amountMatch || !forTokenMatch) return null;

  return {
    tokenIn: amountMatch[2].toUpperCase(),
    tokenOut: forTokenMatch[1].toUpperCase(),
    amountIn: amountMatch[1],
    minAmountOut: "0", // Will be calculated from quote
    slippage: slippageMatch ? parseFloat(slippageMatch[1]) * 100 : 100 // 1% default
  };
}
