import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  elizaLogger,
} from "@elizaos/core";
import { createPublicClient, http } from 'viem';
import { seiChains } from './wallet';

export interface PriceFeed {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
  confidence: number;
}

export interface FundingRate {
  symbol: string;
  rate: number; // Annual percentage
  timestamp: number;
  exchange: string;
  nextFundingTime: number;
}

export interface OracleConfig {
  pythPriceFeeds: Record<string, string>; // symbol -> price feed ID
  chainlinkFeeds: Record<string, string>; // symbol -> feed address
  cexApis: {
    binance: string;
    bybit: string;
    okx: string;
  };
  updateInterval: number; // seconds
}

export class SeiOracleProvider implements Provider {
  private runtime: IAgentRuntime;
  private config: OracleConfig;
  private priceCache: Map<string, PriceFeed> = new Map();
  private fundingRateCache: Map<string, FundingRate[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.config = {
      pythPriceFeeds: {
        'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
        'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
        'SEI': '0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb',
        'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
      },
      chainlinkFeeds: {
        'BTC/USD': '0x...',
        'ETH/USD': '0x...',
        'SEI/USD': '0x...',
      },
      cexApis: {
        binance: 'https://fapi.binance.com/fapi/v1',
        bybit: 'https://api.bybit.com/v5',
        okx: 'https://www.okx.com/api/v5',
      },
      updateInterval: 30, // 30 seconds
    };
  }

  async get(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string | null> {
    try {
      const text = message.content.text.toLowerCase();
      
      if (text.includes('price') || text.includes('quote')) {
        return await this.handlePriceQuery(text);
      }
      
      if (text.includes('funding') || text.includes('rate')) {
        return await this.handleFundingRateQuery(text);
      }
      
      return null;
    } catch (error) {
      elizaLogger.error("Oracle provider error:", error);
      return null;
    }
  }

  private async handlePriceQuery(text: string): Promise<string> {
    const symbols = this.extractSymbols(text);
    const prices: PriceFeed[] = [];

    for (const symbol of symbols) {
      const price = await this.getPrice(symbol);
      if (price) prices.push(price);
    }

    if (prices.length === 0) {
      return "No price data available for the requested symbols.";
    }

    return prices.map(p => 
      `${p.symbol}: $${p.price.toFixed(4)} (${p.source})`
    ).join('\n');
  }

  private async handleFundingRateQuery(text: string): Promise<string> {
    const symbols = this.extractSymbols(text);
    const fundingData: string[] = [];

    for (const symbol of symbols) {
      const rates = await this.getFundingRates(symbol);
      if (rates.length > 0) {
        const ratesText = rates.map(r => 
          `${r.exchange}: ${(r.rate * 100).toFixed(4)}%`
        ).join(', ');
        fundingData.push(`${symbol}: ${ratesText}`);
      }
    }

    return fundingData.length > 0 
      ? fundingData.join('\n')
      : "No funding rate data available.";
  }

  async getPrice(symbol: string): Promise<PriceFeed | null> {
    try {
      // Check cache first
      const cached = this.priceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.config.updateInterval * 1000) {
        return cached;
      }

      // Try multiple sources
      let price = await this.getPythPrice(symbol);
      if (!price) price = await this.getChainlinkPrice(symbol);
      if (!price) price = await this.getCexPrice(symbol);

      if (price) {
        this.priceCache.set(symbol, price);
      }

      return price;
    } catch (error) {
      elizaLogger.error(`Failed to get price for ${symbol}:`, error);
      return null;
    }
  }

  async getFundingRates(symbol: string): Promise<FundingRate[]> {
    try {
      const cached = this.fundingRateCache.get(symbol);
      if (cached && Date.now() - cached[0]?.timestamp < this.config.updateInterval * 1000) {
        return cached;
      }

      const rates = await Promise.all([
        this.getBinanceFundingRate(symbol),
        this.getBybitFundingRate(symbol),
        this.getOkxFundingRate(symbol),
      ]);

      const validRates = rates.filter(r => r !== null) as FundingRate[];
      
      if (validRates.length > 0) {
        this.fundingRateCache.set(symbol, validRates);
      }

      return validRates;
    } catch (error) {
      elizaLogger.error(`Failed to get funding rates for ${symbol}:`, error);
      return [];
    }
  }

  private async getPythPrice(symbol: string): Promise<PriceFeed | null> {
    try {
      const feedId = this.config.pythPriceFeeds[symbol];
      if (!feedId) return null;

      // Implement Pyth Network price feed reading
      // This would require the Pyth SDK for on-chain price feeds
      elizaLogger.log(`Getting Pyth price for ${symbol}`);
      
      // Placeholder - implement actual Pyth integration
      return null;
    } catch (error) {
      elizaLogger.error(`Pyth price fetch error for ${symbol}:`, error);
      return null;
    }
  }

