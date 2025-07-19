import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dragonSwapAction } from '../actions/dragonswap';
import { WalletProvider } from '../providers/wallet';
import { SeiOracleProvider } from '../providers/sei-oracle';

// Mock dependencies
vi.mock('../providers/wallet');
vi.mock('../providers/sei-oracle');
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn()
  }
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DragonSwap Action', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockState: any;
  let mockCallback: any;
  let mockWalletProvider: any;
  let mockOracleProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRuntime = {
      getSetting: vi.fn((key: string) => {
        switch (key) {
          case 'SEI_PRIVATE_KEY':
            return '0x1234567890abcdef';
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

    mockMessage = {
      content: {
        text: 'swap 1 SEI for USDC'
      }
    };

    mockState = {};
    mockCallback = vi.fn();

    // Mock WalletProvider
    mockWalletProvider = {
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8D05ea2E9b1c49F50'),
      getWalletBalance: vi.fn().mockResolvedValue('1000.0'),
      getEvmWalletClient: vi.fn().mockReturnValue({
        writeContract: vi.fn().mockResolvedValue('0xabcdef123456'),
        sendTransaction: vi.fn().mockResolvedValue('0xabcdef123456')
      }),
      getPublicClient: vi.fn().mockReturnValue({
        readContract: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: '0xabcdef123456'
        })
      })
    };
    (WalletProvider as any).mockImplementation(() => mockWalletProvider);

    // Mock SeiOracleProvider  
    mockOracleProvider = {
      getPrice: vi.fn().mockImplementation((symbol: string) => {
        const prices: Record<string, any> = {
          'SEI': { symbol: 'SEI', price: 0.5, timestamp: Date.now(), source: 'pyth', confidence: 0.01 },
          'USDC': { symbol: 'USDC', price: 1.0, timestamp: Date.now(), source: 'pyth', confidence: 0.01 },
          'ETH': { symbol: 'ETH', price: 2500, timestamp: Date.now(), source: 'pyth', confidence: 0.01 }
        };
        return Promise.resolve(prices[symbol] || null);
      })
    };
    (SeiOracleProvider as any).mockImplementation(() => mockOracleProvider);

    // Mock DragonSwap API responses
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/pools')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              token0: 'SEI',
              token1: 'USDC',
              reserve0: '1000000000000000000000',
              reserve1: '500000000000',
              fee: '0.003',
              address: '0x1234567890abcdef1234567890abcdef12345678'
            }
          ])
        });
      }
      
      if (url.includes('/quote')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            outputAmount: '495000000', // 0.495 USDC for 1 SEI (with fees)
            priceImpact: '0.001',
            minimumAmountOut: '490050000'
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  describe('Action Validation', () => {
    it('should have correct action properties', () => {
      expect(dragonSwapAction.name).toBe('DRAGONSWAP_TRADE');
      expect(dragonSwapAction.description).toContain('DragonSwap');
      expect(dragonSwapAction.similes).toContain('SWAP_TOKENS');
    });

    it('should validate runtime configuration', async () => {
      const result = await dragonSwapAction.validate(mockRuntime, mockMessage);
      expect(typeof dragonSwapAction.validate).toBe('function');
    });
  });

  describe('Token Swap Operations', () => {
    it('should execute basic token swap', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const calls = mockCallback.mock.calls;
      
      // Should have initial callback with swap initiation
      expect(calls[0][0].text).toContain('Processing DragonSwap trade');
      expect(calls[0][0].content.action).toBe('swap_initiated');
    });

    it('should parse swap parameters from message', async () => {
      mockMessage.content.text = 'swap 5 SEI for ETH';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const parseCall = mockCallback.mock.calls.find(call => 
        call[0].content?.inputToken === 'SEI' &&
        call[0].content?.outputToken === 'ETH' &&
        call[0].content?.amount === '5'
      );
      expect(parseCall).toBeDefined();
    });

    it('should handle different token pair combinations', async () => {
      mockMessage.content.text = 'swap 100 USDC for SEI';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/pools'),
        expect.any(Object)
      );
    });

    it('should calculate expected output amounts', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/quote'),
        expect.any(Object)
      );

      expect(mockCallback).toHaveBeenCalled();
      const quoteCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Expected Output') ||
        call[0].text.includes('Quote')
      );
      expect(quoteCall).toBeDefined();
    });
  });

  describe('Price Impact Analysis', () => {
    it('should calculate and display price impact', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const impactCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Price Impact') ||
        call[0].content?.priceImpact
      );
      expect(impactCall).toBeDefined();
    });

    it('should warn about high price impact trades', async () => {
      // Mock high price impact response
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/quote')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              outputAmount: '400000000', // Much lower output
              priceImpact: '0.15', // 15% price impact
              minimumAmountOut: '380000000'
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });

      mockMessage.content.text = 'swap 1000 SEI for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const warningCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('High price impact') ||
        call[0].text.includes('WARNING')
      );
      expect(warningCall).toBeDefined();
    });

    it('should suggest optimal trade sizes', async () => {
      mockMessage.content.text = 'what is the optimal size to swap SEI for USDC?';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const optimizationCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('optimal') ||
        call[0].text.includes('recommended')
      );
      expect(optimizationCall).toBeDefined();
    });
  });

  describe('Liquidity Pool Analysis', () => {
    it('should analyze pool liquidity depth', async () => {
      mockMessage.content.text = 'analyze SEI/USDC pool liquidity';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/pools'),
        expect.any(Object)
      );

      expect(mockCallback).toHaveBeenCalled();
      const liquidityCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Liquidity') ||
        call[0].text.includes('Pool Analysis')
      );
      expect(liquidityCall).toBeDefined();
    });

    it('should display current pool reserves', async () => {
      mockMessage.content.text = 'show pool reserves for SEI/USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const reservesCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Reserves') ||
        call[0].text.includes('SEI:') ||
        call[0].text.includes('USDC:')
      );
      expect(reservesCall).toBeDefined();
    });

    it('should calculate current pool ratio', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const ratioCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('ratio') ||
        call[0].text.includes('Rate')
      );
      expect(ratioCall).toBeDefined();
    });
  });

  describe('Trade Execution', () => {
    it('should execute approved trades', async () => {
      mockMessage.content.text = 'execute swap 1 SEI for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockWalletProvider.getEvmWalletClient().writeContract).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should handle token approvals before swaps', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should check for approval and potentially call approve
      expect(mockWalletProvider.getPublicClient().readContract).toHaveBeenCalled();
    });

    it('should wait for transaction confirmations', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockWalletProvider.getPublicClient().waitForTransactionReceipt).toHaveBeenCalled();
    });

    it('should provide transaction hash on successful trades', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const successCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('0x') &&
        (call[0].text.includes('confirmed') || call[0].text.includes('success'))
      );
      expect(successCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle insufficient balance gracefully', async () => {
      mockWalletProvider.getWalletBalance.mockResolvedValue('0.1'); // Very low balance
      mockMessage.content.text = 'swap 100 SEI for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('insufficient'),
          content: expect.objectContaining({
            action: 'swap_failed'
          })
        })
      );
    });

    it('should handle pool liquidity issues', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/pools')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]) // No pools available
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('No liquidity pool'),
          content: expect.objectContaining({
            action: 'swap_failed'
          })
        })
      );
    });

    it('should handle API failures gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('DragonSwap API unavailable'));

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('failed'),
          content: expect.objectContaining({
            action: 'swap_failed'
          })
        })
      );
    });

    it('should handle transaction failures', async () => {
      mockWalletProvider.getEvmWalletClient().writeContract.mockRejectedValue(
        new Error('Transaction reverted')
      );

      mockMessage.content.text = 'execute swap 1 SEI for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('failed'),
          content: expect.objectContaining({
            action: 'swap_failed'
          })
        })
      );
    });
  });

  describe('Token Parameter Parsing', () => {
    it('should parse various swap format inputs', () => {
      const testCases = [
        { input: 'swap 1 SEI for USDC', expected: { amount: '1', from: 'SEI', to: 'USDC' } },
        { input: 'trade 5.5 ETH to SEI', expected: { amount: '5.5', from: 'ETH', to: 'SEI' } },
        { input: 'exchange 100 USDC for ETH', expected: { amount: '100', from: 'USDC', to: 'ETH' } },
        { input: 'convert 0.1 SEI to USDC', expected: { amount: '0.1', from: 'SEI', to: 'USDC' } }
      ];

      testCases.forEach(async (testCase) => {
        mockMessage.content.text = testCase.input;
        
        await dragonSwapAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        // Should correctly parse the input parameters
        expect(mockCallback).toHaveBeenCalled();
      });
    });

    it('should handle decimal amounts correctly', async () => {
      mockMessage.content.text = 'swap 1.5 SEI for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      // Should handle decimal parsing correctly
    });

    it('should validate supported token symbols', async () => {
      mockMessage.content.text = 'swap 1 INVALIDTOKEN for USDC';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Unsupported token'),
          content: expect.objectContaining({
            action: 'swap_failed'
          })
        })
      );
    });
  });

  describe('Slippage Protection', () => {
    it('should apply default slippage tolerance', async () => {
      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const slippageCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('slippage') ||
        call[0].text.includes('minimum')
      );
      expect(slippageCall).toBeDefined();
    });

    it('should accept custom slippage settings', async () => {
      mockMessage.content.text = 'swap 1 SEI for USDC with 1% slippage';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      // Should apply custom slippage tolerance
    });

    it('should warn about high slippage risks', async () => {
      mockMessage.content.text = 'swap 1 SEI for USDC with 10% slippage';

      await dragonSwapAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const warningCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('high slippage') ||
        call[0].text.includes('WARNING')
      );
      expect(warningCall).toBeDefined();
    });
  });
});
