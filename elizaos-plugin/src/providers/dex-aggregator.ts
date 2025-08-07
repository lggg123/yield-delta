import { DragonSwapProvider } from './dragonswap-api';
import { SymphonyDexProvider } from './symphony-dex';

interface DexQuote {
  exchange: 'dragonswap' | 'symphony';
  amountIn: string;
  amountOut: string;
  priceImpact: string;
  gasEstimate: string;
  route: any[];
}

interface BestQuoteResult {
  bestQuote: DexQuote;
  allQuotes: DexQuote[];
  savings: string; // Percentage better than worst quote
}

export class DexAggregator {
  private dragonSwap: DragonSwapProvider;
  private symphony: SymphonyDexProvider;

  constructor(config: { network: string; rpcUrl: string; apiUrl?: string }) {
    this.dragonSwap = new DragonSwapProvider(config.apiUrl || 'https://api-testnet.dragonswap.app/v1');
    this.symphony = new SymphonyDexProvider({
      network: config.network,
      rpcUrl: config.rpcUrl
    });
  }

  /**
   * Get quotes from all available DEXes and return the best one
   */
  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<BestQuoteResult> {
    const quotes: DexQuote[] = [];
    const errors: string[] = [];

    // Get DragonSwap quote
    try {
      const dragonQuote = await this.dragonSwap.getQuote(tokenIn, tokenOut, amountIn);
      if (dragonQuote && dragonQuote.amountOut) {
        quotes.push({
          exchange: 'dragonswap',
          amountIn,
          amountOut: dragonQuote.amountOut,
          priceImpact: (dragonQuote.priceImpact || 0).toString(),
          gasEstimate: dragonQuote.gasEstimate || "200000",
          route: dragonQuote.route || []
        });
      } else {
        errors.push('DragonSwap: Invalid quote response');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`DragonSwap: ${errorMessage}`);
    }

    // Get Symphony quote
    try {
      const symphonyQuote = await this.symphony.getQuote(tokenIn, tokenOut, amountIn);
      if (symphonyQuote && symphonyQuote.amountOut) {
        quotes.push(symphonyQuote);
      } else {
        errors.push('Symphony: Invalid quote response');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Symphony: ${errorMessage}`);
    }

    if (quotes.length === 0) {
      throw new Error(`All DEX quotes failed: ${errors.join(', ')}`);
    }

    // Find best quote (highest output amount)
    const bestQuote = quotes.reduce((best, current) => {
      const bestAmount = parseFloat(best.amountOut);
      const currentAmount = parseFloat(current.amountOut);
      return currentAmount > bestAmount ? current : best;
    });

    // Calculate savings
    const worstQuote = quotes.reduce((worst, current) => {
      const worstAmount = parseFloat(worst.amountOut);
      const currentAmount = parseFloat(current.amountOut);
      return currentAmount < worstAmount ? current : worst;
    });

    const savings = quotes.length > 1 
      ? (((parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)) / parseFloat(worstQuote.amountOut)) * 100).toFixed(2)
      : "0";

    return {
      bestQuote,
      allQuotes: quotes,
      savings
    };
  }

  /**
   * Execute swap on the specified DEX
   */
  async executeSwap(
    exchange: 'dragonswap' | 'symphony',
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    minAmountOut: string,
    walletAddress: string
  ): Promise<any> {
    switch (exchange) {
      case 'dragonswap':
        return await this.dragonSwap.executeSwap(tokenIn, tokenOut, amountIn, minAmountOut, walletAddress);
      
      case 'symphony':
        return await this.symphony.executeSwap(tokenIn, tokenOut, amountIn, minAmountOut, walletAddress);
      
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }

  /**
   * Get comprehensive market analysis across all DEXes
   */
  async getMarketAnalysis(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<{
    bestPrice: DexQuote;
    priceComparison: Record<string, { price: string; difference: string }>;
    liquidityAnalysis: string;
    recommendation: string;
  }> {
    const result = await this.getBestQuote(tokenIn, tokenOut, amountIn);
    
    const priceComparison: Record<string, { price: string; difference: string }> = {};
    const bestAmount = parseFloat(result.bestQuote.amountOut);

    result.allQuotes.forEach(quote => {
      const amount = parseFloat(quote.amountOut);
      const difference = ((amount - bestAmount) / bestAmount * 100).toFixed(2);
      priceComparison[quote.exchange] = {
        price: quote.amountOut,
        difference: difference + '%'
      };
    });

    const liquidityAnalysis = this.analyzeLiquidity(result.allQuotes);
    const recommendation = this.generateRecommendation(result);

    return {
      bestPrice: result.bestQuote,
      priceComparison,
      liquidityAnalysis,
      recommendation
    };
  }

  private analyzeLiquidity(quotes: DexQuote[]): string {
    const impacts = quotes.map(q => parseFloat(q.priceImpact));
    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
    
    if (avgImpact < 1) return "Excellent liquidity across all DEXes";
    if (avgImpact < 3) return "Good liquidity with minimal slippage";
    if (avgImpact < 5) return "Moderate liquidity - consider smaller trades";
    return "Limited liquidity - high price impact expected";
  }

  private generateRecommendation(result: BestQuoteResult): string {
    const { bestQuote, savings } = result;
    const savingsNum = parseFloat(savings);
    
    if (savingsNum > 2) {
      return `Strong recommendation: Use ${bestQuote.exchange} for ${savingsNum}% better rate`;
    } else if (savingsNum > 0.5) {
      return `Moderate recommendation: ${bestQuote.exchange} offers ${savingsNum}% better rate`;
    } else {
      return `All DEXes offer similar rates - choose based on gas preferences`;
    }
  }
}