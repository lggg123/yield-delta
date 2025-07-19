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
import { SeiOracleProvider } from "../providers/oracle";
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

  constructor(walletProvider: WalletProvider, oracleProvider: SeiOracleProvider, isTestnet: boolean = false) {
    this.baseUrl = isTestnet
      ? 'https://api-testnet.perpsdex.app/v1'
      : 'https://api.perpsdex.app/v1';
    this.walletProvider = walletProvider;
    this.oracleProvider = oracleProvider;
    
    // Replace with actual perpetuals contract address
    this.contractAddress = isTestnet 
      ? '0x...' as `0x${string}`  // Testnet perps contract
      : '0x...' as `0x${string}`; // Mainnet perps contract
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
    "OPEN_POSITION",
    "CLOSE_POSITION",
    "LEVERAGE_TRADE",
    "PERPETUAL_TRADE"
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = await validateSeiConfig(runtime);
    
    const text = message.content.text.toLowerCase();
    return (
      (text.includes("long") || text.includes("short") || text.includes("leverage") || text.includes("perp")) &&
      (text.includes("open") || text.includes("close") || text.includes("trade"))
    );
  },

  description: "Execute perpetual futures trading positions",

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ) => {
    elizaLogger.log("Processing perpetual trading request");

    try {
      const config = await validateSeiConfig(runtime);
      
      const walletProvider = new WalletProvider(
        config.SEI_PRIVATE_KEY as `0x${string}`,
        runtime.cacheManager,
        { name: config.SEI_NETWORK, chain: seiChains[config.SEI_NETWORK] }
      );

      const oracleProvider = new SeiOracleProvider(runtime);
      const perpsAPI = new PerpsAPI(
        walletProvider,
        oracleProvider,
        config.SEI_NETWORK !== "mainnet"
      );

      const text = message.content.text.toLowerCase();

      // Check if it's a position query
      if (text.includes("position") && (text.includes("check") || text.includes("show") || text.includes("status"))) {
        const positions = await perpsAPI.getPositions(walletProvider.getEvmWalletClient().account!.address);
        
        if (positions.length === 0) {
          callback({
            text: "You have no open perpetual positions.",
          });
          return;
        }

        const positionsText = positions.map(p => 
          `${p.symbol} ${p.side.toUpperCase()}: ${p.size} USD @ ${p.leverage}x leverage\n` +
          `Entry: $${p.entryPrice} | Mark: $${p.markPrice} | PnL: $${p.pnl}`
        ).join('\n\n');

        callback({
          text: `Your open positions:\n\n${positionsText}`,
        });
        return;
      }

      // Parse trade parameters
      const tradeParams = await parsePerpsTradeParams(message.content.text);
      if (!tradeParams) {
        callback({
          text: "I couldn't understand the trade parameters. Please specify: symbol, side (long/short), size, leverage. Example: 'Open long BTC 1000 USD at 10x leverage'",
          error: true
        });
        return;
      }

      // Execute trade
      if (text.includes("close")) {
        const txHash = await perpsAPI.closePosition(tradeParams.symbol, tradeParams.size);
        
        if (txHash) {
          callback({
            text: `✅ Position closed successfully!\nTransaction: ${txHash}`,
          });
        } else {
          callback({
            text: "Failed to close position. Please try again later.",
            error: true
          });
        }
      } else {
        const txHash = await perpsAPI.openPosition(tradeParams);
        
        if (txHash) {
          callback({
            text: `✅ ${tradeParams.side.toUpperCase()} position opened!\n` +
                  `${tradeParams.symbol}: ${tradeParams.size} USD at ${tradeParams.leverage}x leverage\n` +
                  `Transaction: ${txHash}`,
          });
        } else {
          callback({
            text: "Failed to open position. Please try again later.",
            error: true
          });
        }
      }

    } catch (error) {
      elizaLogger.error("Perps trading error:", error);
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
        content: { text: "Open long BTC 1000 USD at 10x leverage" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Opening long BTC position with 10x leverage...",
          action: "PERPS_TRADE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Close my ETH short position" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Closing your ETH short position...",
          action: "PERPS_TRADE"
        }
      }
    ]
  ]
};

// Helper function to parse perpetual trade parameters
async function parsePerpsTradeParams(text: string): Promise<PerpsTradeParams | null> {
  const lowerText = text.toLowerCase();

  // Extract parameters
  const sideMatch = lowerText.match(/\b(long|short)\b/);
  const symbolMatch = lowerText.match(/\b(btc|eth|sei|sol|avax|ada|dot)\b/i);
  const sizeMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:usd|dollars?)/);
  const leverageMatch = lowerText.match(/(\d+(?:\.\d+)?)x?\s*leverage/);

  if (!sideMatch || !symbolMatch || !sizeMatch) return null;

  return {
    symbol: symbolMatch[1].toUpperCase(),
    side: sideMatch[1] as 'long' | 'short',
    size: sizeMatch[1],
    leverage: leverageMatch ? parseFloat(leverageMatch[1]) : 1,
    slippage: 50, // 0.5% default
    reduceOnly: lowerText.includes("reduce") || lowerText.includes("close")
  };
}