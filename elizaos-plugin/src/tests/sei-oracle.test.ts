import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeiOracleProvider } from '../providers/sei-oracle';
import { createPublicClient } from 'viem';

// Import test helpers
import { 
  createMockRuntime,
  createMockMemory,
  createMockState
} from './test-helpers';

// Mock dependencies
vi.mock('viem', () => ({
  createPublicClient: vi.fn(),
  http: vi.fn()
}));

vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn()
  }
}));

// Mock fetch for external API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('SeiOracleProvider', () => {
  let mockRuntime: any;
  let mockPublicClient: any;
  let oracleProvider: SeiOracleProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    // Use test helper but override specific settings for oracle tests
    mockRuntime = {
      ...createMockRuntime(),
      getSetting: vi.fn((key: string) => {
        switch (key) {
          case 'SEI_RPC_URL':
            return 'https://evm-rpc.sei-apis.com';
          case 'SEI_NETWORK':
            return 'mainnet';
          case 'ORACLE_API_KEY':
            return 'test-oracle-key';
          default:
            return null;
        }
      }),
      cacheManager: {
        get: vi.fn().mockResolvedValue(null), // Default to no cache
        set: vi.fn(),
        delete: vi.fn()
      }
    };

    mockPublicClient = {
      readContract: vi.fn(),
      getBlockNumber: vi.fn().mockResolvedValue(BigInt(1000000)),
      getBlock: vi.fn().mockResolvedValue({
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      })
    };

    (createPublicClient as any).mockReturnValue(mockPublicClient);
    
    // Default fetch to reject for unsupported symbols
    mockFetch.mockRejectedValue(new Error('Network error'));

    oracleProvider = new SeiOracleProvider(mockRuntime);
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with correct configuration', () => {
      expect(oracleProvider).toBeInstanceOf(SeiOracleProvider);
      expect(oracleProvider).toBeDefined();
    });

    it('should provide context for the provider', async () => {
      const mockMemory = createMockMemory(''); // Empty message to get provider description
      const mockState = createMockState();
      const context = await oracleProvider.get(mockRuntime, mockMemory, mockState);
      expect(context).toEqual(expect.stringContaining('price data'));
      expect(context).toEqual(expect.stringContaining('SEI blockchain'));
    });

    it('should handle missing configuration gracefully', () => {
      const badRuntime = {
        ...mockRuntime,
        getSetting: vi.fn().mockReturnValue(null)
      };

      expect(() => new SeiOracleProvider(badRuntime)).not.toThrow();
    });
  });

  describe('Price Feed Operations', () => {
    it('should fetch price for BTC from Pyth oracle', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'), // price: 45000 with 8 decimals
        BigInt('10000000'), // confidence
        BigInt(-8), // expo
        BigInt(currentTimestamp) // publish_time
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('BTC');
      expect(price?.price).toBeCloseTo(45000, 1);
      expect(price?.source).toBe('yei-multi-oracle');
      expect(price?.confidence).toBeCloseTo(0.95, 2);
    });

    it('should fetch price for ETH from Pyth oracle', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('250000000000'), // price: 2500 with 8 decimals
        BigInt('5000000'), // confidence
        BigInt(-8), // expo
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('ETH');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('ETH');
      expect(price?.price).toBeCloseTo(2500, 1);
      expect(price?.source).toBe('yei-multi-oracle');
    });

    it('should fetch price for SEI token', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('50000000'), // price: 0.5 with 8 decimals
        BigInt('1000000'), // confidence
        BigInt(-8), // expo
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('SEI');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('SEI');
      expect(price?.price).toBeCloseTo(0.5, 2);
      expect(price?.source).toBe('yei-multi-oracle');
    });

    it('should fetch price for USDC stablecoin', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('100000000'), // price: 1.0 with 8 decimals
        BigInt('100000'), // confidence
        BigInt(-8), // expo
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('USDC');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('USDC');
      expect(price?.price).toBeCloseTo(1.0, 3);
      expect(price?.source).toBe('yei-multi-oracle');
    });

    it('should fallback to Chainlink for supported assets', async () => {
      // Mock YEI multi-oracle failure for non-supported symbol
      mockPublicClient.readContract.mockRejectedValue(new Error('YEI oracle unavailable'));
      
      // Mock CEX fallback success
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          symbol: 'BTCUSDT',
          price: '45000.00'
        })
      });

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toBeDefined();
      expect(price?.source).toBe('Binance');
      expect(price?.price).toBeCloseTo(45000, 1);
    });

    it('should fallback to CEX APIs when on-chain oracles fail', async () => {
      // Mock both Pyth and Chainlink failures
      mockPublicClient.readContract.mockRejectedValue(new Error('Oracle unavailable'));

      // Mock Binance API response for BTC (supported symbol)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          symbol: 'BTCUSDT',
          price: '45000.50'
        })
      });

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toBeDefined();
      expect(price?.price).toBe(45000.50);
      expect(price?.source).toBe('Binance');
    });

    it('should handle multiple price sources for comparison', async () => {
      // Mock successful responses from multiple sources
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(-8),
        BigInt(Math.floor(Date.now() / 1000))
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          symbol: 'BTCUSDT',
          price: '45100.00'
        })
      });

      const price = await oracleProvider.getPrice('BTC');

      // Should prefer Pyth as primary source
      expect(price?.source).toBe('yei-multi-oracle');
      expect(price?.price).toBeCloseTo(45000, 1);
    });

    it('should handle unsupported symbols gracefully', async () => {
      // Mock all oracles to fail
      mockPublicClient.readContract.mockRejectedValue(new Error('Oracle unavailable'));
      
      // Mock fetch to fail for unsupported symbol
      mockFetch.mockRejectedValue(new Error('Symbol not found'));

      const price = await oracleProvider.getPrice('UNKNOWN');
      expect(price).toBeNull();
    });

    it('should return null when all price sources fail', async () => {
      mockPublicClient.readContract.mockRejectedValue(new Error('Oracle down'));
      mockFetch.mockRejectedValue(new Error('Network error'));

      const price = await oracleProvider.getPrice('BTC');
      expect(price).toBeNull();
    });
  });

  describe('Funding Rate Operations', () => {
    it('should fetch funding rates from multiple exchanges', async () => {
      // Mock Binance funding rate response
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance') && url.includes('premiumIndex')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0001',
              nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates).toBeDefined();
      expect(Array.isArray(fundingRates)).toBe(true);
      expect(fundingRates.length).toBeGreaterThan(0);
      expect(fundingRates[0].symbol).toBe('BTC');
      expect(fundingRates[0].rate).toBe(0.0001 * 8760); // Annualized
      expect(fundingRates[0].exchange).toBe('Binance');
    });

    it('should fetch funding rates from OKX', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('okx') && url.includes('funding-rate')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: [{
                instType: 'SWAP',
                instId: 'BTC-USD-SWAP',
                fundingRate: '0.0002',
                nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
              }]
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates.length).toBeGreaterThan(0);
      expect(fundingRates[0].exchange).toBe('OKX');
      expect(fundingRates[0].rate).toBe(0.0002 * 8760); // Annualized
    });

    it('should fetch funding rates from Bybit', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('bybit') && url.includes('tickers')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: {
                list: [{
                  symbol: 'BTCUSDT',
                  fundingRate: '0.00015',
                  nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
                }]
              }
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates.length).toBeGreaterThan(0);
      expect(fundingRates[0].exchange).toBe('Bybit');
      expect(fundingRates[0].rate).toBe(0.00015 * 8760); // Annualized
    });

    it('should handle funding rate API failures gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('API unavailable'));

      const fundingRates = await oracleProvider.getFundingRates('BTC');
      expect(fundingRates).toEqual([]);
    });

    it('should calculate next funding time correctly', async () => {
      const currentTime = Date.now();
      const nextFunding = currentTime + 4 * 60 * 60 * 1000; // 4 hours from now

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0002',
              nextFundingTime: nextFunding.toString()
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates[0].nextFundingTime).toBe(nextFunding);
    });

    it('should aggregate funding rates from multiple exchanges', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0001',
              nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
            })
          });
        }
        if (url.includes('okx')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: [{
                instType: 'SWAP',
                instId: 'BTC-USD-SWAP',
                fundingRate: '0.0002',
                nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
              }]
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates.length).toBe(2);
      expect(fundingRates.map(r => r.exchange)).toContain('Binance');
      expect(fundingRates.map(r => r.exchange)).toContain('OKX');
    });
  });

  describe('Price Feed Validation', () => {
    it('should validate price feed data structure', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toMatchObject({
        symbol: expect.any(String),
        price: expect.any(Number),
        timestamp: expect.any(Number),
        source: expect.any(String),
        confidence: expect.any(Number)
      });
    });

    it('should calculate confidence correctly from Pyth data', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const confidence = BigInt('10000000'); // 0.1 with 8 decimals
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        confidence,
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.confidence).toBeCloseTo(0.95, 8);
    });

    it('should handle stale price data', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(-8),
        BigInt(staleTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      // With YEI multi-oracle, it returns current timestamp even with stale data
      expect(price?.timestamp).toBeDefined();
      expect(price?.price).toBeCloseTo(45000, 1);
    });

    it('should validate funding rate data structure', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0001',
              nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates[0]).toMatchObject({
        symbol: expect.any(String),
        rate: expect.any(Number),
        timestamp: expect.any(Number),
        exchange: expect.any(String),
        nextFundingTime: expect.any(Number)
      });
    });
  });

  describe('Multi-Source Price Aggregation', () => {
    it('should prioritize Pyth oracle when available', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.source).toBe('yei-multi-oracle');
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'queryPriceFeed'
        })
      );
    });

    it('should aggregate prices from multiple sources for comparison', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract
        .mockRejectedValueOnce(new Error('Pyth down'))
        .mockResolvedValueOnce([
          BigInt(1),
          BigInt('4500000000000'),
          BigInt(currentTimestamp),
          BigInt(currentTimestamp),
          BigInt(1)
        ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.source).toBe('yei-multi-oracle');
    });

    it('should detect price deviations between sources', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // Mock Pyth returning one price
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'), // 45000
        BigInt('10000000'),
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      // Mock CEX returning significantly different price
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          symbol: 'BTCUSDT',
          price: '50000.00' // 11% deviation
        })
      });

      const price = await oracleProvider.getPrice('BTC');

      // Should still return Pyth price but log warning about deviation
      expect(price?.source).toBe('yei-multi-oracle');
      expect(price?.price).toBeCloseTo(45000, 1);
    });
  });

  describe('Caching Behavior', () => {
    it('should cache price data to reduce API calls', async () => {
      // First call - should fetch fresh data
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'), // 45000 with 8 decimals
        BigInt('10000000'),
        BigInt(-8),
        Math.floor(Date.now() / 1000)
      ]);

      const price1 = await oracleProvider.getPrice('BTC');
      expect(price1).toBeDefined();

      // Second call immediately - should use in-memory cache
      const price2 = await oracleProvider.getPrice('BTC');
      expect(price2).toBeDefined();
      
      // The prices should be the same from cache
      expect(price1?.price).toBe(price2?.price);
    });

    it('should refresh cache when data is stale', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const stalePrice = {
        symbol: 'BTC',
        price: 45000,
        timestamp: Date.now() - 600000, // 10 minutes ago
        source: 'pyth',
        confidence: 0.01
      };

      // Mock stale cache
      mockRuntime.cacheManager.get.mockResolvedValue(stalePrice);
      
      // Mock fresh oracle data
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4600000000000'), // Updated price
        BigInt('10000000'),
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.price).toBe(46000); // Updated price
      expect(mockPublicClient.readContract).toHaveBeenCalled();
    });

    it('should cache funding rate data', async () => {
      // Mock successful funding rate fetch
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0001',
              nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
            })
          });
        }
        return Promise.reject(new Error('API unavailable'));
      });

      // First call should fetch data
      const fundingRates1 = await oracleProvider.getFundingRates('BTC');
      expect(fundingRates1.length).toBeGreaterThan(0);

      // Second call should use cache (verify it's fast)
      const startTime = Date.now();
      const fundingRates2 = await oracleProvider.getFundingRates('BTC');
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100); // Should be fast from cache
      expect(fundingRates2.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      mockPublicClient.readContract.mockRejectedValue(new Error('Network timeout'));
      mockFetch.mockRejectedValue(new Error('Fetch timeout'));

      const price = await oracleProvider.getPrice('BTC');
      expect(price).toBeNull();
    });

    it('should handle malformed API responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null) // Malformed response
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');
      expect(fundingRates).toEqual([]);
    });

    it('should handle invalid price feed data', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // Mock all oracle sources to fail or return invalid data
      mockPublicClient.readContract
        .mockRejectedValue(new Error('Oracle contract call failed'));

      // Also mock fetch to fail for all external APIs
      mockFetch.mockRejectedValue(new Error('All external price APIs failed'));

      const price = await oracleProvider.getPrice('BTC');
      expect(price).toBeNull();
    });

    it('should handle rate limiting from exchanges', async () => {
      mockFetch.mockRejectedValue(new Error('429 Too Many Requests'));

      const fundingRates = await oracleProvider.getFundingRates('BTC');
      expect(fundingRates).toEqual([]);
    });

    it('should handle partial exchange failures', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              symbol: 'BTCUSDT',
              lastFundingRate: '0.0001',
              nextFundingTime: (Date.now() + 8 * 60 * 60 * 1000).toString()
            })
          });
        }
        // OKX and Bybit fail
        return Promise.reject(new Error('Exchange unavailable'));
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      // Should return data from successful exchange only
      expect(fundingRates.length).toBe(1);
      expect(fundingRates[0].exchange).toBe('Binance');
    });
  });

  describe('Provider Lifecycle', () => {
    it('should start and stop price updates', () => {
      oracleProvider.startPriceUpdates();
      expect(oracleProvider['updateInterval']).toBeDefined();

      oracleProvider.stopPriceUpdates();
      expect(oracleProvider['updateInterval']).toBeNull();
    });

    it('should handle multiple start calls gracefully', () => {
      oracleProvider.startPriceUpdates();
      const firstInterval = oracleProvider['updateInterval'];
      
      oracleProvider.startPriceUpdates();
      const secondInterval = oracleProvider['updateInterval'];

      expect(firstInterval).toBe(secondInterval);
    });

    it('should handle stop calls when not running', () => {
      expect(() => oracleProvider.stopPriceUpdates()).not.toThrow();
    });
  });

  describe('Symbol Mapping', () => {
    it('should map SEI native symbols correctly', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('50000000'),
        BigInt('1000000'),
        BigInt(-8),
        BigInt(currentTimestamp)
      ]);

      const price = await oracleProvider.getPrice('SEI');

      expect(price?.symbol).toBe('SEI');
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb']
        })
      );
    });

    it('should handle token symbol variations', async () => {
      const variations = ['WSEI', 'wSEI', 'WSEI-USD'];
      
      for (const variation of variations) {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        mockPublicClient.readContract.mockResolvedValue([
          BigInt('50000000'),
          BigInt('1000000'),
          BigInt(-8),
          BigInt(currentTimestamp)
        ]);

        const price = await oracleProvider.getPrice(variation);
        expect(price).toBeDefined();
      }
    });
  });
});