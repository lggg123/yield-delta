import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeiOracleProvider } from '../providers/sei-oracle';
import { createPublicClient } from 'viem';

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

    mockRuntime = {
      getSetting: vi.fn((key: string) => {
        switch (key) {
          case 'SEI_RPC_URL':
            return 'https://evm-rpc.sei-apis.com';
          case 'SEI_NETWORK':
            return 'mainnet';
          default:
            return null;
        }
      }),
      cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn()
      }
    };

    mockPublicClient = {
      readContract: vi.fn()
    };

    (createPublicClient as any).mockReturnValue(mockPublicClient);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });

    oracleProvider = new SeiOracleProvider(mockRuntime);
  });

  describe('Price Feed Operations', () => {
    it('should initialize with correct configuration', () => {
      expect(oracleProvider).toBeInstanceOf(SeiOracleProvider);
      expect(createPublicClient).toHaveBeenCalled();
    });

    it('should fetch price for BTC from Pyth oracle', async () => {
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'), // price: 45000 with 8 decimals
        BigInt('10000000'), // confidence
        BigInt(Date.now() / 1000), // timestamp
        BigInt(Date.now() / 1000) // publish_time
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('BTC');
      expect(price?.price).toBeCloseTo(45000, 1);
      expect(price?.source).toBe('pyth');
    });

    it('should fetch price for ETH from Pyth oracle', async () => {
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('250000000000'), // price: 2500 with 8 decimals
        BigInt('5000000'), // confidence
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
      ]);

      const price = await oracleProvider.getPrice('ETH');

      expect(price).toBeDefined();
      expect(price?.symbol).toBe('ETH');
      expect(price?.price).toBeCloseTo(2500, 1);
      expect(price?.source).toBe('pyth');
    });

    it('should fallback to Chainlink for supported assets', async () => {
      // Mock Pyth failure
      mockPublicClient.readContract.mockRejectedValueOnce(new Error('Pyth unavailable'));
      
      // Mock Chainlink success
      mockPublicClient.readContract.mockResolvedValueOnce(BigInt('4500000000000'));

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toBeDefined();
      expect(price?.source).toBe('chainlink');
    });

    it('should fallback to CEX APIs when on-chain oracles fail', async () => {
      // Mock both Pyth and Chainlink failures
      mockPublicClient.readContract.mockRejectedValue(new Error('Oracle unavailable'));

      // Mock Binance API response
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
      expect(price?.source).toBe('binance');
    });

    it('should handle unsupported symbols gracefully', async () => {
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
        if (url.includes('binance')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              {
                symbol: 'BTCUSDT',
                fundingRate: '0.0001',
                fundingTime: Date.now() + 8 * 60 * 60 * 1000 // 8 hours from now
              }
            ])
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([])
        });
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates).toHaveLength(1);
      expect(fundingRates[0].symbol).toBe('BTC');
      expect(fundingRates[0].rate).toBe(0.0001 * 365 * 3); // Annualized (3 times per day)
      expect(fundingRates[0].exchange).toBe('binance');
    });

    it('should handle funding rate API failures gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('API unavailable'));

      const fundingRates = await oracleProvider.getFundingRates('BTC');
      expect(fundingRates).toEqual([]);
    });

    it('should calculate next funding time correctly', async () => {
      const currentTime = Date.now();
      const nextFunding = currentTime + 4 * 60 * 60 * 1000; // 4 hours from now

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            symbol: 'BTCUSDT',
            fundingRate: '0.0002',
            fundingTime: nextFunding
          }
        ])
      });

      const fundingRates = await oracleProvider.getFundingRates('BTC');

      expect(fundingRates[0].nextFundingTime).toBe(nextFunding);
    });
  });

  describe('Price Feed Validation', () => {
    it('should validate price feed data structure', async () => {
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
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
      const confidence = BigInt('10000000'); // 0.1 with 8 decimals
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        confidence,
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.confidence).toBeCloseTo(0.1, 8);
    });

    it('should handle stale price data', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(staleTimestamp),
        BigInt(staleTimestamp)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      // Should still return price but with timestamp indicating staleness
      expect(price?.timestamp).toBe(staleTimestamp);
    });
  });

  describe('Multi-Source Price Aggregation', () => {
    it('should prioritize Pyth oracle when available', async () => {
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4500000000000'),
        BigInt('10000000'),
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.source).toBe('pyth');
      expect(mockPublicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'queryPriceFeed'
        })
      );
    });

    it('should aggregate prices from multiple sources for comparison', async () => {
      // This would be a more advanced feature to compare prices across sources
      // For now, we test that fallback mechanism works
      mockPublicClient.readContract
        .mockRejectedValueOnce(new Error('Pyth down'))
        .mockResolvedValueOnce(BigInt('4500000000000'));

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.source).toBe('chainlink');
    });
  });

  describe('Caching Behavior', () => {
    it('should cache price data to reduce API calls', async () => {
      const mockPrice = {
        symbol: 'BTC',
        price: 45000,
        timestamp: Date.now(),
        source: 'pyth',
        confidence: 0.01
      };

      // Mock cache hit
      mockRuntime.cacheManager.get.mockResolvedValue(mockPrice);

      const price = await oracleProvider.getPrice('BTC');

      expect(price).toEqual(mockPrice);
      expect(mockPublicClient.readContract).not.toHaveBeenCalled();
    });

    it('should refresh cache when data is stale', async () => {
      const stalePrice = {
        symbol: 'BTC',
        price: 45000,
        timestamp: Date.now() - 600000, // 10 minutes ago
        source: 'pyth',
        confidence: 0.01
      };

      mockRuntime.cacheManager.get.mockResolvedValue(stalePrice);
      mockPublicClient.readContract.mockResolvedValue([
        BigInt('4600000000000'), // Updated price
        BigInt('10000000'),
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
      ]);

      const price = await oracleProvider.getPrice('BTC');

      expect(price?.price).toBe(46000); // Updated price
      expect(mockPublicClient.readContract).toHaveBeenCalled();
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
      mockPublicClient.readContract.mockResolvedValue([
        BigInt(0), // Invalid price
        BigInt('10000000'),
        BigInt(Date.now() / 1000),
        BigInt(Date.now() / 1000)
      ]);

      const price = await oracleProvider.getPrice('BTC');
      expect(price).toBeNull();
    });
  });
});