  private async getChainlinkPrice(symbol: string): Promise<PriceFeed | null> {
    try {
      const feedAddress = this.config.chainlinkFeeds[`${symbol}/USD`];
      if (!feedAddress) return null;

      const publicClient = createPublicClient({
        chain: seiChains.mainnet,
        transport: http()
      });

      // Chainlink ABI for price feeds
      const chainlinkAbi = [
        {
          name: 'latestRoundData',
          type: 'function',
          outputs: [
            { name: 'roundId', type: 'uint80' },
            { name: 'answer', type: 'int256' },
            { name: 'startedAt', type: 'uint256' },
            { name: 'updatedAt', type: 'uint256' },
            { name: 'answeredInRound', type: 'uint80' }
          ]
        }
      ] as const;

      const result = await publicClient.readContract({
        address: feedAddress as `0x${string}`,
        abi: chainlinkAbi,
        functionName: 'latestRoundData'
      });

      const price = Number(result[1]) / 1e8; // Chainlink uses 8 decimals
      const timestamp = Number(result[3]) * 1000;

      return {
        symbol,
        price,
        timestamp,
        source: 'Chainlink',
        confidence: 0.99
      };
    } catch (error) {
      elizaLogger.error(`Chainlink price fetch error for ${symbol}:`, error);
      return null;
    }
  }

  private async getCexPrice(symbol: string): Promise<PriceFeed | null> {
    try {
      // Try Binance first
      const response = await fetch(
        `${this.config.cexApis.binance}/ticker/price?symbol=${symbol}USDT`
      );
      
      if (response.ok) {
        const data = await response.json();
        return {
          symbol,
          price: parseFloat(data.price),
          timestamp: Date.now(),
          source: 'Binance',
          confidence: 0.95
        };
      }

      return null;
    } catch (error) {
      elizaLogger.error(`CEX price fetch error for ${symbol}:`, error);
      return null;
    }
  }

  private async getBinanceFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const response = await fetch(
        `${this.config.cexApis.binance}/premiumIndex?symbol=${symbol}USDT`
      );
      
      if (response.ok) {
        const data = await response.json();
        return {
          symbol,
          rate: parseFloat(data.lastFundingRate) * 8760, // Convert to annual
          timestamp: Date.now(),
          exchange: 'Binance',
          nextFundingTime: parseInt(data.nextFundingTime)
        };
      }

      return null;
    } catch (error) {
      elizaLogger.error(`Binance funding rate error for ${symbol}:`, error);
      return null;
    }
  }

  private async getBybitFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const response = await fetch(
        `${this.config.cexApis.bybit}/market/tickers?category=linear&symbol=${symbol}USDT`
      );
      
      if (response.ok) {
        const data = await response.json();
        const ticker = data.result.list[0];
        
        return {
          symbol,
          rate: parseFloat(ticker.fundingRate) * 8760, // Convert to annual
          timestamp: Date.now(),
          exchange: 'Bybit',
          nextFundingTime: parseInt(ticker.nextFundingTime)
        };
      }

      return null;
    } catch (error) {
      elizaLogger.error(`Bybit funding rate error for ${symbol}:`, error);
      return null;
    }
  }

  private async getOkxFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const response = await fetch(
        `${this.config.cexApis.okx}/public/funding-rate?instId=${symbol}-USDT-SWAP`
      );
      
      if (response.ok) {
        const data = await response.json();
        const fundingData = data.data[0];
        
        return {
          symbol,
          rate: parseFloat(fundingData.fundingRate) * 8760, // Convert to annual
          timestamp: parseInt(fundingData.fundingTime),
          exchange: 'OKX',
          nextFundingTime: parseInt(fundingData.nextFundingTime)
        };
      }

      return null;
    } catch (error) {
      elizaLogger.error(`OKX funding rate error for ${symbol}:`, error);
      return null;
    }
  }

  private extractSymbols(text: string): string[] {
    const symbols = ['BTC', 'ETH', 'SEI', 'USDC', 'SOL', 'AVAX'];
    return symbols.filter(symbol => 
      text.toUpperCase().includes(symbol)
    );
  }

  startPriceUpdates(): void {
    if (this.updateInterval) return;

    this.updateInterval = setInterval(async () => {
      try {
        // Update cached prices for major symbols
        const symbols = ['BTC', 'ETH', 'SEI'];
        await Promise.all(symbols.map(symbol => this.getPrice(symbol)));
        await Promise.all(symbols.map(symbol => this.getFundingRates(symbol)));
      } catch (error) {
        elizaLogger.error("Price update error:", error);
      }
    }, this.config.updateInterval * 1000);
  }

  stopPriceUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export const oracleProvider: Provider = {
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const provider = new SeiOracleProvider(runtime);
    return provider.get(runtime, message, state);
  }
};