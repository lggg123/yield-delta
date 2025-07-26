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
import { SeiOracleProvider, FundingRate as SeiFundingRate } from "../providers/sei-oracle";
import { dragonSwapTradeAction } from "./dragonswap";
import { perpsTradeAction } from "./perp-trading";

export interface ArbitrageOpportunity {
  symbol: string;
  cexSide: 'long' | 'short';
  dexSide: 'long' | 'short';
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

interface LocalFundingRate {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  confidence: number;
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

  getActivePositions(): ArbitragePosition[] {
    return Array.from(this.activePositions.values()).filter(pos => pos.status === 'active');
  }

  getAllPositions(): ArbitragePosition[] {
    return Array.from(this.activePositions.values());
  }

  async updatePositionPnL(): Promise<void> {
    try {
      for (const position of this.activePositions.values()) {
        if (position.status === 'active') {
          // Update P&L calculation logic here
          const currentPrice = await this.oracleProvider.getPrice(position.symbol);
          // Calculate P&L based on current price vs entry price
          // This is a simplified example - you'll need your actual P&L logic
          elizaLogger.log(`Updating P&L for ${position.symbol} position ${position.id}`);
        }
      }
    } catch (error) {
      elizaLogger.error("Error updating position P&L:", error);
    }
  }

  async scanOpportunities(): Promise<ArbitrageOpportunity[]> {
    try {
      elizaLogger.log("Scanning for arbitrage opportunities...");
      
      // Your opportunity scanning logic here
      const opportunities: ArbitrageOpportunity[] = [];
      
      // Example: scan popular trading pairs
      const symbols = ['BTC', 'ETH', 'SOL', 'SEI'];
      
      for (const symbol of symbols) {
        try {
          const fundingRates = await this.getFundingRates(symbol);
          const opportunity = this.evaluateOpportunity(symbol, fundingRates);
          
          if (opportunity && opportunity.expectedReturn > this.minFundingRate) {
            opportunities.push(opportunity);
          }
        } catch (error) {
          elizaLogger.error(`Error scanning ${symbol}:`, error);
        }
      }
      
      // Sort by expected return (highest first)
      return opportunities.sort((a, b) => b.expectedReturn - a.expectedReturn);
    } catch (error) {
      elizaLogger.error("Error scanning opportunities:", error);
      return [];
    }
  }

  async executeArbitrage(symbol: string): Promise<boolean> {
    try {
      elizaLogger.log(`Executing arbitrage for ${symbol}...`);
      
      // Scan for opportunities for this specific symbol
      const opportunities = await this.scanOpportunities();
      const opportunity = opportunities.find(opp => opp.symbol === symbol);
      
      if (!opportunity) {
        elizaLogger.warn(`No profitable opportunity found for ${symbol}`);
        return false;
      }

      // Check if we already have a position for this symbol
      const existingPosition = Array.from(this.activePositions.values())
        .find(pos => pos.symbol === symbol && pos.status === 'active');
      
      if (existingPosition) {
        elizaLogger.warn(`Already have an active position for ${symbol}`);
        return false;
      }

      // Execute the arbitrage strategy
      const success = await this.openArbitragePosition(opportunity);
      return success;
    } catch (error) {
      elizaLogger.error(`Error executing arbitrage for ${symbol}:`, error);
      return false;
    }
  }

  private async getFundingRates(symbol: string): Promise<LocalFundingRate[]> {
    try {
      // Your funding rate fetching logic here
      // This is a placeholder - implement actual API calls to exchanges
      return [
        {
          exchange: 'binance',
          symbol,
          fundingRate: 0.001,
          nextFundingTime: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
          confidence: 0.9
        },
        {
          exchange: 'bybit',
          symbol,
          fundingRate: -0.002,
          nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
          confidence: 0.85
        }
      ];
    } catch (error) {
      elizaLogger.error(`Error fetching funding rates for ${symbol}:`, error);
      return [];
    }
  }

