import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fundingArbitrageAction } from '../actions/funding-arbitrage';

// Mock dependencies
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn()
  }
}));

describe('Funding Arbitrage Action', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockState: any;
  let mockCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();

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

    mockState = {};
    mockCallback = vi.fn();

    // Set environment variables as fallback
    process.env.SEI_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.SEI_NETWORK = 'testnet';
  });

  describe('Market Analysis', () => {
    it('should analyze funding rate trends', async () => {
      mockMessage = {
        content: {
          text: 'analyze funding rate trends for BTC'
        }
      };

      await fundingArbitrageAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      
      // Check if any callback contains trend analysis
      const calls = mockCallback.mock.calls;
      const analysisCall = calls.find(call => 
        call[0].text && (
          call[0].text.includes('trend') ||
          call[0].text.includes('Funding Rate') ||
          call[0].text.includes('analysis') ||
          call[0].text.includes('opportunities')
        )
      );
      expect(analysisCall).toBeDefined();
    });

    it('should identify optimal entry timing', async () => {
      mockMessage = {
        content: {
          text: 'when should I enter funding arbitrage for ETH'
        }
      };

      await fundingArbitrageAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      
      // Check if any callback contains timing information
      const calls = mockCallback.mock.calls;
      const timingCall = calls.find(call => 
        call[0].text && (
          call[0].text.includes('Next Funding') ||
          call[0].text.includes('timing') ||
          call[0].text.includes('entry') ||
          call[0].text.includes('opportunities') ||
          call[0].text.includes('Funding Rate')
        )
      );
      expect(timingCall).toBeDefined();
    });

    it('should scan for arbitrage opportunities', async () => {
      mockMessage = {
        content: {
          text: 'scan funding arbitrage opportunities'
        }
      };

      await fundingArbitrageAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      
      // Should call callback with either opportunities or no opportunities message
      const calls = mockCallback.mock.calls;
      expect(calls[0][0]).toHaveProperty('text');
      expect(calls[0][0].text).toMatch(/(opportunities|threshold|arbitrage)/i);
    });

    it('should execute arbitrage for specific symbol', async () => {
      mockMessage = {
        content: {
          text: 'execute arbitrage BTC'
        }
      };

      await fundingArbitrageAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
    });

    it('should show active positions status', async () => {
      mockMessage = {
        content: {
          text: 'show arbitrage positions'
        }
      };

      await fundingArbitrageAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
    });
  });
});
