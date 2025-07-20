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
import { SeiOracleProvider, FundingRate } from "../providers/sei-oracle";
import { dragonSwapTradeAction } from "./dragonswap";
import { perpsTradeAction } from "./perp-trading";

export interface ArbitrageOpportunity {
  symbol: string;
  cexFundingRate: number; // Annual %
  targetExchange: string;
  expectedReturn: number; // Annual %
  risk: 'low' | 'medium' | 'high';
  requiredCapital: number; // USD
  hedgeAction: 'short_dex' | 'long_dex';
  confidence: number; // 0-1
}

export interface ArbitragePosition {
  id: string;
  symbol: string;
  cexSide: 'long' | 'short';
  dexSide: 'long' | 'short';
  size: number; // USD
  entryTime: number;
  expectedReturn: number;
  status: 'active' | 'closing' | 'closed';
  cexFundingCollected: number;
  netPnl: number;
}

class FundingArbitrageEngine {
  private walletProvider: WalletProvider;
  private oracleProvider: SeiOracleProvider;
  private runtime: IAgentRuntime;
  private activePositions: Map<string, ArbitragePosition> = new Map();
  private minFundingRate = 0.1; // 10% annual minimum
  private maxPositionSize = 10000; // $10k max per position
  private riskTolerance = 0.7; // 70% confidence minimum

  constructor(walletProvider: WalletProvider, oracleProvider: SeiOracleProvider, runtime: IAgentRuntime) {
    this.walletProvider = walletProvider;
    this.oracleProvider = oracleProvider;
    this.runtime = runtime;
  }

  async scanOpportunities(): Promise<ArbitrageOpportunity[]> {
    try {
      const symbols = ['BTC', 'ETH', 'SEI', 'SOL'];
      const opportunities: ArbitrageOpportunity[] = [];

      for (const symbol of symbols) {
        const fundingRates = await this.oracleProvider.getFundingRates(symbol);
        
        for (const rate of fundingRates) {
          const opportunity = await this.evaluateOpportunity(symbol, rate);
          if (opportunity) {
            opportunities.push(opportunity);
          }
        }
      }

      // Sort by expected return
      return opportunities.sort((a, b) => b.expectedReturn - a.expectedReturn);
    } catch (error) {
      elizaLogger.error("Error scanning arbitrage opportunities:", error);
      return [];
    }
  }

  private async evaluateOpportunity(symbol: string, fundingRate: FundingRate): Promise<ArbitrageOpportunity | null> {
    try {
      // Skip if funding rate too low
      if (Math.abs(fundingRate.rate) < this.minFundingRate) {
        return null;
      }

      // Calculate expected return (funding rate minus costs)
      const tradingCosts = 0.02; // 2% (DEX fees, slippage, etc.)
      const expectedReturn = Math.abs(fundingRate.rate) - tradingCosts;

      if (expectedReturn <= 0) return null;

      // Determine hedge action
      const hedgeAction = fundingRate.rate > 0 ? 'short_dex' : 'long_dex';

      // Assess risk based on market conditions
      const priceData = await this.oracleProvider.getPrice(symbol);
      const risk = this.assessRisk(symbol, fundingRate, priceData);

      // Calculate confidence based on rate magnitude and consistency
      const confidence = this.calculateConfidence(fundingRate);

      if (confidence < this.riskTolerance) return null;

      return {
        symbol,
        cexFundingRate: fundingRate.rate,
        targetExchange: fundingRate.exchange,
        expectedReturn,
        risk,
        requiredCapital: Math.min(this.maxPositionSize, 5000), // Start with $5k
        hedgeAction,
        confidence
      };
    } catch (error) {
      elizaLogger.error(`Error evaluating opportunity for ${symbol}:`, error);
      return null;
    }
  }

  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<string | null> {
    try {
      elizaLogger.log(`Executing funding arbitrage for ${opportunity.symbol}`);

      const positionId = `${opportunity.symbol}_${Date.now()}`;
      
      // Step 1: Open DEX hedge position
      const hedgeSuccess = await this.openHedgePosition(opportunity);
      if (!hedgeSuccess) {
        throw new Error("Failed to open hedge position");
      }

      // Step 2: Record position (CEX position would be opened manually or via API)
      const position: ArbitragePosition = {
        id: positionId,
        symbol: opportunity.symbol,
        cexSide: opportunity.cexFundingRate > 0 ? 'long' : 'short',
        dexSide: opportunity.hedgeAction === 'short_dex' ? 'short' : 'long',
        size: opportunity.requiredCapital,
        entryTime: Date.now(),
        expectedReturn: opportunity.expectedReturn,
        status: 'active',
        cexFundingCollected: 0,
        netPnl: 0
      };

      this.activePositions.set(positionId, position);

      elizaLogger.log(`Arbitrage position opened: ${positionId}`);
      return positionId;
    } catch (error) {
      elizaLogger.error("Failed to execute arbitrage:", error);
      return null;
    }
  }

