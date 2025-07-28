import {
  elizaLogger,
} from "@elizaos/core";
import { GeographicTradingRouter, GeographicConfig, HedgeResult, ProtectionStrategy } from './geographic-routing';
import { LiquidityPosition, HedgeStrategy } from './coinbase-advanced';

export interface ILRiskMetrics {
  volatility: number;
  priceCorrelation: number;
  timeInPosition: number; // hours
  currentIL: number; // current IL percentage
  projectedIL: number; // projected IL at current trend
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ILRiskCalculator {
  calculateRisk(position: LiquidityPosition): Promise<ILRiskMetrics>;
  estimateILAtPrice(position: LiquidityPosition, futurePrice: number): Promise<number>;
  getOptimalHedgeRatio(riskMetrics: ILRiskMetrics): number;
}

export class ImpermanentLossProtector {
  private geographicRouter: GeographicTradingRouter;
  private riskCalculator: ILRiskCalculator;

  constructor(config: GeographicConfig) {
    this.geographicRouter = new GeographicTradingRouter(config);
    this.riskCalculator = new BasicILRiskCalculator();
  }

  async protectLiquidityPosition(
    position: LiquidityPosition,
    strategy?: 'AUTO' | 'CONSERVATIVE' | 'AGGRESSIVE'
  ): Promise<ProtectionStrategy> {
    try {
      elizaLogger.log(`Analyzing IL protection for ${position.baseToken}/${position.quoteToken} position`);

      // 1. Calculate IL risk
      const ilRisk = await this.riskCalculator.calculateRisk(position);
      elizaLogger.log(`IL Risk Assessment: ${ilRisk.riskLevel}, Current IL: ${ilRisk.currentIL.toFixed(2)}%`);

      // 2. Determine best protection approach
      const protectionType = this.determineProtectionStrategy(ilRisk, strategy);
      
      // 3. Execute protection based on type
      if (protectionType === 'PERP_HEDGE') {
        return await this.executePerpsHedge(position, ilRisk);
      } else if (protectionType === 'OPTIONS_COLLAR') {
        return await this.executeOptionsStrategy(position, ilRisk);
      } else {
        return this.createRebalanceOnlyStrategy(position, ilRisk);
      }
    } catch (error) {
      elizaLogger.error('Failed to protect liquidity position:', error);
      throw error;
    }
  }

  private determineProtectionStrategy(
    ilRisk: ILRiskMetrics,
    userStrategy?: 'AUTO' | 'CONSERVATIVE' | 'AGGRESSIVE'
  ): 'PERP_HEDGE' | 'OPTIONS_COLLAR' | 'REBALANCE_ONLY' {
    
    // Force rebalance only for low risk
    if (ilRisk.riskLevel === 'LOW') {
      return 'REBALANCE_ONLY';
    }

    // User preference override
    if (userStrategy === 'CONSERVATIVE') {
      return 'REBALANCE_ONLY';
    } else if (userStrategy === 'AGGRESSIVE') {
      return 'PERP_HEDGE';
    }

    // Auto strategy based on risk level
    switch (ilRisk.riskLevel) {
      case 'MEDIUM':
        return ilRisk.volatility > 0.5 ? 'PERP_HEDGE' : 'REBALANCE_ONLY';
      case 'HIGH':
      case 'CRITICAL':
        return 'PERP_HEDGE';
      default:
        return 'REBALANCE_ONLY';
    }
  }

  private async executePerpsHedge(
    position: LiquidityPosition,
    ilRisk: ILRiskMetrics
  ): Promise<ProtectionStrategy> {
    try {
      elizaLogger.log('Executing perpetual hedge strategy');

      // Calculate optimal hedge ratio based on risk
      const hedgeRatio = this.riskCalculator.getOptimalHedgeRatio(ilRisk);
      
      const hedgeResult = await this.geographicRouter.executeGeographicHedge(position);

      if (hedgeResult.success) {
        return {
          type: 'PERP_HEDGE',
          provider: hedgeResult.provider,
          hedgeRatio: hedgeResult.hedgeRatio,
          expectedILReduction: hedgeResult.expectedILReduction,
          txHash: hedgeResult.txHash,
          cost: this.estimateHedgeCost(position, hedgeRatio),
          reason: `Risk level: ${ilRisk.riskLevel}, Projected IL: ${ilRisk.projectedIL.toFixed(2)}%`,
        };
      } else {
        // Fallback to rebalance if hedge fails
        elizaLogger.log('Hedge failed, falling back to rebalance strategy');
        return this.createRebalanceOnlyStrategy(position, ilRisk);
      }
    } catch (error) {
      elizaLogger.error('Perps hedge execution failed:', error);
      return this.createRebalanceOnlyStrategy(position, ilRisk);
    }
  }

  private async executeOptionsStrategy(
    position: LiquidityPosition,
    ilRisk: ILRiskMetrics
  ): Promise<ProtectionStrategy> {
    // Options strategy not implemented yet - this would integrate with
    // options protocols like Lyra, Dopex, etc.
    elizaLogger.log('Options strategy not yet implemented, using perps hedge');
    return await this.executePerpsHedge(position, ilRisk);
  }

  private createRebalanceOnlyStrategy(
    position: LiquidityPosition,
    ilRisk: ILRiskMetrics
  ): ProtectionStrategy {
    return {
      type: 'REBALANCE_ONLY',
      provider: 'Internal',
      hedgeRatio: 0,
      expectedILReduction: '15%', // From periodic rebalancing
      reason: `Low risk (${ilRisk.riskLevel}), rebalancing sufficient`,
      cost: '0.1%', // Gas costs for rebalancing
    };
  }

