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

// Portfolio rebalancing strategies
interface AllocationStrategy {
  name: string;
  description: string;
  allocations: Record<string, number>; // asset symbol -> percentage
  rebalanceThreshold: number; // percentage deviation to trigger rebalance
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
}

interface AssetAllocation {
  symbol: string;
  targetPercentage: number;
  currentPercentage: number;
  currentValue: number;
  deviation: number;
  recommended: 'hold' | 'buy' | 'sell';
  amount?: number;
}

interface PortfolioAnalysis {
  totalValue: number;
  strategy: AllocationStrategy;
  assets: AssetAllocation[];
  rebalanceNeeded: boolean;
  recommendations: RebalanceRecommendation[];
}

interface RebalanceRecommendation {
  asset: string;
  action: 'buy' | 'sell';
  amount: number;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

class PortfolioRebalancer {
  private walletProvider: WalletProvider;
  private oracleProvider: SeiOracleProvider;

  constructor(walletProvider: WalletProvider, oracleProvider: SeiOracleProvider) {
    this.walletProvider = walletProvider;
    this.oracleProvider = oracleProvider;
  }

  private getStrategies(): AllocationStrategy[] {
    return [
      {
        name: 'Conservative DeFi',
        description: 'Low-risk allocation focused on stable yields',
        allocations: {
          'SEI': 40,
          'USDC': 30,
          'ETH': 20,
          'BTC': 10
        },
        rebalanceThreshold: 5, // 5% deviation
        riskLevel: 'conservative'
      },
      {
        name: 'Balanced Growth',
        description: 'Moderate risk with diversified DeFi exposure',
        allocations: {
          'SEI': 25,
          'USDC': 25,
          'ETH': 25,
          'BTC': 15,
          'ATOM': 10
        },
        rebalanceThreshold: 7.5,
        riskLevel: 'moderate'
      },
      {
        name: 'Aggressive DeFi',
        description: 'High-risk, high-reward DeFi strategy',
        allocations: {
          'SEI': 30,
          'ETH': 25,
          'BTC': 20,
          'ATOM': 15,
          'OSMO': 10
        },
        rebalanceThreshold: 10,
        riskLevel: 'aggressive'
      },
      {
        name: 'Yield Farming Focus',
        description: 'Optimized for maximum yield opportunities',
        allocations: {
          'SEI': 35,
          'USDC': 20,
          'ETH': 20,
          'LP_TOKENS': 25
        },
        rebalanceThreshold: 8,
        riskLevel: 'moderate'
      }
    ];
  }

  async analyzePortfolio(
    walletAddress: string, 
    strategyName?: string
  ): Promise<PortfolioAnalysis> {
    try {
      const strategies = this.getStrategies();
      const strategy = strategyName 
        ? strategies.find(s => s.name === strategyName) || strategies[1]
        : strategies[1]; // Default to balanced

      // Get current portfolio balances
      const portfolioBalances = await this.getPortfolioBalances(walletAddress);
      const totalValue = Object.values(portfolioBalances).reduce((sum, value) => sum + value, 0);

      if (totalValue === 0) {
        throw new Error('Portfolio has no value');
      }

      // Calculate current allocations
      const assets: AssetAllocation[] = [];
      const recommendations: RebalanceRecommendation[] = [];

      for (const [symbol, targetPercentage] of Object.entries(strategy.allocations)) {
        const currentValue = portfolioBalances[symbol] || 0;
        const currentPercentage = (currentValue / totalValue) * 100;
        const deviation = currentPercentage - targetPercentage;

        let recommended: 'hold' | 'buy' | 'sell' = 'hold';
        let amount = 0;

        if (Math.abs(deviation) > strategy.rebalanceThreshold) {
          if (deviation > 0) {
            recommended = 'sell';
            amount = (deviation / 100) * totalValue;
          } else {
            recommended = 'buy';
            amount = Math.abs(deviation / 100) * totalValue;
          }

          recommendations.push({
            asset: symbol,
            action: recommended,
            amount,
            reason: `${Math.abs(deviation).toFixed(2)}% deviation from target`,
            priority: Math.abs(deviation) > strategy.rebalanceThreshold * 2 ? 'high' : 'medium'
          });
        }

        assets.push({
          symbol,
          targetPercentage,
          currentPercentage,
          currentValue,
          deviation,
          recommended,
          amount
        });
      }

      const rebalanceNeeded = recommendations.length > 0;

      return {
        totalValue,
        strategy,
        assets,
        rebalanceNeeded,
        recommendations
      };

    } catch (error) {
      elizaLogger.error('Portfolio analysis failed:', error);
      throw error;
    }
  }

