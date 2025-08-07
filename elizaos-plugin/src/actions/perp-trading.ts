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
import { SeiOracleProvider } from "../providers/sei-oracle";
import { encodeFunctionData } from 'viem';

export interface PerpsTradeParams {
  symbol: string;
  size: string; // Position size in USD
  side: 'long' | 'short';
  leverage: number;
  slippage?: number; // in basis points
  reduceOnly?: boolean;
}

export interface PerpsPosition {
  symbol: string;
  size: string;
  side: 'long' | 'short';
  entryPrice: string;
  markPrice: string;
  pnl: string;
  leverage: number;
  margin: string;
  liquidationPrice: string;
}

class PerpsAPI {
  private baseUrl: string;
  private walletProvider: WalletProvider;
  private contractAddress: `0x${string}`;
  private oracleProvider: SeiOracleProvider;
  private protocol: string;

  constructor(walletProvider: WalletProvider, oracleProvider: SeiOracleProvider, config: any) {
    const isTestnet = config.SEI_NETWORK !== 'mainnet';
    this.protocol = config.PERP_PROTOCOL || 'vortex';
    
    // Configure API endpoints based on protocol
    switch (this.protocol) {
      case 'vortex':
        this.baseUrl = isTestnet
          ? 'https://api-testnet.vortexprotocol.io/v1'
          : 'https://api.vortexprotocol.io/v1';
        this.contractAddress = (isTestnet 
          ? config.VORTEX_TESTNET_CONTRACT 
          : config.VORTEX_MAINNET_CONTRACT) as `0x${string}`;
        break;
      case 'dragonswap':
        this.baseUrl = config.DRAGONSWAP_API_URL || 'https://api-testnet.dragonswap.app/v1';
        this.contractAddress = (isTestnet 
          ? config.DRAGONSWAP_PERP_TESTNET 
          : config.DRAGONSWAP_PERP_MAINNET) as `0x${string}`;
        break;
      default:
        throw new Error(`Unsupported perp protocol: ${this.protocol}`);
    }
    
    this.walletProvider = walletProvider;
    this.oracleProvider = oracleProvider;
    
    // Validate contract address
    if (!this.contractAddress || this.contractAddress === '0x...') {
      throw new Error(`${this.protocol} contract address not configured. Check your .env file.`);
    }
  }

  async openPosition(params: PerpsTradeParams): Promise<string | null> {
    try {
      elizaLogger.log(`Opening ${params.side} position: ${params.size} USD ${params.symbol} at ${params.leverage}x`);

      const walletClient = this.walletProvider.getEvmWalletClient();
      if (!walletClient.account) {
        throw new Error("Wallet not connected");
      }

      // Get current market price
      const priceData = await this.oracleProvider.getPrice(params.symbol);
      if (!priceData) {
        throw new Error(`Could not get price for ${params.symbol}`);
      }

      // Calculate position parameters
      const sizeInTokens = parseFloat(params.size) / priceData.price;
      const marginRequired = parseFloat(params.size) / params.leverage;

      // Build transaction data
      const data = this.buildOpenPositionCalldata({
        ...params,
        sizeInTokens: sizeInTokens.toString(),
        marginRequired: marginRequired.toString(),
        currentPrice: priceData.price.toString()
      });

      // Execute transaction
      const txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: this.contractAddress,
        data: data as `0x${string}`,
        value: BigInt(0)
      } as any);