  private estimateHedgeCost(position: LiquidityPosition, hedgeRatio: number): string {
    // Estimate costs: trading fees + funding costs
    const tradingFees = position.value * hedgeRatio * 0.001; // 0.1% trading fee
    const fundingCosts = position.value * hedgeRatio * 0.0001 * 24; // Daily funding estimate
    return `$${(tradingFees + fundingCosts).toFixed(2)}`;
  }

  async getILAnalysis(position: LiquidityPosition): Promise<ILRiskMetrics> {
    return await this.riskCalculator.calculateRisk(position);
  }

  async simulateILScenarios(
    position: LiquidityPosition,
    priceChanges: number[]
  ): Promise<Array<{ priceChange: number; il: number; hedgedIL: number }>> {
    const scenarios: Array<{ priceChange: number; il: number; hedgedIL: number }> = [];
    
    for (const priceChange of priceChanges) {
      const futurePrice = parseFloat(position.baseAmount) * (1 + priceChange);
      const il = await this.riskCalculator.estimateILAtPrice(position, futurePrice);
      
      // Estimate hedged IL (reduced by typical hedge effectiveness)
      const hedgedIL = il * 0.2; // 80% IL reduction from hedging
      
      scenarios.push({
        priceChange: priceChange * 100, // Convert to percentage
        il: il * 100,
        hedgedIL: hedgedIL * 100,
      });
    }
    
    return scenarios;
  }
}

export class BasicILRiskCalculator implements ILRiskCalculator {
  async calculateRisk(position: LiquidityPosition): Promise<ILRiskMetrics> {
    try {
      // Simplified risk calculation
      // In production, this would use real price data and complex volatility models
      
      const volatility = await this.estimateVolatility(position.baseToken);
      const correlation = await this.estimateCorrelation(position.baseToken, position.quoteToken);
      const timeInPosition = 24; // Assume 24 hours for demo
      
      const currentIL = this.calculateCurrentIL(position, volatility);
      const projectedIL = this.projectFutureIL(currentIL, volatility, timeInPosition);
      
      const riskLevel = this.assessRiskLevel(projectedIL, volatility);

      return {
        volatility,
        priceCorrelation: correlation,
        timeInPosition,
        currentIL,
        projectedIL,
        riskLevel,
      };
    } catch (error) {
      elizaLogger.error('Risk calculation failed:', error);
      // Return default medium risk
      return {
        volatility: 0.5,
        priceCorrelation: 0.3,
        timeInPosition: 24,
        currentIL: 5,
        projectedIL: 10,
        riskLevel: 'MEDIUM',
      };
    }
  }

  async estimateILAtPrice(position: LiquidityPosition, futurePrice: number): Promise<number> {
    // Simplified IL calculation: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
    const currentPrice = parseFloat(position.baseAmount);
    const priceRatio = futurePrice / currentPrice;
    
    const il = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
    return Math.abs(il); // Return absolute IL
  }

  getOptimalHedgeRatio(riskMetrics: ILRiskMetrics): number {
    // Base hedge ratio on risk level and volatility
    let baseRatio = 0.3; // 30% base
    
    switch (riskMetrics.riskLevel) {
      case 'LOW':
        baseRatio = 0.1;
        break;
      case 'MEDIUM':
        baseRatio = 0.4;
        break;
      case 'HIGH':
        baseRatio = 0.6;
        break;
      case 'CRITICAL':
        baseRatio = 0.8;
        break;
    }

    // Adjust for volatility
    const volatilityAdjustment = Math.min(riskMetrics.volatility * 0.3, 0.2);
    
    return Math.min(baseRatio + volatilityAdjustment, 0.9); // Cap at 90%
  }

  private async estimateVolatility(token: string): Promise<number> {
    // Simplified volatility estimation
    // In production, this would use historical price data
    const volatilityMap: { [key: string]: number } = {
      'BTC': 0.6,
      'ETH': 0.7,
      'SEI': 1.2,
      'USDC': 0.05,
      'USDT': 0.05,
    };
    
    return volatilityMap[token] || 0.8; // Default to high volatility
  }

  private async estimateCorrelation(token1: string, token2: string): Promise<number> {
    // Simplified correlation estimation
    if (token1 === token2) return 1.0;
    if ((token1 === 'USDC' || token1 === 'USDT') || (token2 === 'USDC' || token2 === 'USDT')) {
      return 0.1; // Low correlation with stablecoins
    }
    if ((token1 === 'BTC' || token1 === 'ETH') && (token2 === 'BTC' || token2 === 'ETH')) {
      return 0.7; // High correlation between major cryptos
    }
    return 0.4; // Medium correlation for other pairs
  }

  private calculateCurrentIL(position: LiquidityPosition, volatility: number): number {
    // Simplified current IL based on volatility and time
    return volatility * 10; // Rough approximation
  }

  private projectFutureIL(currentIL: number, volatility: number, timeHours: number): number {
    // Project IL growth based on volatility and time
    const timeAdjustment = Math.sqrt(timeHours / 24); // Scale by sqrt of time
    return currentIL * (1 + volatility * timeAdjustment);
  }

  private assessRiskLevel(projectedIL: number, volatility: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (projectedIL < 5 && volatility < 0.3) return 'LOW';
    if (projectedIL < 10 && volatility < 0.6) return 'MEDIUM';
    if (projectedIL < 20 && volatility < 1.0) return 'HIGH';
    return 'CRITICAL';
  }
}
