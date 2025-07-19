import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { elizaLogger } from '@elizaos/core';
import { dragonSwapTradeAction } from '../src/actions/dragonswap';
import { validateSeiConfig } from '../src/environment';
import { WalletProvider } from '../src/providers/wallet';

// Mock dependencies
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/environment', () => ({
  validateSeiConfig: vi.fn(),
}));

vi.mock('../src/providers/wallet', () => ({
  WalletProvider: vi.fn(),
  seiChains: {
    mainnet: { id: 1329, name: 'SEI Mainnet' },
    testnet: { id: 713715, name: 'SEI Testnet' },
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('DragonSwap Action', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockState: any;
  let mockCallback: Mock;
  let mockWalletProvider: any;
  let mockWalletClient: any;
  let mockPublicClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock wallet clients
    mockWalletClient = {
      account: {
        address: '0x1234567890123456789012345678901234567890',
      },
      sendTransaction: vi.fn().mockResolvedValue('0xmocktxhash'),
    };

    mockPublicClient = {
      readContract: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 token allowance
    };

    mockWalletProvider = {
      getEvmWalletClient: vi.fn().mockReturnValue(mockWalletClient),
      getEvmPublicClient: vi.fn().mockReturnValue(mockPublicClient),
    };

    (WalletProvider as Mock).mockImplementation(() => mockWalletProvider);

    // Setup mock runtime and message
    mockRuntime = {
      cacheManager: {},
    };

    mockMessage = {
      content: {
        text: 'Swap 10 SEI for USDC on DragonSwap',
      },
    };

    mockState = {};
    mockCallback = vi.fn();

    // Mock config validation
    (validateSeiConfig as Mock).mockResolvedValue({
      SEI_PRIVATE_KEY: '0x1234567890123456789012345678901234567890123456789012345678901234',
      SEI_NETWORK: 'testnet',
    });
  });

  describe('Validation', () => {
    it('should validate messages with swap intent and dragonswap mention', async () => {
      const validMessages = [
        'Swap 10 SEI for USDC on DragonSwap',
        'Trade 5 USDC for SEI using dragon swap',
        'Exchange tokens on dragonswap with SEI',
      ];

      for (const text of validMessages) {
        const message = { content: { text } };
        const result = await dragonSwapTradeAction.validate!(mockRuntime, message as any);
        expect(result).toBe(true);
      }
    });

    it('should reject messages without proper intent', async () => {
      const invalidMessages = [
        'Hello there',
        'Check my balance',
        'Swap on Uniswap', // Wrong DEX
        'Trade without mentioning dragon',
      ];

      for (const text of invalidMessages) {
        const message = { content: { text } };
        const result = await dragonSwapTradeAction.validate!(mockRuntime, message as any);
        expect(result).toBe(false);
      }
    });
  });

  describe('Handler', () => {
    beforeEach(() => {
      // Mock successful API responses
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            address: '0xpool',
            token0: 'SEI',
            token1: 'USDC',
            fee: 3000,
            liquidity: '1000000',
            price: '0.5',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            amountOut: '5.0',
            priceImpact: 0.1,
          }),
        });
    });

    it('should execute successful swap', async () => {
      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('✅ Successfully swapped'),
      });

      expect(mockWalletClient.sendTransaction).toHaveBeenCalled();
    });

    it('should handle invalid trade parameters', async () => {
      mockMessage.content.text = 'Invalid message without proper format';

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining("couldn't understand the trade parameters"),
        error: true,
      });
    });

    it('should handle pool not found', async () => {
      // Mock pool not found
      (global.fetch as Mock).mockReset().mockResolvedValueOnce({
        ok: false,
      });

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('No liquidity pool found'),
        error: true,
      });
    });

    it('should handle quote failure', async () => {
      // Mock successful pool info but failed quote
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            address: '0xpool',
            token0: 'SEI',
            token1: 'USDC',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('Could not get price quote'),
        error: true,
      });
    });

    it('should handle transaction failure', async () => {
      // Mock successful API calls but failed transaction
      mockWalletClient.sendTransaction.mockRejectedValue(new Error('Transaction failed'));

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('Error executing trade'),
        error: true,
      });
    });
  });

  describe('Parameter Parsing', () => {
    // Import the parseTradeParams function for testing
    // Since it's not exported, we'll test it through the handler
    
    it('should parse basic swap parameters', async () => {
      const testCases = [
        {
          input: 'Swap 10 SEI for USDC on DragonSwap',
          expected: { tokenIn: 'SEI', tokenOut: 'USDC', amountIn: '10' },
        },
        {
          input: 'Trade 5.5 USDC for SEI using DragonSwap',
          expected: { tokenIn: 'USDC', tokenOut: 'SEI', amountIn: '5.5' },
        },
        {
          input: 'Exchange 100 TOKEN1 for TOKEN2 on dragon',
          expected: { tokenIn: 'TOKEN1', tokenOut: 'TOKEN2', amountIn: '100' },
        },
      ];

      for (const testCase of testCases) {
        mockMessage.content.text = testCase.input;

        await dragonSwapTradeAction.handler!(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        // Verify the API was called with correct parameters
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`pools/${testCase.expected.tokenIn}/${testCase.expected.tokenOut}`)
        );
      }
    });

    it('should parse slippage parameters', async () => {
      mockMessage.content.text = 'Swap 10 SEI for USDC on DragonSwap with 2% slippage';

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should still process the swap
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Token Approval', () => {
    it('should skip approval for native SEI', async () => {
      // Native SEI swap shouldn't call approve
      mockMessage.content.text = 'Swap 10 SEI for USDC on DragonSwap';

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should only have one sendTransaction call (the swap itself)
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('should handle token approval for ERC-20 tokens', async () => {
      // ERC-20 token swap should call approve first
      mockMessage.content.text = 'Swap 10 USDC for SEI on DragonSwap';
      
      // Mock insufficient allowance
      mockPublicClient.readContract.mockResolvedValue(BigInt('0'));

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should have two sendTransaction calls (approve + swap)
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledTimes(2);
    });

    it('should skip approval if sufficient allowance exists', async () => {
      mockMessage.content.text = 'Swap 10 USDC for SEI on DragonSwap';
      
      // Mock sufficient allowance
      mockPublicClient.readContract.mockResolvedValue(BigInt('1000000000000000000000')); // Large allowance

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should only have one sendTransaction call (the swap itself)
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle wallet connection errors', async () => {
      mockWalletClient.account = null;

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('Error executing trade'),
        error: true,
      });
    });

    it('should handle network errors', async () => {
      (global.fetch as Mock).mockRejectedValue(new Error('Network error'));

      await dragonSwapTradeAction.handler!(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('Error executing trade'),
        error: true,
      });
    });
  });
});

describe('DragonSwapAPI Unit Tests', () => {
  // Since DragonSwapAPI is not exported, we'll create a separate file for it
  // or export it for testing purposes
  
  it('should be tested separately in api tests', () => {
    // Placeholder for API-specific tests
    expect(true).toBe(true);
  });
});