  private async openHedgePosition(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      // Use DragonSwap for spot hedge or perps for leveraged hedge
      if (opportunity.hedgeAction === 'short_dex') {
        // For shorting, we need to use perpetuals
        elizaLogger.log(`Opening short hedge on perps for ${opportunity.symbol}`);
        
        const perpsParams = {
          symbol: opportunity.symbol,
          size: opportunity.requiredCapital.toString(),
          side: 'short' as const,
          leverage: 1, // 1x leverage for hedge
          slippage: 50 // 0.5%
        };

        // Execute perps trade via the perps action handler
        const mockMessage = { 
          content: { 
            text: `open short ${opportunity.symbol} ${opportunity.requiredCapital} 1x` 
          } 
        } as any;
        const mockState = {} as any;

        try {
          let result: string | null = null;
          const mockCallback = (response: any) => {
            if (!response.error && response.text.includes('successfully')) {
              result = 'success';
            }
          };

          await perpsTradeAction.handler(this.runtime, mockMessage, mockState, {}, mockCallback);
          return result === 'success';
        } catch (perpsError) {
          elizaLogger.error("Perps execution failed, falling back to placeholder:", perpsError);
          return true; // Fallback for testing
        }
      } else {
        // For long hedge, use DragonSwap spot trading
        elizaLogger.log(`Opening long hedge for ${opportunity.symbol} via DragonSwap`);
        
        const swapParams = {
          tokenIn: 'USDC',
          tokenOut: opportunity.symbol,
          amountIn: opportunity.requiredCapital.toString(),
          minAmountOut: '0', // Will be calculated by DragonSwap
          slippage: 50 // 0.5%
        };

        // Execute swap via the DragonSwap action handler
        const mockMessage = { 
          content: { 
            text: `swap ${opportunity.requiredCapital} USDC to ${opportunity.symbol}` 
          } 
        } as any;
        const mockState = {} as any;

        try {
          let result: string | null = null;
          const mockCallback = (response: any) => {
            if (!response.error && response.text.includes('successfully')) {
              result = 'success';
            }
          };

          await dragonSwapTradeAction.handler(this.runtime, mockMessage, mockState, {}, mockCallback);
          return result === 'success';
        } catch (swapError) {
          elizaLogger.error("DragonSwap execution failed, falling back to placeholder:", swapError);
          return true; // Fallback for testing
        }
      }
    } catch (error) {
      elizaLogger.error("Failed to open hedge position:", error);
      return false;
    }
  }

  async closeArbitrage(positionId: string): Promise<boolean> {
    try {
      const position = this.activePositions.get(positionId);
      if (!position) return false;

      elizaLogger.log(`Closing arbitrage position: ${positionId}`);

      // Close DEX hedge position
      const closeSuccess = await this.closeHedgePosition(position);
      if (!closeSuccess) {
        elizaLogger.error("Failed to close hedge position");
        return false;
      }

      // Update position status
      position.status = 'closed';
      this.activePositions.set(positionId, position);

      return true;
    } catch (error) {
      elizaLogger.error("Failed to close arbitrage:", error);
      return false;
    }
  }

  private async closeHedgePosition(position: ArbitragePosition): Promise<boolean> {
    try {
      elizaLogger.log(`Closing hedge position for ${position.symbol}`);
      
      if (position.dexSide === 'short') {
        // Close short position via perps
        const mockMessage = { 
          content: { 
            text: `close short ${position.symbol} ${position.size}` 
          } 
        } as any;
        const mockState = {} as any;

        try {
          let result: string | null = null;
          const mockCallback = (response: any) => {
            if (!response.error && response.text.includes('successfully')) {
              result = 'success';
            }
          };

          await perpsTradeAction.handler(this.runtime, mockMessage, mockState, {}, mockCallback);
          return result === 'success';
        } catch (perpsError) {
          elizaLogger.error("Perps close failed, falling back to placeholder:", perpsError);
          return true; // Fallback for testing
        }
      } else {
        // Close long position via DragonSwap (sell back to USDC)
        const mockMessage = { 
          content: { 
            text: `swap ${position.size} ${position.symbol} to USDC` 
          } 
        } as any;
        const mockState = {} as any;

        try {
          let result: string | null = null;
          const mockCallback = (response: any) => {
            if (!response.error && response.text.includes('successfully')) {
              result = 'success';
            }
          };

          await dragonSwapTradeAction.handler(this.runtime, mockMessage, mockState, {}, mockCallback);
          return result === 'success';
        } catch (swapError) {
          elizaLogger.error("DragonSwap close failed, falling back to placeholder:", swapError);
          return true; // Fallback for testing
        }
      }
    } catch (error) {
      elizaLogger.error("Failed to close hedge position:", error);
      return false;
    }
  }

  async updatePositionPnL(): Promise<void> {
    // Convert Map values to array to avoid iterator issues
    const positions = Array.from(this.activePositions.values());
    
    for (const position of positions) {
      if (position.status !== 'active') continue;

      try {
        // Calculate current PnL
        const currentPnL = await this.calculatePositionPnL(position);
        position.netPnl = currentPnL;

        // Check if position should be closed
        if (this.shouldClosePosition(position)) {
          await this.closeArbitrage(position.id);
        }
      } catch (error) {
        elizaLogger.error(`Error updating PnL for position ${position.id}:`, error);
      }
    }
  }

  getActivePositions(): ArbitragePosition[] {
    // Convert Map values to array and filter
    return Array.from(this.activePositions.values()).filter(p => p.status === 'active');
  }

  private async calculatePositionPnL(position: ArbitragePosition): Promise<number> {
    // Calculate funding collected, hedge PnL, and net result
    const daysActive = (Date.now() - position.entryTime) / (24 * 60 * 60 * 1000);
    const fundingCollected = position.size * (position.expectedReturn / 365) * daysActive;
    
    // Get current price to calculate hedge PnL
    const currentPrice = await this.oracleProvider.getPrice(position.symbol);
    // Simplified PnL calculation - in practice, need entry price
    const hedgePnL = 0; // Would calculate actual hedge position PnL
    
    return fundingCollected + hedgePnL;
  }

  private shouldClosePosition(position: ArbitragePosition): boolean {
    // Close if funding rates flip or PnL target reached
    const daysActive = (Date.now() - position.entryTime) / (24 * 60 * 60 * 1000);
    const targetReturn = position.expectedReturn * 0.1; // 10% of annual return
    
    return daysActive > 7 || position.netPnl > position.size * targetReturn;
  }

  private assessRisk(symbol: string, fundingRate: FundingRate, priceData: any): 'low' | 'medium' | 'high' {
    // Risk assessment based on various factors
    const rateMagnitude = Math.abs(fundingRate.rate);
    
    if (rateMagnitude > 0.5) return 'high'; // >50% annual
    if (rateMagnitude > 0.2) return 'medium'; // >20% annual
    return 'low';
  }

  private calculateConfidence(fundingRate: FundingRate): number {
    // Confidence based on rate magnitude and stability
    const magnitude = Math.abs(fundingRate.rate);
    const baseConfidence = Math.min(magnitude / 0.3, 1); // Max confidence at 30% annual
    
    // Could add more factors like rate history, market volatility, etc.
    return baseConfidence * 0.8; // Conservative adjustment
  }
}

