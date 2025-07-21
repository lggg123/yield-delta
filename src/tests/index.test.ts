import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import actions at the top level - no await needed if they're synchronous exports
import { fundingArbitrageAction } from '../actions/funding-arbitrage';
import { rebalanceEvaluatorAction } from '../actions/rebalance';

describe('Yield Delta Actions Integration Tests', () => {
  let mockRuntime: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure consistent runtime mocking
    mockRuntime = {
      getSetting: vi.fn((key: string) => {
        switch (key) {
          case 'SEI_PRIVATE_KEY':
            return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
          case 'SEI_NETWORK':
            return 'testnet';
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

    // Set environment variables as fallback
    process.env.SEI_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.SEI_NETWORK = 'testnet';
  });

  describe('Funding Arbitrage Action', () => {
    describe('Market Analysis', () => {
      it('should analyze funding rate trends', async () => {
        const mockMessage = {
          content: {
            text: 'analyze funding rate trends for BTC'
          }
        };
        const mockCallback = vi.fn();

        await fundingArbitrageAction.handler(
          mockRuntime,
          mockMessage,
          {},
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        
        const calls = mockCallback.mock.calls;
        const analysisCall = calls.find(call => 
          call[0].text && (
            call[0].text.includes('trend') ||
            call[0].text.includes('Funding Rate') ||
            call[0].text.includes('opportunities')
          )
        );
        expect(analysisCall).toBeDefined();
      });

      it('should identify optimal entry timing', async () => {
        const mockMessage = {
          content: {
            text: 'when should I enter funding arbitrage for ETH'
          }
        };
        const mockCallback = vi.fn();

        await fundingArbitrageAction.handler(
          mockRuntime,
          mockMessage,
          {},
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        
        const calls = mockCallback.mock.calls;
        const timingCall = calls.find(call => 
          call[0].text && (
            call[0].text.includes('Next Funding') ||
            call[0].text.includes('timing') ||
            call[0].text.includes('opportunities')
          )
        );
        expect(timingCall).toBeDefined();
      });
    });
  });

  describe('Portfolio Rebalance Action', () => {
    describe('Action Validation', () => {
      it('should validate runtime configuration', async () => {
        const mockMessage = {
          content: {
            text: 'rebalance my portfolio'
          }
        };

        const isValid = await rebalanceEvaluatorAction.validate(mockRuntime, mockMessage);
        expect(isValid).toBe(true);
      });
    });

    describe('Portfolio Analysis', () => {
      it('should analyze portfolio with default balanced strategy', async () => {
        const mockMessage = {
          content: {
            text: 'analyze my portfolio'
          }
        };
        const mockCallback = vi.fn();

        await rebalanceEvaluatorAction.handler(
          mockRuntime,
          mockMessage,
          {},
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        
        const calls = mockCallback.mock.calls;
        expect(calls[0][0]).toHaveProperty('text');
        expect(calls[0][0].text).toMatch(/(Analyzing portfolio|🔄)/i);
      });
    });
  });
});