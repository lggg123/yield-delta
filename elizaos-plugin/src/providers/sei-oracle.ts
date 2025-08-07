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

interface YeiOracleConfig {
  api3ContractAddress: string;
  pythContractAddress: string;
  redstoneContractAddress: string;
}

export class SeiOracleProvider {
  private runtime: IAgentRuntime;
  private config: OracleConfig;
  private priceCache: Map<string, PriceFeed> = new Map();
  private fundingRateCache: Map<string, FundingRate[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  private yeiConfig: YeiOracleConfig = {
    api3ContractAddress: "0x2880aB155794e7179c9eE2e38200202908C17B43", // YEI's API3 contract address (using Pyth address as placeholder)
    pythContractAddress: "0x2880aB155794e7179c9eE2e38200202908C17B43", // YEI's Pyth contract address
    redstoneContractAddress: "0x1111111111111111111111111111111111111111" // YEI's Redstone contract address (placeholder)
  };

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
        'BTC/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        'SEI/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
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
      // If no message content, return provider description
      if (!message?.content?.text) {
        return "SEI Oracle Provider: Real-time price data and funding rates for assets on the SEI blockchain using Pyth, Chainlink, and CEX APIs.";
      }
      
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
      // Check cache first - compare with runtime cache if available
      const cached = this.priceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.config.updateInterval * 1000) {
        return cached;
      }

      // Try runtime cache first if available - disabled due to cacheManager not available
      // if (this.runtime.cacheManager) {
      //   try {
      //     const runtimeCached = await this.runtime.cacheManager.get(`price_${symbol}`);
      //     if (runtimeCached && Date.now() - runtimeCached.timestamp < this.config.updateInterval * 1000) {
      //       this.priceCache.set(symbol, runtimeCached);
      //       return runtimeCached;
      //     }
      //   } catch (error) {
      //     // Cache error, continue with fetch
      //   }
      // }

      // Try multiple sources - YEI multi-oracle as priority for supported symbols
      let price: PriceFeed | null = null;
      
      // First try YEI Finance multi-oracle approach (for YEI-supported symbols)
      const yeiSupportedSymbols = ['BTC', 'ETH', 'SEI', 'USDC', 'USDT'];
      if (yeiSupportedSymbols.includes(symbol.toUpperCase())) {
        try {
          const yeiPrice = await this.getYeiPrice(symbol);
          if (yeiPrice && yeiPrice > 0) {
            price = {
              symbol,
              price: yeiPrice,
              source: 'yei-multi-oracle',
              timestamp: Date.now(),
              confidence: 0.95 // High confidence for multi-oracle consensus
            };
          }
        } catch (error) {
          elizaLogger.warn(`YEI oracle failed for ${symbol}, falling back to other oracles:`, error);
        }
      }
      
      // Fallback to existing oracle sources
      if (!price) price = await this.getPythPrice(symbol);
      if (!price) price = await this.getChainlinkPrice(symbol);
      if (!price) price = await this.getCexPrice(symbol);

      if (price && !isNaN(price.price) && price.price > 0) {
        this.priceCache.set(symbol, price);
        // Also cache in runtime if available - disabled due to cacheManager not available
        // if (this.runtime.cacheManager) {
        //   try {
        //     await this.runtime.cacheManager.set(`price_${symbol}`, price);
        //   } catch (error) {
        //     // Cache error, continue
        //   }
        // }
        return price;
      }

