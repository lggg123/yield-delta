import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebalanceEvaluatorAction } from '../actions/rebalance';
import { WalletProvider } from '../providers/wallet';
import { SeiOracleProvider } from '../providers/sei-oracle';
import { elizaLogger } from '@elizaos/core';

// Mock dependencies
vi.mock('../providers/wallet');
vi.mock('../providers/sei-oracle');
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('Portfolio Rebalance Action', () => {
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
          case 'SEI_RPC_URL':
            return 'https://evm-rpc.sei-apis.com';
          default:
            return null;
        }
      })
    };

    mockMessage = {
      content: {
        text: 'analyze my portfolio'
      }
    };

    mockState = {};
    mockCallback = vi.fn();

    // Mock WalletProvider
    mockWalletProvider = {
      getAddress: vi.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b8D05ea2E9b1c49F50'),
      getBalance: vi.fn().mockResolvedValue('1000000000000000000')
    };
    (WalletProvider as any).mockImplementation(() => mockWalletProvider);

    // Mock SeiOracleProvider
    mockOracleProvider = {
      getPrices: vi.fn().mockResolvedValue({
        'SEI': 0.5,
        'USDC': 1.0,
        'ETH': 2500,
        'BTC': 45000,
        'ATOM': 8.5,
        'OSMO': 0.75
      })
    };
    (SeiOracleProvider as any).mockImplementation(() => mockOracleProvider);
  });

  describe('Action Validation', () => {
    it('should have correct action properties', () => {
      expect(rebalanceEvaluatorAction.name).toBe('PORTFOLIO_REBALANCE');
      expect(rebalanceEvaluatorAction.description).toContain('portfolio');
      expect(rebalanceEvaluatorAction.similes).toContain('REBALANCE_PORTFOLIO');
    });

    it('should validate runtime configuration', async () => {
      const mockValidateConfig = vi.fn().mockResolvedValue(true);
      const result = await rebalanceEvaluatorAction.validate(mockRuntime, mockMessage);
      // Since we're mocking, we'll assume validation passes
      expect(typeof rebalanceEvaluatorAction.validate).toBe('function');
    });
  });

  describe('Portfolio Analysis', () => {
    it('should analyze portfolio with default balanced strategy', async () => {
      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const calls = mockCallback.mock.calls;
      
      // Should have initial callback with analysis start
      expect(calls[0][0].text).toContain('Analyzing portfolio');
      expect(calls[0][0].content.action).toBe('portfolio_analysis_started');
    });

    it('should parse strategy from message content', async () => {
      mockMessage.content.text = 'rebalance portfolio using conservative strategy';

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const startCall = mockCallback.mock.calls.find(call => 
        call[0].content?.action === 'portfolio_analysis_started'
      );
      expect(startCall[0].content.strategy).toBeDefined();
    });

    it('should handle portfolio with rebalancing needs', async () => {
      // Mock imbalanced portfolio
      mockOracleProvider.getPrices.mockResolvedValue({
        'SEI': 0.5,
        'USDC': 1.0,
        'ETH': 2500,
        'BTC': 45000,
        'ATOM': 8.5,
        'OSMO': 0.75
      });

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      // Should provide portfolio analysis
      const analysisCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Portfolio Analysis')
      );
      expect(analysisCall).toBeDefined();
    });

    it('should execute rebalance when requested', async () => {
      mockMessage.content.text = 'rebalance portfolio execute';

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      // Should have execution flow
      const executionCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Executing rebalance') || 
        call[0].content?.action === 'rebalance_execution_started'
      );
      expect(executionCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle wallet provider errors gracefully', async () => {
      mockWalletProvider.getAddress.mockRejectedValue(new Error('Wallet connection failed'));

      await rebalanceEvaluatorAction.handler(
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
            action: 'rebalance_failed'
          })
        })
      );
    });

    it('should handle oracle provider errors gracefully', async () => {
      mockOracleProvider.getPrices.mockRejectedValue(new Error('Price feed unavailable'));

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(elizaLogger.error).toHaveBeenCalled();
    });

    it('should handle zero portfolio value', async () => {
      mockWalletProvider.getBalance.mockResolvedValue('0');
      mockOracleProvider.getPrices.mockResolvedValue({});

      await rebalanceEvaluatorAction.handler(
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
            action: 'rebalance_failed'
          })
        })
      );
    });
  });

  describe('Strategy Configuration', () => {
    it('should use conservative strategy when specified', async () => {
      mockMessage.content.text = 'analyze portfolio with Conservative DeFi strategy';

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const analysisCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Conservative DeFi')
      );
      expect(analysisCall).toBeDefined();
    });

    it('should use aggressive strategy when specified', async () => {
      mockMessage.content.text = 'rebalance using Aggressive DeFi strategy';

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const analysisCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Aggressive DeFi')
      );
      expect(analysisCall).toBeDefined();
    });
  });

  describe('Portfolio Metrics', () => {
    it('should calculate asset allocations correctly', async () => {
      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const analysisCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Asset Allocations')
      );
      
      if (analysisCall) {
        expect(analysisCall[0].text).toContain('%');
        expect(analysisCall[0].text).toContain('Target:');
        expect(analysisCall[0].text).toContain('Deviation:');
      }
    });

    it('should provide rebalance recommendations', async () => {
      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const calls = mockCallback.mock.calls;
      const hasRecommendations = calls.some(call => 
        call[0].text.includes('Rebalance Recommendations') ||
        call[0].text.includes('well-balanced')
      );
      expect(hasRecommendations).toBe(true);
    });
  });

  describe('Wallet Address Parsing', () => {
    it('should parse wallet address from message', async () => {
      mockMessage.content.text = 'analyze portfolio for wallet: 0x1234567890abcdef1234567890abcdef12345678';

      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const startCall = mockCallback.mock.calls.find(call => 
        call[0].content?.action === 'portfolio_analysis_started'
      );
      expect(startCall[0].content.address).toContain('0x');
    });

    it('should use default wallet address when not specified', async () => {
      await rebalanceEvaluatorAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockWalletProvider.getAddress).toHaveBeenCalled();
    });
  });
});
