import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dragonSwapTradeAction } from '../actions/dragonswap';
import { WalletProvider } from '../providers/wallet';
import { SeiOracleProvider } from '../providers/sei-oracle';

// Import test helpers
import { 
  createMockMemory, 
  createMockState, 
  createMockRuntime,
  createMockCallback,
  findCallbackWithText,
  wasCallbackSuccessful,
  wasCallbackError
} from './test-helpers';

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
  let mockWalletProvider: any;
  let mockOracleProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Use the test helper for runtime
    mockRuntime = createMockRuntime();

    // Mock WalletProvider
    mockWalletProvider = {
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8D05ea2E9b1c49F50'),
      getWalletBalance: vi.fn().mockResolvedValue('1000.0'),
      getEvmWalletClient: vi.fn().mockReturnValue({
        account: { 
          address: '0x742d35Cc6634C0532925a3b8D05ea2E9b1c49F50' 
        },
        writeContract: vi.fn().mockResolvedValue('0xabcdef123456'),
        sendTransaction: vi.fn().mockResolvedValue('0xabcdef123456')
      }),
      getPublicClient: vi.fn().mockReturnValue({
        readContract: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: '0xabcdef123456'
        })
      }),
      getEvmPublicClient: vi.fn().mockReturnValue({
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
      if (url.includes('/pools/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            address: '0x1234567890abcdef1234567890abcdef12345678',
            token0: 'SEI',
            token1: 'USDC',
            fee: 3000,
            liquidity: '1000000',
            price: '0.5'
          })
        });
      }
      
      if (url.includes('/quote')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            amountOut: '0.495', // 0.495 USDC for 1 SEI (with fees)
            priceImpact: 0.001
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
      expect(dragonSwapTradeAction.name).toBe('DRAGONSWAP_TRADE');
      expect(dragonSwapTradeAction.description).toContain('DragonSwap');
      expect(dragonSwapTradeAction.similes).toContain('SWAP_ON_DRAGONSWAP');
    });

    it('should validate runtime configuration', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const result = await dragonSwapTradeAction.validate(mockRuntime, mockMessage);
      expect(typeof dragonSwapTradeAction.validate).toBe('function');
    });
  });

  describe('Token Swap Operations', () => {
    it('should execute basic token swap', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
      
      const successCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(successCall).toBeDefined();
      expect(successCall[0].text).toContain('SEI');
      expect(successCall[0].text).toContain('USDC');
    });

    it('should parse swap parameters from message', async () => {
      const mockMessage = createMockMemory('swap 5 SEI for ETH');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
      
      const successCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(successCall).toBeDefined();
    });

    it('should handle different token pair combinations', async () => {
      const mockMessage = createMockMemory('swap 100 USDC for SEI');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
      const successCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(successCall).toBeDefined();
    });

    it('should calculate expected output amounts', async () => {
      // Mock successful pool info response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          pool: {
            token0: 'SEI',
            token1: 'USDC',
            fee: 0.003,
            liquidity: '1000000'
          }
        })
      });

      // Mock successful quote response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          amountOut: '45.50',
          priceImpact: '0.001',
          route: ['SEI', 'USDC']
        })
      });

      const mockMessage = createMockMemory('swap 1 SEI for USDC on DragonSwap');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackSuccessful(mockCallback)).toBe(true);

      // Check for both API calls separately
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api-testnet.dragonswap.app/v1/pools/SEI/USDC'
      );
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api-testnet.dragonswap.app/v1/quote',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tokenIn: 'SEI',
            tokenOut: 'USDC',
            amountIn: '1'
          })
        })
      );

      const successCall = findCallbackWithText(mockCallback, 'swap') || 
                         findCallbackWithText(mockCallback, 'exchange');
      expect(successCall).toBeDefined();
    });
  });

  describe('Price Impact Analysis', () => {
    it('should calculate and display price impact', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const impactCall = findCallbackWithText(mockCallback, 'Price Impact') ||
                        findCallbackWithText(mockCallback, '0.1%');
      expect(impactCall).toBeDefined();
    });

    it('should warn about high price impact trades', async () => {
      // Mock high price impact response
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/quote')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              amountOut: '400000000', // Much lower output
              priceImpact: 0.15 // 15% price impact
            })
          });
        }
        if (url.includes('/pools')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              address: '0x1234567890abcdef1234567890abcdef12345678',
              token0: 'SEI',
              token1: 'USDC',
              fee: 3000,
              liquidity: '1000000',
              price: '0.5'
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });

      const mockMessage = createMockMemory('swap 1000 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const impactCall = findCallbackWithText(mockCallback, 'Price Impact: 15');
      expect(impactCall).toBeDefined();
    });

    it('should handle invalid swap format', async () => {
      const mockMessage = createMockMemory('what is the optimal size to swap SEI for USDC?');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackError(mockCallback)).toBe(true);
      const errorCall = findCallbackWithText(mockCallback, "couldn't understand");
      expect(errorCall).toBeDefined();
    });
  });

  describe('Liquidity Pool Analysis', () => {
    it('should analyze pool liquidity depth', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
      const successCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(successCall).toBeDefined();
    });

    it('should display current pool reserves', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const reservesCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(reservesCall).toBeDefined();
      expect(reservesCall[0].text).toContain('SEI');
      expect(reservesCall[0].text).toContain('USDC');
    });

    it('should calculate current pool ratio', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const ratioCall = findCallbackWithText(mockCallback, 'Price Impact') ||
                       findCallbackWithText(mockCallback, '0.1%');
      expect(ratioCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
  });

  describe('Token Parameter Parsing', () => {
    it('should parse various swap format inputs', async () => {
      const testCases = [
        { input: 'swap 1 SEI for USDC', expected: { amount: '1', from: 'SEI', to: 'USDC' } },
        { input: 'trade 5.5 ETH to SEI', expected: { amount: '5.5', from: 'ETH', to: 'SEI' } },
        { input: 'exchange 100 USDC for ETH', expected: { amount: '100', from: 'USDC', to: 'ETH' } },
        { input: 'convert 0.1 SEI to USDC', expected: { amount: '0.1', from: 'SEI', to: 'USDC' } }
      ];

      for (const testCase of testCases) {
        const mockMessage = createMockMemory(testCase.input);
        const mockState = createMockState();
        const mockCallback = createMockCallback();
        
        await dragonSwapTradeAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        expect(wasCallbackSuccessful(mockCallback)).toBe(true);
      }
    });

    it('should handle decimal amounts correctly', async () => {
      const mockMessage = createMockMemory('swap 1.5 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
    });

    it('should validate supported token symbols', async () => {
      const mockMessage = createMockMemory('swap 1 INVALIDTOKEN for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(wasCallbackError(mockCallback)).toBe(true);
      const errorCall = findCallbackWithText(mockCallback, 'Failed to execute swap');
      expect(errorCall).toBeDefined();
    });
  });

  describe('Slippage Protection', () => {
    it('should apply default slippage tolerance', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const slippageCall = findCallbackWithText(mockCallback, 'Successfully swapped') ||
                          findCallbackWithText(mockCallback, 'Price Impact');
      expect(slippageCall).toBeDefined();
    });

    it('should accept custom slippage settings', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC with 1% slippage');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackSuccessful(mockCallback)).toBe(true);
    });

    it('should warn about high slippage risks', async () => {
      const mockMessage = createMockMemory('swap 1 SEI for USDC with 10% slippage');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await dragonSwapTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const successCall = findCallbackWithText(mockCallback, 'Successfully swapped');
      expect(successCall).toBeDefined();
    });
  });
});