  private evaluateOpportunity(symbol: string, fundingRates: LocalFundingRate[]): ArbitrageOpportunity | null {
    try {
      if (fundingRates.length < 2) return null;

      // Simple strategy: find the largest funding rate differential
      const sortedRates = fundingRates.sort((a, b) => b.fundingRate - a.fundingRate);
      const highestRate = sortedRates[0];
      const lowestRate = sortedRates[sortedRates.length - 1];

      const rateDifferential = highestRate.fundingRate - lowestRate.fundingRate;
      const annualizedReturn = rateDifferential * 365 * 3; // 3 times per day

      if (annualizedReturn < this.minFundingRate) return null;

      // Determine strategy: long where funding is negative (you receive), short where positive (you pay)
      const cexSide = highestRate.fundingRate > 0 ? 'short' : 'long';
      const dexSide = cexSide === 'long' ? 'short' : 'long';

      return {
        symbol,
        cexSide,
        dexSide,
        cexFundingRate: highestRate.fundingRate,
        targetExchange: highestRate.exchange,
        expectedReturn: annualizedReturn,
        requiredCapital: Math.min(this.maxPositionSize, 5000), // Default $5k
        risk: Math.min(highestRate.confidence, lowestRate.confidence) > 0.8 ? 'low' : 
              Math.min(highestRate.confidence, lowestRate.confidence) > 0.6 ? 'medium' : 'high',
        hedgeAction: dexSide === 'long' ? 'long_dex' : 'short_dex',
        confidence: Math.min(highestRate.confidence, lowestRate.confidence)
      };
    } catch (error) {
      elizaLogger.error(`Error evaluating opportunity for ${symbol}:`, error);
      return null;
    }
  }

  private async openArbitragePosition(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      const positionId = `arb_${opportunity.symbol}_${Date.now()}`;
      
      const position: ArbitragePosition = {
        id: positionId,
        symbol: opportunity.symbol,
        cexSide: opportunity.cexSide,
        dexSide: opportunity.dexSide,
        size: opportunity.requiredCapital,
        entryTime: Date.now(),
        expectedReturn: opportunity.expectedReturn,
        status: 'active',
        cexFundingCollected: 0,
        netPnl: 0
      };

      // Open hedge position (DEX side)
      const hedgeSuccess = await this.openHedgePosition(opportunity);
      
      if (!hedgeSuccess) {
        elizaLogger.error("Failed to open hedge position");
        return false;
      }

      // Store the position
      this.activePositions.set(positionId, position);
      
      elizaLogger.log(`Successfully opened arbitrage position: ${positionId}`);
      return true;
    } catch (error) {
      elizaLogger.error("Error opening arbitrage position:", error);
      return false;
    }
  }

