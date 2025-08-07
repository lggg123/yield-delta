import { Provider, IAgentRuntime, elizaLogger } from "@elizaos/core";

export interface FundingRateData {
  exchange: string;
  symbol: string;
  fundingRate: number;
  fundingTime: Date;
  nextFundingTime: Date;
  markPrice: number;
  indexPrice: number;
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ArbitrageOpportunity {
  symbol: string;
  exchange1: string;
  exchange2: string;
  rate1: number;
  rate2: number;
  spread: number;
  profitPotential: number;
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class FundingRateProvider {
  constructor(private runtime: IAgentRuntime) {}

  async get(symbol: string = "SEI-USDT"): Promise<FundingRateData[]> {
    const now = new Date();
    const cacheKey = symbol.toUpperCase();

    try {
      elizaLogger.log(`Fetching funding rates for ${symbol}...`);

      const exchanges = [
        'binance', 'bybit', 'bitmex', 'huobi', 'hyperliquid', 'kraken', 'woox'
      ];

      const fetchPromises = exchanges.map(async (exchange) => {
        try {
          switch (exchange) {
            case 'binance': return await this.getBinanceFunding(symbol);
            case 'bybit': return await this.getBybitFunding(symbol);
            case 'bitmex': return await this.getBitMEXFunding(symbol);
            case 'huobi': return await this.getHuobiFunding(symbol);
            case 'hyperliquid': return await this.getHyperliquidFunding(symbol);
            case 'kraken': return await this.getKrakenFunding(symbol);
            case 'woox': return await this.getWooXFunding(symbol);
            default: return null;
          }
        } catch (error) {
          elizaLogger.error(`Error fetching from ${exchange}:`, error);
          return null;
        }
      });

      const results = await Promise.allSettled(fetchPromises);
      const fundingRates: FundingRateData[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          fundingRates.push(result.value);
        } else {
          elizaLogger.warn(`Failed to fetch from ${exchanges[index]}:`, result.status === 'rejected' ? result.reason : 'No data');
        }
      });

      elizaLogger.log(`Successfully fetched funding rates from ${fundingRates.length} exchanges`);
      return fundingRates;

    } catch (error) {
      elizaLogger.error("Error fetching funding rates:", error);
      return [];
    }
  }