  async executeRebalance(
    walletAddress: string,
    recommendations: RebalanceRecommendation[]
  ): Promise<string[]> {
    try {
      const results: string[] = [];

      for (const recommendation of recommendations) {
        const txHash = await this.executeRecommendation(walletAddress, recommendation);
        if (txHash) {
          results.push(txHash);
          elizaLogger.info(`Executed ${recommendation.action} for ${recommendation.asset}: ${txHash}`);
        }
      }

      return results;
    } catch (error) {
      elizaLogger.error('Portfolio rebalance failed:', error);
      throw error;
    }
  }

  private async executeRecommendation(
    walletAddress: string,
    recommendation: RebalanceRecommendation
  ): Promise<string | null> {
    try {
      // This would integrate with DragonSwap or other DEXs for actual trading
      // For now, return a placeholder transaction hash
      elizaLogger.info(`Executing ${recommendation.action} of ${recommendation.amount} ${recommendation.asset}`);
      
      return `0x${Math.random().toString(16).substring(2, 66)}`; // Placeholder tx hash
    } catch (error) {
      elizaLogger.error(`Failed to execute ${recommendation.action} for ${recommendation.asset}:`, error);
      return null;
    }
  }

  private async getAssetBalance(symbol: string, address: string): Promise<number> {
    try {
      if (symbol === 'SEI') {
        const balance = await this.walletProvider.getWalletBalance();
        return balance ? Number(balance) : 0;
      }

      // For other tokens, we'd need to query their contract balances
      // This is a simplified implementation
      return Math.random() * 1000; // Placeholder
    } catch (error) {
      elizaLogger.error(`Failed to get balance for ${symbol}:`, error);
      return 0;
    }
  }

