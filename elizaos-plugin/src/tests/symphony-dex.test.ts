import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SymphonyDexProvider } from '../providers/symphony-dex';
import { DexAggregator } from '../providers/dex-aggregator';

describe('Symphony DEX Integration', () => {
  let symphonyProvider: SymphonyDexProvider;
  let dexAggregator: DexAggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    
    symphonyProvider = new SymphonyDexProvider({
      network: 'testnet',
      rpcUrl: 'https://evm-rpc-testnet.sei-apis.com'
    });

    dexAggregator = new DexAggregator({
      network: 'testnet',
      rpcUrl: 'https://evm-rpc-testnet.sei-apis.com'
    });
  });

  describe('Symphony Provider', () => {
    it('should get quote from Symphony', async () => {
      // Mock Symphony API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          amountOut: '95.5',
          priceImpact: '0.2',
          gasEstimate: '150000',
          route: []
        })
      });

      const quote = await symphonyProvider.getQuote(
        '0xtoken1',
        '0xtoken2',
        '100'
      );

      expect(quote.exchange).toBe('symphony');
      expect(quote.amountOut).toBe('95.5');
      expect(quote.priceImpact).toBe('0.2');
    });

    it('should handle Symphony API errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      });

      await expect(
        symphonyProvider.getQuote('0xtoken1', '0xtoken2', '100')
      ).rejects.toThrow('Symphony API error: 500');
    });
  });

  describe('DEX Aggregator', () => {
    it('should compare quotes from multiple DEXes', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ // DragonSwap response
          ok: true,
          json: () => Promise.resolve({
            amountOut: '95.0',
            priceImpact: '0.3'
          })
        })
        .mockResolvedValueOnce({ // Symphony response
          ok: true,
          json: () => Promise.resolve({
            amountOut: '96.0',
            priceImpact: '0.2'
          })
        });

      const result = await dexAggregator.getBestQuote(
        '0xtoken1',
        '0xtoken2',
        '100'
      );

      expect(result.bestQuote.exchange).toBe('symphony');
      expect(result.bestQuote.amountOut).toBe('96.0');
      expect(result.allQuotes).toHaveLength(2);
      expect(parseFloat(result.savings)).toBeGreaterThan(0);
    });

    it('should provide market analysis', async () => {
      global.fetch = vi.fn()
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            amountOut: '95.5',
            priceImpact: '0.2'
          })
        });

      const analysis = await dexAggregator.getMarketAnalysis(
        '0xtoken1',
        '0xtoken2',
        '100'
      );

      expect(analysis.bestPrice).toBeDefined();
      expect(analysis.priceComparison).toBeDefined();
      expect(analysis.liquidityAnalysis).toContain('liquidity');
      expect(analysis.recommendation).toBeDefined();
    });
  });
});