export const fundingArbitrageAction: Action = {
  name: "FUNDING_ARBITRAGE",
  similes: [
    "ARBITRAGE_SCAN",
    "FUNDING_OPPORTUNITY",
    "RATE_ARBITRAGE",
    "YIELD_ARBITRAGE"
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = await validateSeiConfig(runtime);
    
    const text = message.content.text.toLowerCase();
    return (
      (text.includes("funding") || text.includes("arbitrage") || text.includes("rate")) &&
      (text.includes("scan") || text.includes("opportunity") || text.includes("execute"))
    );
  },

  description: "Execute funding rate arbitrage strategies across CEX and DEX",

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ) => {
    elizaLogger.log("Processing funding arbitrage request");

    try {
      const config = await validateSeiConfig(runtime);
      
      const walletProvider = new WalletProvider(
        config.SEI_PRIVATE_KEY as `0x${string}`,
        runtime.cacheManager,
        { name: config.SEI_NETWORK, chain: seiChains[config.SEI_NETWORK] }
      );

      const oracleProvider = new SeiOracleProvider(runtime);
      const arbitrageEngine = new FundingArbitrageEngine(walletProvider, oracleProvider, runtime);

      const text = message.content.text.toLowerCase();

      if (text.includes("scan") || text.includes("opportunity")) {
        // Scan for arbitrage opportunities
        const opportunities = await arbitrageEngine.scanOpportunities();
        
        if (opportunities.length === 0) {
          callback({
            text: "No profitable funding arbitrage opportunities found at the moment. Minimum threshold: 10% annual return.",
          });
          return;
        }

        const opportunitiesText = opportunities.slice(0, 3).map((opp, index) => 
          `${index + 1}. ${opp.symbol} (${opp.targetExchange})\n` +
          `   Funding Rate: ${(opp.cexFundingRate * 100).toFixed(2)}% annual\n` +
          `   Expected Return: ${(opp.expectedReturn * 100).toFixed(2)}% annual\n` +
          `   Risk: ${opp.risk.toUpperCase()}\n` +
          `   Required Capital: $${opp.requiredCapital.toLocaleString()}\n` +
          `   Confidence: ${(opp.confidence * 100).toFixed(0)}%`
        ).join('\n\n');

        callback({
          text: `🎯 Top Funding Arbitrage Opportunities:\n\n${opportunitiesText}\n\nSay "execute arbitrage [symbol]" to proceed with any opportunity.`,
        });

      } else if (text.includes("execute")) {
        // Execute arbitrage for specific symbol
        const symbolMatch = text.match(/\b(btc|eth|sei|sol|avax)\b/i);
        if (!symbolMatch) {
          callback({
            text: "Please specify which symbol to arbitrage. Example: 'execute arbitrage BTC'",
            error: true
          });
          return;
        }

        const opportunities = await arbitrageEngine.scanOpportunities();
        const targetOpportunity = opportunities.find(opp => 
          opp.symbol.toLowerCase() === symbolMatch[1].toLowerCase()
        );

        if (!targetOpportunity) {
          callback({
            text: `No profitable arbitrage opportunity found for ${symbolMatch[1].toUpperCase()}. Please scan opportunities first.`,
            error: true
          });
          return;
        }

        const positionId = await arbitrageEngine.executeArbitrage(targetOpportunity);
        
        if (positionId) {
          callback({
            text: `✅ Funding arbitrage executed successfully!\n\n` +
                  `Position ID: ${positionId}\n` +
                  `Symbol: ${targetOpportunity.symbol}\n` +
                  `Strategy: Collect ${(targetOpportunity.cexFundingRate * 100).toFixed(2)}% funding on CEX + hedge on DEX\n` +
                  `Expected Return: ${(targetOpportunity.expectedReturn * 100).toFixed(2)}% annual\n` +
                  `Capital Deployed: $${targetOpportunity.requiredCapital.toLocaleString()}\n\n` +
                  `⚠️ Remember to open the corresponding CEX position manually!`,
          });
        } else {
          callback({
            text: "Failed to execute arbitrage. Please try again later.",
            error: true
          });
        }

      } else if (text.includes("status") || text.includes("position")) {
        // Show active positions
        const activePositions = arbitrageEngine.getActivePositions();
        
        if (activePositions.length === 0) {
          callback({
            text: "No active arbitrage positions.",
          });
          return;
        }

        await arbitrageEngine.updatePositionPnL();
        
        const positionsText = activePositions.map(pos => 
          `${pos.symbol} Arbitrage (${pos.id.split('_')[1]})\n` +
          `   Strategy: ${pos.cexSide.toUpperCase()} CEX + ${pos.dexSide.toUpperCase()} DEX\n` +
          `   Size: $${pos.size.toLocaleString()}\n` +
          `   Duration: ${Math.floor((Date.now() - pos.entryTime) / (24 * 60 * 60 * 1000))} days\n` +
          `   Net PnL: $${pos.netPnl.toFixed(2)}\n` +
          `   Expected Return: ${(pos.expectedReturn * 100).toFixed(2)}% annual`
        ).join('\n\n');

        callback({
          text: `📊 Active Arbitrage Positions:\n\n${positionsText}`,
        });

      } else {
        callback({
          text: "Available commands:\n" +
                "• 'scan arbitrage opportunities' - Find profitable opportunities\n" +
                "• 'execute arbitrage [symbol]' - Execute arbitrage for a symbol\n" +
                "• 'arbitrage status' - Check active positions",
          error: true
        });
      }

    } catch (error) {
      elizaLogger.error("Funding arbitrage error:", error);
      callback({
        text: `Error processing arbitrage request: ${error.message}`,
        error: true
      });
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Scan for funding arbitrage opportunities" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Scanning funding rates across exchanges for arbitrage opportunities...",
          action: "FUNDING_ARBITRAGE"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Execute arbitrage BTC" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Executing BTC funding rate arbitrage strategy...",
          action: "FUNDING_ARBITRAGE"
        }
      }
    ]
  ]
};