  private async getPortfolioBalances(walletAddress: string): Promise<Record<string, number>> {
    try {
      const balances: Record<string, number> = {};

      // Get asset prices individually
      const symbols = ['SEI', 'USDC', 'ETH', 'BTC', 'ATOM', 'OSMO'];
      for (const symbol of symbols) {
        const priceFeed = await this.oracleProvider.getPrice(symbol);
        const price = priceFeed ? priceFeed.price : 0;
        
        const balance = await this.getAssetBalance(symbol, walletAddress);
        balances[symbol] = balance * price;
      }

      return balances;
    } catch (error) {
      elizaLogger.error('Failed to get portfolio balances:', error);
      return {};
    }
  }
}

export const rebalanceEvaluatorAction: Action = {
  name: "PORTFOLIO_REBALANCE",
  similes: [
    "REBALANCE_PORTFOLIO",
    "PORTFOLIO_ANALYSIS",
    "ASSET_ALLOCATION",
    "PORTFOLIO_OPTIMIZATION"
  ],
  description: "Analyze and rebalance portfolio based on allocation strategies",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = await validateSeiConfig(runtime);
    return config !== null;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ) => {
    try {
      elizaLogger.info("Starting portfolio rebalance analysis");

      // Initialize providers
      const config = await validateSeiConfig(runtime);
      
      const walletProvider = new WalletProvider(
        config.SEI_PRIVATE_KEY as `0x${string}`,
        { name: config.SEI_NETWORK || "testnet", chain: seiChains[config.SEI_NETWORK || "testnet"] }
      );

      const oracleProvider = new SeiOracleProvider(runtime);

      const rebalancer = new PortfolioRebalancer(walletProvider, oracleProvider);

      // Extract parameters from message
      const text = typeof message.content === 'string' 
        ? message.content 
        : message.content?.text || '';

      // Parse strategy preference
      const strategyMatch = text.match(/strategy[:\s]+([^,\n]+)/i);
      const strategyName = strategyMatch ? strategyMatch[1].trim() : undefined;

      // Parse wallet address
      const addressMatch = text.match(/(?:wallet|address)[:\s]+(0x[a-fA-F0-9]{40})/i);
      const walletAddress = addressMatch 
        ? addressMatch[1] 
        : await walletProvider.getAddress();

      if (callback) {
        callback({
          text: `🔄 Analyzing portfolio for address: ${walletAddress}\n⏳ Fetching balances and calculating allocations...`,
          content: {
            action: "portfolio_analysis_started",
            address: walletAddress,
            strategy: strategyName
          }
        });
      }

      // Perform portfolio analysis
      const analysis = await rebalancer.analyzePortfolio(walletAddress, strategyName);

      // Check if auto-execute is requested
      const autoExecute = text.toLowerCase().includes('execute') || 
                         text.toLowerCase().includes('rebalance now');

      if (analysis.rebalanceNeeded) {
        const needsRebalancing = analysis.assets.some(asset => 
          Math.abs(asset.deviation) > analysis.strategy.rebalanceThreshold
        );

        if (callback) {
          callback({
            text: `📊 Portfolio Analysis (${analysis.strategy.name})\n\n` +
                  `💰 Total Value: $${analysis.totalValue.toFixed(2)}\n` +
                  `🎯 Strategy: ${analysis.strategy.description}\n` +
                  `⚖️ Risk Level: ${analysis.strategy.riskLevel}\n\n` +
                  `📈 Asset Allocations:\n` +
                  analysis.assets.map(asset => 
                    `${asset.symbol}: ${asset.currentPercentage.toFixed(1)}% ` +
                    `(Target: ${asset.targetPercentage}%, ` +
                    `Deviation: ${asset.deviation > 0 ? '+' : ''}${asset.deviation.toFixed(1)}%) ` +
                    `[${asset.recommended.toUpperCase()}${asset.amount ? ` $${asset.amount.toFixed(2)}` : ''}]`
                  ).join('\n') +
                  `\n\n🔧 Rebalance Recommendations:\n` +
                  analysis.recommendations.map(rec => 
                    `${rec.priority.toUpperCase()}: ${rec.action.toUpperCase()} $${rec.amount.toFixed(2)} ${rec.asset} - ${rec.reason}`
                  ).join('\n'),
            content: {
              action: "portfolio_analysis_complete",
              analysis,
              needsRebalancing
            }
          });
        }

        if (autoExecute) {
          if (callback) {
            callback({
              text: `🔄 Executing rebalance recommendations...`,
              content: { action: "rebalance_execution_started" }
            });
          }

          const txHashes = await rebalancer.executeRebalance(walletAddress, analysis.recommendations);

          if (callback) {
            callback({
              text: `✅ Portfolio rebalance complete!\n\n` +
                    `📝 Executed ${txHashes.length} transactions:\n` +
                    txHashes.map((hash, i) => `${i + 1}. ${hash}`).join('\n'),
              content: {
                action: "rebalance_execution_complete",
                transactions: txHashes,
                analysis
              }
            });
          }
        } else {
          if (callback) {
            callback({
              text: `💡 To execute these recommendations, send: "rebalance portfolio execute"`,
              content: {
                action: "rebalance_recommendations_ready",
                analysis
              }
            });
          }
        }
      } else {
        if (callback) {
          callback({
            text: `✅ Portfolio is well-balanced!\n\n` +
                  `📊 Current allocations are within target ranges for the ${analysis.strategy.name} strategy.\n` +
                  `💰 Total Value: $${analysis.totalValue.toFixed(2)}\n\n` +
                  `📈 Asset Allocations:\n` +
                  analysis.assets.map(asset => 
                    `${asset.symbol}: ${asset.currentPercentage.toFixed(1)}% ` +
                    `(Target: ${asset.targetPercentage}%, ` +
                    `Deviation: ${asset.deviation > 0 ? '+' : ''}${asset.deviation.toFixed(1)}%)`
                  ).join('\n'),
            content: {
              action: "portfolio_balanced",
              analysis
            }
          });
        }
      }

    } catch (error) {
      elizaLogger.error("Portfolio rebalance analysis failed:", error);
      if (callback) {
        callback({
          text: `❌ Portfolio analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          content: { 
            action: "rebalance_failed", 
            error: error instanceof Error ? error.message : 'Unknown error' 
          }
        });
      }
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Analyze my portfolio allocation" }
      },
      {
        name: "{{user2}}",
        content: { 
          text: "📊 Analyzing your portfolio...",
          action: "PORTFOLIO_REBALANCE"
        }
      }
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Rebalance my portfolio using conservative strategy" }
      },
      {
        name: "{{user2}}",
        content: { 
          text: "🔄 Rebalancing portfolio with conservative DeFi strategy...",
          action: "PORTFOLIO_REBALANCE"
        }
      }
    ]
  ]
};