  async findArbitrageOpportunities(symbol: string = "SEI-USDT"): Promise<ArbitrageOpportunity[]> {
    const fundingRates = await this.get(symbol);
    if (fundingRates.length < 2) return [];

    const opportunities: ArbitrageOpportunity[] = [];
    
    // Compare all pairs of exchanges
    for (let i = 0; i < fundingRates.length; i++) {
      for (let j = i + 1; j < fundingRates.length; j++) {
        const rate1 = fundingRates[i];
        const rate2 = fundingRates[j];
        const spread = Math.abs(rate1.fundingRate - rate2.fundingRate);
        
        // Only consider opportunities with significant spread
        if (spread > 0.0001) { // 1bp minimum
          const profitPotential = this.calculateProfit(spread, 10000); // $10k notional
          const confidence = this.calculateConfidence(rate1, rate2);
          const riskLevel = this.assessRisk(spread, rate1, rate2);
          
          opportunities.push({
            symbol,
            exchange1: rate1.exchange,
            exchange2: rate2.exchange,
            rate1: rate1.fundingRate,
            rate2: rate2.fundingRate,
            spread,
            profitPotential,
            confidence,
            riskLevel
          });
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPotential - a.profitPotential);
  }

  private async getBinanceFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const binanceSymbol = symbol.replace('-', '');
      const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`);
      const data = await response.json();

      if (data && data.lastFundingRate) {
        return {
          exchange: 'Binance',
          symbol,
          fundingRate: parseFloat(data.lastFundingRate),
          fundingTime: new Date(data.fundingTime),
          nextFundingTime: new Date(data.nextFundingTime),
          markPrice: parseFloat(data.markPrice),
          indexPrice: parseFloat(data.indexPrice),
          confidence: 0.95,
          riskLevel: 'LOW'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("Binance funding rate fetch failed:", error);
      return null;
    }
  }

  private async getBybitFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const bybitSymbol = symbol.replace('-', '');
      const response = await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${bybitSymbol}&limit=1`);
      const data = await response.json();

      if (data?.result?.list?.[0]) {
        const funding = data.result.list[0];
        return {
          exchange: 'Bybit',
          symbol,
          fundingRate: parseFloat(funding.fundingRate),
          fundingTime: new Date(parseInt(funding.fundingRateTimestamp)),
          nextFundingTime: new Date(Date.now() + 8 * 60 * 60 * 1000), // Next 8 hours
          markPrice: 0, // Would need separate call
          indexPrice: 0, // Would need separate call
          confidence: 0.90,
          riskLevel: 'LOW'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("Bybit funding rate fetch failed:", error);
      return null;
    }
  }

  private async getBitMEXFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const bitmexSymbol = symbol.replace('-', '');
      const response = await fetch(`https://www.bitmex.com/api/v1/funding?symbol=${bitmexSymbol}&count=1&reverse=true`);
      const data = await response.json();

      if (data?.[0]) {
        const funding = data[0];
        return {
          exchange: 'BitMEX',
          symbol,
          fundingRate: funding.fundingRate || 0,
          fundingTime: new Date(funding.timestamp),
          nextFundingTime: new Date(Date.now() + 8 * 60 * 60 * 1000),
          markPrice: 0,
          indexPrice: 0,
          confidence: 0.85,
          riskLevel: 'MEDIUM'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("BitMEX funding rate fetch failed:", error);
      return null;
    }
  }

  private async getHuobiFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const huobiSymbol = symbol.replace('-', '_').toLowerCase();
      const response = await fetch(`https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate?contract_code=${huobiSymbol}`);
      const data = await response.json();

      if (data?.data) {
        return {
          exchange: 'Huobi',
          symbol,
          fundingRate: data.data.funding_rate || 0,
          fundingTime: new Date(data.data.funding_time),
          nextFundingTime: new Date(data.data.next_funding_time),
          markPrice: 0,
          indexPrice: 0,
          confidence: 0.80,
          riskLevel: 'MEDIUM'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("Huobi funding rate fetch failed:", error);
      return null;
    }
  }

  private async getHyperliquidFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'metaAndAssetCtxs'
        })
      });

      const data = await response.json();
      
      if (data?.[1]) {
        const assetCtx = data[1].find((ctx: any) => 
          ctx.coin === symbol.split('-')[0]
        );
        
        if (assetCtx) {
          return {
            exchange: 'Hyperliquid',
            symbol,
            fundingRate: parseFloat(assetCtx.funding) || 0,
            fundingTime: new Date(),
            nextFundingTime: new Date(Date.now() + 60 * 60 * 1000), // Next hour
            markPrice: parseFloat(assetCtx.markPx),
            indexPrice: parseFloat(assetCtx.midPx),
            confidence: 0.85,
            riskLevel: 'MEDIUM'
          };
        }
      }
      return null;
    } catch (error) {
      elizaLogger.error("Hyperliquid funding rate fetch failed:", error);
      return null;
    }
  }

  private async getKrakenFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const krakenSymbol = `PF_${symbol.replace('-', '')}`;
      const response = await fetch(`https://futures.kraken.com/derivatives/api/v3/instruments/${krakenSymbol}`);
      const data = await response.json();

      if (data?.result && data.result.length > 0) {
        const instrument = data.result[0];
        return {
          exchange: 'Kraken',
          symbol,
          fundingRate: parseFloat(instrument.fundingRate) || 0,
          fundingTime: new Date(),
          nextFundingTime: new Date(Date.now() + 4 * 60 * 60 * 1000), // Next 4 hours
          markPrice: parseFloat(instrument.markPrice),
          indexPrice: parseFloat(instrument.indexPrice),
          confidence: 0.85,
          riskLevel: 'LOW'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("Kraken funding rate fetch failed:", error);
      return null;
    }
  }

  private async getWooXFunding(symbol: string): Promise<FundingRateData | null> {
    try {
      const wooSymbol = symbol.replace('-', '_');
      const response = await fetch(`https://api.woo.org/v1/public/funding_rate/${wooSymbol}`);
      const data = await response.json();

      if (data?.success && data.data) {
        return {
          exchange: 'WooX',
          symbol,
          fundingRate: parseFloat(data.data.funding_rate) || 0,
          fundingTime: new Date(data.data.funding_time),
          nextFundingTime: new Date(data.data.next_funding_time),
          markPrice: 0,
          indexPrice: 0,
          confidence: 0.75,
          riskLevel: 'MEDIUM'
        };
      }
      return null;
    } catch (error) {
      elizaLogger.error("WooX funding rate fetch failed:", error);
      return null;
    }
  }

  private calculateProfit(spread: number, notional: number): number {
    // Simple profit calculation: spread * notional * funding frequency (3x daily)
    return spread * notional * 3 * 365; // Annualized
  }

  private calculateConfidence(rate1: FundingRateData, rate2: FundingRateData): number {
    const exchangeReliability = {
      'Binance': 1.0,
      'Bybit': 0.9,
      'BitMEX': 0.8,
      'Huobi': 0.7,
      'Hyperliquid': 0.8,
      'Kraken': 0.8,
      'WooX': 0.6
    };

    const reliability1 = exchangeReliability[rate1.exchange as keyof typeof exchangeReliability] || 0.5;
    const reliability2 = exchangeReliability[rate2.exchange as keyof typeof exchangeReliability] || 0.5;
    
    return (reliability1 + reliability2) / 2;
  }

  private assessRisk(spread: number, rate1: FundingRateData, rate2: FundingRateData): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (spread > 0.001) return 'LOW';      // >10bps spread
    if (spread > 0.0005) return 'MEDIUM';  // >5bps spread
    return 'HIGH';                         // <5bps spread
  }
}