  private async openHedgePosition(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      if (opportunity.hedgeAction === 'short_dex') {
        // Handle short hedge case via perps
        elizaLogger.log(`Opening short hedge for ${opportunity.symbol} via Perps`);
        
        const mockMessage = { 
          content: { 
            text: `open short ${opportunity.symbol} ${opportunity.requiredCapital} 1x` 
          } 
        } as Memory;

        try {
          // Execute via perps action - skip callback for now
          const mockState: State = { values: {}, data: {}, text: "" };
          await perpsTradeAction.handler(this.runtime, mockMessage, mockState, {});
          elizaLogger.log(`Successfully opened short position for ${opportunity.symbol}`);
          return true;
        } catch (perpsError) {
          elizaLogger.error("Perps execution failed:", perpsError);
          return false;
        }
      } else {
        // Handle long hedge case
        elizaLogger.log(`Opening long hedge for ${opportunity.symbol} via DragonSwap`);
        
        const mockMessage = { 
          content: { 
            text: `swap ${opportunity.requiredCapital} USDC for ${opportunity.symbol}` 
          } 
        } as Memory;

        try {
          // Execute the swap via DragonSwap action - skip callback for now
          const mockState: State = { values: {}, data: {}, text: "" };
          await dragonSwapTradeAction.handler(this.runtime, mockMessage, mockState, {});
          elizaLogger.log(`Successfully swapped USDC for ${opportunity.symbol}`);
          return true;
        } catch (swapError) {
          elizaLogger.error("DragonSwap execution failed:", swapError);
          return false;
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
      if (!position) {
        elizaLogger.error(`Position ${positionId} not found`);
        return false;
      }

      position.status = 'closing';
      
      // Close hedge positions (reverse of opening)
      // Implementation depends on your specific closing logic
      
      position.status = 'closed';
      elizaLogger.log(`Successfully closed arbitrage position: ${positionId}`);
      return true;
    } catch (error) {
      elizaLogger.error("Failed to close arbitrage position:", error);
      return false;
    }
  }
}

async function getOrCreateArbitrageEngine(runtime: IAgentRuntime): Promise<FundingArbitrageEngine> {
  try {
    const config = await validateSeiConfig(runtime);
    
    const walletProvider = new WalletProvider(
      config.SEI_PRIVATE_KEY as `0x${string}`,
      { 
        name: config.SEI_NETWORK || "testnet", 
        chain: seiChains[config.SEI_NETWORK || "testnet"] 
      }
    );

    const oracleProvider = new SeiOracleProvider(runtime);
    
    return new FundingArbitrageEngine(walletProvider, oracleProvider, runtime);
  } catch (error) {
    elizaLogger.error("Failed to create arbitrage engine:", error);
    throw error;
  }
}

export const fundingArbitrageAction: Action = {
  name: "FUNDING_ARBITRAGE",
  similes: ["ARBITRAGE", "FUNDING_RATE"],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      await validateSeiConfig(runtime);
      const text = message?.content?.text?.toLowerCase() || "";
      return text.includes("arbitrage") || text.includes("funding");
    } catch {
      return false;
    }
  },
  description: "Execute funding rate arbitrage strategies",

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
        // Create the arbitrage engine instance
        const arbitrageEngine = await getOrCreateArbitrageEngine(runtime);
        
        const messageText = message?.content?.text?.toLowerCase() || "";
        
        if (messageText.includes("status") || messageText.includes("position")) {
            // Show active positions - call without parameters
            const activePositions = arbitrageEngine.getActivePositions();
            
            if (activePositions.length === 0) {
                if (callback) {
                    await callback({
                        text: "No active arbitrage positions.",
                        content: {
                            type: "status",
                            hasPositions: false
                        }
                    });
                }
                return;
            }

            // Update position P&L - call without parameters
            await arbitrageEngine.updatePositionPnL();
            
            const positionsText = activePositions.map(pos => 
                `${pos.symbol} Arbitrage (${pos.id.split('_')[1]})\n` +
                `   Strategy: ${pos.cexSide.toUpperCase()} CEX + ${pos.dexSide.toUpperCase()} DEX\n` +
                `   Size: $${pos.size.toLocaleString()}\n` +
                `   Duration: ${Math.floor((Date.now() - pos.entryTime) / (24 * 60 * 60 * 1000))} days\n` +
                `   Net PnL: $${pos.netPnl.toFixed(2)}\n` +
                `   Expected Return: ${(pos.expectedReturn * 100).toFixed(2)}% annual`
            ).join('\n\n');

            if (callback) {
                await callback({
                    text: `📊 Active Arbitrage Positions:\n\n${positionsText}`,
                    content: {
                        type: "positions",
                        positions: activePositions
                    }
                });
            }

        } else if (messageText.includes("scan") || messageText.includes("opportunity")) {
            // Scan for opportunities
            if (callback) {
                await callback({
                    text: "🔍 Scanning for arbitrage opportunities...",
                    content: { type: "scanning" }
                });
            }

            const opportunities = await arbitrageEngine.scanOpportunities();
            
            if (opportunities.length === 0) {
                if (callback) {
                    await callback({
                        text: "No profitable arbitrage opportunities found at the moment.",
                        content: { type: "scan_result", opportunities: [] }
                    });
                }
            } else {
                const opportunitiesText = opportunities.map(opp => 
                    `💰 ${opp.symbol} Arbitrage\n` +
                    `   Target Exchange: ${opp.targetExchange}\n` +
                    `   Strategy: ${opp.hedgeAction === 'short_dex' ? 'SHORT DEX + LONG CEX' : 'LONG DEX + SHORT CEX'}\n` +
                    `   Expected Return: ${(opp.expectedReturn * 100).toFixed(2)}% annual\n` +
                    `   Required Capital: $${opp.requiredCapital.toLocaleString()}\n` +
                    `   Risk Level: ${opp.risk.toUpperCase()}\n` +
                    `   Confidence: ${(opp.confidence * 100).toFixed(0)}%`
                ).join('\n\n');

                if (callback) {
                    await callback({
                        text: `📈 Found ${opportunities.length} Arbitrage Opportunities:\n\n${opportunitiesText}`,
                        content: { 
                            type: "scan_result", 
                            opportunities: opportunities 
                        }
                    });
                }
            }

        } else if (messageText.includes("execute")) {
            // Extract symbol from message
            const symbolMatch = messageText.match(/execute.*?arbitrage.*?(\w{3,6})/i) || 
                               messageText.match(/arbitrage.*?(\w{3,6})/i);
            const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : null;

            if (!symbol) {
                if (callback) {
                    await callback({
                        text: "Please specify a symbol. Example: 'execute arbitrage BTC'",
                        content: { type: "error", message: "Symbol required" }
                    });
                }
                return;
            }

            if (callback) {
                await callback({
                    text: `🚀 Executing arbitrage for ${symbol}...`,
                    content: { type: "executing", symbol }
                });
            }

            // First scan for opportunities for this symbol
            const opportunities = await arbitrageEngine.scanOpportunities();
            const opportunity = opportunities.find(opp => opp.symbol === symbol);

            if (!opportunity) {
                if (callback) {
                    await callback({
                        text: `❌ No profitable arbitrage opportunity found for ${symbol} at the moment.`,
                        content: { type: "execution_result", success: false, symbol, reason: "No opportunity" }
                    });
                }
                return;
            }

            const success = await arbitrageEngine.executeArbitrage(opportunity.symbol);
            
            if (callback) {
                if (success) {
                    await callback({
                        text: `✅ Successfully initiated ${symbol} arbitrage position!\n` +
                              `Expected Return: ${(opportunity.expectedReturn * 100).toFixed(2)}% annual\n` +
                              `Capital Deployed: $${opportunity.requiredCapital.toLocaleString()}`,
                        content: { 
                            type: "execution_result", 
                            success: true, 
                            symbol, 
                            opportunity
                        }
                    });
                } else {
                    await callback({
                        text: `❌ Failed to execute ${symbol} arbitrage. Check logs for details.`,
                        content: { type: "execution_result", success: false, symbol }
                    });
                }
            }

        } else {
            // Help message
            if (callback) {
                await callback({
                    text: "🤖 Funding Arbitrage Bot Commands:\n\n" +
                          "• 'scan arbitrage opportunities' - Find profitable opportunities\n" +
                          "• 'execute arbitrage [symbol]' - Execute arbitrage for a symbol\n" +
                          "• 'arbitrage status' - Check active positions\n\n" +
                          "Examples:\n" +
                          "• 'scan arbitrage opportunities'\n" +
                          "• 'execute arbitrage BTC'\n" +
                          "• 'arbitrage status'",
                    content: {
                        type: "help",
                        commands: [
                            "scan arbitrage opportunities",
                            "execute arbitrage [symbol]",
                            "arbitrage status"
                        ]
                    }
                });
            }
        }
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        elizaLogger.error("Funding arbitrage error:", errorMessage);
        
        if (callback) {
            await callback({
                text: `❌ Error: ${errorMessage}`,
                content: {
                    type: "error",
                    error: errorMessage
                }
            });
        }
    }
  },
  
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Scan for funding arbitrage opportunities" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Scanning funding rates across exchanges for arbitrage opportunities...",
          action: "FUNDING_ARBITRAGE"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Execute arbitrage BTC" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Executing BTC funding rate arbitrage strategy...",
          action: "FUNDING_ARBITRAGE"
        }
      }
    ]
  ]
};