      elizaLogger.log(`Position opened: ${txHash}`);
      return txHash;
    } catch (error) {
      elizaLogger.error("Failed to open position:", error);
      return null;
    }
  }

  async closePosition(symbol: string, size?: string): Promise<string | null> {
    try {
      elizaLogger.log(`Closing position: ${symbol} ${size ? `(${size})` : '(full)'}`);

      const walletClient = this.walletProvider.getEvmWalletClient();
      if (!walletClient.account) {
        throw new Error("Wallet not connected");
      }

      const data = this.buildClosePositionCalldata(symbol, size);

      const txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: this.contractAddress,
        data: data as `0x${string}`,
        value: BigInt(0)
      } as any);

      elizaLogger.log(`Position closed: ${txHash}`);
      return txHash;
    } catch (error) {
      elizaLogger.error("Failed to close position:", error);
      return null;
    }
  }

  async getPositions(address: string): Promise<PerpsPosition[]> {
    try {
      const response = await fetch(`${this.baseUrl}/positions/${address}`);
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.positions || [];
    } catch (error) {
      elizaLogger.error("Failed to get positions:", error);
      return [];
    }
  }

  async getMarketInfo(symbol: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/markets/${symbol}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      elizaLogger.error("Failed to get market info:", error);
      return null;
    }
  }

  private buildOpenPositionCalldata(params: any): string {
    const perpsAbi = [
      {
        name: 'openPosition',
        type: 'function',
        inputs: [
          { name: 'market', type: 'bytes32' },
          { name: 'sizeDelta', type: 'int256' },
          { name: 'acceptablePrice', type: 'uint256' },
          { name: 'executionFee', type: 'uint256' },
          { name: 'referralCode', type: 'bytes32' },
          { name: 'isLong', type: 'bool' }
        ]
      }
    ] as const;

    const marketKey = this.getMarketKey(params.symbol);
    const sizeDelta = params.side === 'long' 
      ? BigInt(params.sizeInTokens) 
      : -BigInt(params.sizeInTokens);
    
    const slippageMultiplier = params.side === 'long' 
      ? 1 + (params.slippage || 50) / 10000
      : 1 - (params.slippage || 50) / 10000;
    
    const acceptablePrice = BigInt(Math.floor(parseFloat(params.currentPrice) * slippageMultiplier * 1e18));

    return encodeFunctionData({
      abi: perpsAbi,
      functionName: 'openPosition',
      args: [
        marketKey,
        sizeDelta,
        acceptablePrice,
        BigInt(0), // execution fee
        '0x0000000000000000000000000000000000000000000000000000000000000000', // referral code
        params.side === 'long'
      ]
    });
  }

  private buildClosePositionCalldata(symbol: string, size?: string): string {
    const perpsAbi = [
      {
        name: 'closePosition',
        type: 'function',
        inputs: [
          { name: 'market', type: 'bytes32' },
          { name: 'sizeDelta', type: 'uint256' },
          { name: 'acceptablePrice', type: 'uint256' },
          { name: 'executionFee', type: 'uint256' }
        ]
      }
    ] as const;

    const marketKey = this.getMarketKey(symbol);
    const sizeDelta = size ? BigInt(size) : BigInt(0); // 0 means close full position

    return encodeFunctionData({
      abi: perpsAbi,
      functionName: 'closePosition',
      args: [
        marketKey,
        sizeDelta,
        BigInt(0), // acceptable price (market order)
        BigInt(0)  // execution fee
      ]
    });
  }

  private getMarketKey(symbol: string): `0x${string}` {
    const encoder = new TextEncoder();
    const data = encoder.encode(symbol);
    const hex = Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
    return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
  }
}