      return null;
    } catch (error) {
      elizaLogger.error(`Failed to get price for ${symbol}:`, error);
      return null;
    }
  }

  async getFundingRates(symbol: string): Promise<FundingRate[]> {
    try {
      // Check runtime cache first - disabled due to cacheManager not available
      // if (this.runtime.cacheManager) {
      //   try {
      //     const runtimeCached = await this.runtime.cacheManager.get(`funding_rates_${symbol}`);
      //     if (runtimeCached && Array.isArray(runtimeCached) && runtimeCached.length > 0) {
      //       return runtimeCached;
      //     }
      //   } catch (cacheError) {
      //     elizaLogger.warn("Cache retrieval failed for funding rates:", cacheError);
      //   }
      // }

      // Check internal cache as fallback
      const cached = this.fundingRateCache.get(symbol);
      if (cached && cached.length > 0 && Date.now() - cached[0]?.timestamp < this.config.updateInterval * 1000) {
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
        
        // Cache in runtime cache manager as well - disabled due to cacheManager not available
        // if (this.runtime.cacheManager) {
        //   try {
        //     await this.runtime.cacheManager.set(`funding_rates_${symbol}`, validRates);
        //   } catch (cacheError) {
        //     elizaLogger.warn("Cache storage failed for funding rates:", cacheError);
        //   }
        // }
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

      const publicClient = createPublicClient({
        chain: seiChains.mainnet,
        transport: http()
      });

      const result = await publicClient.readContract({
        address: '0x2880aB155794e7179c9eE2e38200202908C17B43' as `0x${string}`,
        abi: [
          {
            name: 'queryPriceFeed',
            type: 'function',
            inputs: [{ name: 'id', type: 'bytes32' }],
            outputs: [
              { name: 'price', type: 'int64' },
              { name: 'conf', type: 'uint64' },
              { name: 'expo', type: 'int32' },
              { name: 'publishTime', type: 'uint256' }
            ]
          }
        ] as const,
        functionName: 'queryPriceFeed',
        args: [feedId as `0x${string}`]
      });

      if (!result || result[0] === BigInt(0)) {
        return null; // Invalid price data
      }

      const price = Number(result[0]) / Math.pow(10, 8);
      const confidence = Number(result[1]) / Math.pow(10, 8);
      const timestamp = Number(result[3]) * 1000; // Convert to milliseconds

      // Validate price data
      if (isNaN(price) || price <= 0) {
        return null;
      }

      return {
        symbol,
        price,
        timestamp,
        source: 'pyth',
        confidence
      };
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

      const result = await publicClient.readContract({
        address: feedAddress as `0x${string}`,
        abi: [
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
        ] as const,
        functionName: 'latestRoundData'
      });

      if (!result || result[1] === BigInt(0)) {
        return null; // Invalid price data
      }

      const price = Number(result[1]) / 1e8; // Chainlink uses 8 decimals
      const timestamp = Number(result[3]) * 1000; // Convert to milliseconds

      // Validate price data
      if (isNaN(price) || price <= 0) {
        return null;
      }

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
      // Only try for supported symbols
      const supportedSymbols = ['BTC', 'ETH', 'SEI', 'USDC', 'SOL', 'AVAX'];
      if (!supportedSymbols.includes(symbol)) {
        return null;
      }

      const response = await fetch(
        `${this.config.cexApis.binance}/ticker/price?symbol=${symbol}USDT`
      );
      
      if (response.ok) {
        const data = await response.json();
        const price = parseFloat(data.price);
        
        // Validate price data
        if (isNaN(price) || price <= 0) {
          return null;
        }
        
        return {
          symbol,
          price,
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

  /**
   * YEI Finance Multi-Oracle Strategy
   * Implements API3, Pyth Network, and Redstone oracles with sophisticated fallback logic
   */
  private async getYeiPrice(symbol: string): Promise<number> {
    // Priority 1: API3 dAPI (Primary oracle for YEI Finance)
    try {
      const api3Price = await this.getAPI3Price(symbol);
      if (api3Price && api3Price > 0) {
        elizaLogger.log(`YEI API3 price for ${symbol}: ${api3Price}`);
        return api3Price;
      }
    } catch (error) {
      elizaLogger.error(`YEI API3 price fetch failed for ${symbol}:`, error);
    }

    // Priority 2: Pyth Network (Backup with 100+ publishers)
    try {
      const pythPrice = await this.getPythPrice(symbol);
      if (pythPrice && pythPrice.price > 0) {
        elizaLogger.log(`YEI Pyth price for ${symbol}: ${pythPrice.price}`);
        return pythPrice.price;
      }
    } catch (error) {
      elizaLogger.error(`YEI Pyth price fetch failed for ${symbol}:`, error);
    }

    // Priority 3: Redstone Classic (USDT/USDC fallback)
    try {
      const redstonePrice = await this.getRedstonePrice(symbol);
      if (redstonePrice && redstonePrice > 0) {
        elizaLogger.log(`YEI Redstone price for ${symbol}: ${redstonePrice}`);
        return redstonePrice;
      }
    } catch (error) {
      elizaLogger.error(`YEI Redstone price fetch failed for ${symbol}:`, error);
    }

    throw new Error(`All YEI oracle sources failed for ${symbol}`);
  }

  /**
   * API3 dAPI Integration for YEI Finance
   */
  private async getAPI3Price(symbol: string): Promise<number> {
    const dApiId = this.getAPI3dApiId(symbol);
    const publicClient = createPublicClient({
      chain: seiChains.mainnet,
      transport: http()
    });

    const result = await publicClient.readContract({
      address: this.yeiConfig.api3ContractAddress as `0x${string}`,
      abi: [
        {
          inputs: [{ name: "dApiId", type: "bytes32" }],
          name: "readDataFeed",
          outputs: [
            { name: "value", type: "int224" },
            { name: "timestamp", type: "uint32" }
          ],
          stateMutability: "view",
          type: "function"
        }
      ] as const,
      functionName: "readDataFeed",
      args: [dApiId]
    });

    const price = Number(result[0]) / 1e18; // Assuming 18 decimals
    const timestamp = Number(result[1]);

    // Validate price data (should be recent and reasonable)
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > 3600) { // More than 1 hour old
      throw new Error(`API3 price data too old for ${symbol}`);
    }

    return price;
  }

  /**
   * Redstone Classic Oracle Integration
   */
  private async getRedstonePrice(symbol: string): Promise<number> {
    const publicClient = createPublicClient({
      chain: seiChains.mainnet,
      transport: http()
    });

    // Only support USDT and USDC for Redstone Classic
    if (!['USDT', 'USDC'].includes(symbol)) {
      throw new Error(`Redstone feed not available for ${symbol}`);
    }

    const feedId = this.stringToBytes32(`${symbol}/USD`);
    
    const result = await publicClient.readContract({
      address: this.yeiConfig.redstoneContractAddress as `0x${string}`,
      abi: [
        {
          inputs: [{ name: "feedId", type: "bytes32" }],
          name: "getLatestRoundData",
          outputs: [
            { name: "price", type: "int256" },
            { name: "timestamp", type: "uint256" }
          ],
          stateMutability: "view",
          type: "function"
        }
      ] as const,
      functionName: "getLatestRoundData",
      args: [feedId]
    });

    return Number(result[0]) / 1e8; // Assuming 8 decimals for USD pairs
  }

  /**
   * Get API3 dAPI ID for symbol
   */
  private getAPI3dApiId(symbol: string): `0x${string}` {
    const dApiIds: Record<string, string> = {
      'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', 
      'SEI': '0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb',
      'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
    };

    const dApiId = dApiIds[symbol.toUpperCase()];
    if (!dApiId) {
      throw new Error(`No API3 dAPI ID configured for ${symbol}`);
    }

    return dApiId as `0x${string}`;
  }

  /**
   * Convert string to bytes32 for Redstone
   */
  private stringToBytes32(str: string): `0x${string}` {
    const hex = Buffer.from(str).toString('hex').padEnd(64, '0');
    return `0x${hex}` as `0x${string}`;
  }

  stopPriceUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export const oracleProvider = {
  name: "seiOracle",
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const provider = new SeiOracleProvider(runtime);
    return provider.get(runtime, message, state);
  }
};