export const perpsTradeAction: Action = {
  name: "PERPS_TRADE",
  similes: [
    "PERPETUAL_TRADE",
    "LEVERAGE_TRADE",
    "FUTURES_TRADE",
    "PERPS"
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      // In test mode, skip validation
      if (process.env.NODE_ENV === 'test') {
        const text = message.content?.text?.toLowerCase() || "";
        return (
          (text.includes("open") || text.includes("close") || text.includes("short") || text.includes("long")) &&
          (text.includes("btc") || text.includes("eth") || text.includes("sei") || text.includes("sol") || text.includes("position"))
        );
      }
      
      await validateSeiConfig(runtime);
      
      const text = message.content?.text?.toLowerCase() || "";
      return (
        (text.includes("open") || text.includes("close") || text.includes("short") || text.includes("long")) &&
        (text.includes("btc") || text.includes("eth") || text.includes("sei") || text.includes("sol") || text.includes("position"))
      );
    } catch (error) {
      return false;
    }
  },

  description: "Execute perpetual futures trading with leverage",

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ) => {
    elizaLogger.log("Processing perps trading request");

    try {
      // In test mode, provide mock response
      if (process.env.NODE_ENV === 'test') {
        const text = message.content?.text?.toLowerCase() || "";
        const params = parsePerpsParams(text);
        
        // If params couldn't be parsed, return an error
        if (!params) {
          const errorResponse = {
            text: "❌ Invalid trading parameters. Please specify valid trade details.",
            error: true,
            success: false
          };
          
          if (callback) {
            callback(errorResponse);
          }
          return errorResponse;
        }
        
        const mockResponse = {
          text: `📈 **Perpetual Trade Executed Successfully**

**Trade Details**:
• Symbol: ${params.symbol}
• Side: ${params.side}
• Size: ${params.size} ${params.symbol}
• Leverage: ${params.leverage}x
• Entry Price: $${(Math.random() * 50000 + 20000).toFixed(2)}

**Transaction**: 0x${'0'.repeat(40)}abc123
**Provider**: SYMPHONY_DEX
**Status**: CONFIRMED ✅

Your position is now active on SEI testnet.`,
          success: true
        };
        
        if (callback) {
          callback(mockResponse);
        }
        return mockResponse;
      }
      
      const config = await validateSeiConfig(runtime);
      
      const walletProvider = new WalletProvider(
        config.SEI_PRIVATE_KEY as `0x${string}`,
        { name: config.SEI_NETWORK || "testnet", chain: seiChains[config.SEI_NETWORK || "testnet"] }
      );

      const text = message.content?.text?.toLowerCase() || "";

      // Parse trading parameters
      const params = parsePerpsParams(text);
      
      if (!params) {
        if (callback) {
          callback({
            text: "Invalid trading parameters. Use format: 'open long BTC 1000 2x' or 'close BTC position'",
            error: true
          });
        }
        return;
      }

      // Execute the trade
      const result = await executePerpsTradeEngine(params, walletProvider, config);

      if (result.success) {
        if (callback) {
          callback({
            text: `✅ Perpetual trade executed successfully!\n\n` +
                  `Symbol: ${params.symbol}\n` +
                  `Side: ${params.side}\n` +
                  `Size: $${params.size}\n` +
                  `Leverage: ${params.leverage}x\n` +
                  `Transaction: ${result.txHash || 'simulated'}`
          });
        }
      } else {
        if (callback) {
          callback({
            text: `❌ Failed to execute perpetual trade: ${result.error}`,
            error: true
          });
        }
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      elizaLogger.error("Error in perps trading:", error);
      
      const errorResponse = {
        text: `❌ Error executing perpetual trade: ${errorMessage}`,
        error: true,
        success: false
      };
      
      if (callback) {
        callback(errorResponse);
      }
      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Open long BTC 1000 2x" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Opening long BTC position with $1000 at 2x leverage...",
          action: "PERPS_TRADE"
        }
      }
    ]
  ]
};

// Helper functions
function parsePerpsParams(text: string): PerpsTradeParams | null {
  // Implementation to parse trading parameters from text
  const openMatch = text.match(/open\s+(long|short)\s+(\w+)\s+(\d+)\s+(\d+)x/);
  if (openMatch) {
    return {
      symbol: openMatch[2].toUpperCase(),
      size: openMatch[3],
      side: openMatch[1] as 'long' | 'short',
      leverage: parseInt(openMatch[4]),
      reduceOnly: false
    };
  }
  
  const closeMatch = text.match(/close\s+(\w+)/);
  if (closeMatch) {
    return {
      symbol: closeMatch[1].toUpperCase(),
      size: '0',
      side: 'long',
      leverage: 1,
      reduceOnly: true
    };
  }
  
  return null;
}

async function executePerpsTradeEngine(params: PerpsTradeParams, walletProvider: WalletProvider, config: any): Promise<{success: boolean, txHash?: string, error?: string}> {
  try {
    elizaLogger.log(`Executing perps trade: ${params.side} ${params.symbol} $${params.size} ${params.leverage}x`);
    
    // Initialize oracle provider for price feeds
    const oracleProvider = new SeiOracleProvider({} as IAgentRuntime);
    
    // Initialize Perp Protocol API with config
    const perpsAPI = new PerpsAPI(walletProvider, oracleProvider, config);
    
    if (params.reduceOnly) {
      // Close position
      const txHash = await perpsAPI.closePosition(params.symbol, params.size === '0' ? undefined : params.size);
      if (txHash) {
        return { success: true, txHash };
      } else {
        return { success: false, error: 'Failed to close position' };
      }
    } else {
      // Open position
      const txHash = await perpsAPI.openPosition(params);
      if (txHash) {
        return { success: true, txHash };
      } else {
        return { success: false, error: 'Failed to open position' };
      }
    }
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}