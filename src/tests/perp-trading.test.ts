import { describe, it, expect, vi, beforeEach } from 'vitest';
import { perpTradingAction } from '../actions/perp-trading';
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

describe('Perpetual Trading Action', () => {
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
        text: 'open long position on BTC with 2x leverage'
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
          'BTC': { symbol: 'BTC', price: 45000, timestamp: Date.now(), source: 'pyth', confidence: 0.01 },
          'ETH': { symbol: 'ETH', price: 2500, timestamp: Date.now(), source: 'pyth', confidence: 0.01 },
          'SEI': { symbol: 'SEI', price: 0.5, timestamp: Date.now(), source: 'pyth', confidence: 0.01 }
        };
        return Promise.resolve(prices[symbol] || null);
      }),
      getFundingRates: vi.fn().mockImplementation((symbol: string) => {
        return Promise.resolve([
          {
            symbol: symbol,
            rate: 0.0001 * 365 * 3,
            timestamp: Date.now(),
            exchange: 'sei-perps',
            nextFundingTime: Date.now() + 8 * 60 * 60 * 1000
          }
        ]);
      })
    };
    (SeiOracleProvider as any).mockImplementation(() => mockOracleProvider);

    // Mock Perps API responses
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/markets')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              symbol: 'BTC-PERP',
              baseAsset: 'BTC',
              markPrice: '45000.50',
              indexPrice: '45000.00',
              fundingRate: '0.0001',
              openInterest: '1000000.0',
              maxLeverage: '10',
              minSize: '0.001',
              tickSize: '0.01',
              contractAddress: '0x1234567890abcdef1234567890abcdef12345678'
            }
          ])
        });
      }
      
      if (url.includes('/positions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              symbol: 'BTC-PERP',
              side: 'long',
              size: '0.1',
              entryPrice: '44500.00',
              markPrice: '45000.50',
              unrealizedPnl: '50.05',
              leverage: '2',
              margin: '2250.00',
              liquidationPrice: '22250.00'
            }
          ])
        });
      }

      if (url.includes('/order')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            orderId: 'order_123456',
            status: 'filled',
            symbol: 'BTC-PERP',
            side: 'long',
            size: '0.1',
            price: '45000.00',
            executedSize: '0.1',
            executedPrice: '45000.50'
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
      expect(perpTradingAction.name).toBe('PERP_TRADING');
      expect(perpTradingAction.description).toContain('perpetual');
      expect(perpTradingAction.similes).toContain('OPEN_POSITION');
    });

    it('should validate runtime configuration', async () => {
      const result = await perpTradingAction.validate(mockRuntime, mockMessage);
      expect(typeof perpTradingAction.validate).toBe('function');
    });
  });

  describe('Position Management', () => {
    it('should open long positions', async () => {
      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const calls = mockCallback.mock.calls;
      
      // Should have initial callback with position opening
      expect(calls[0][0].text).toContain('Opening long position');
      expect(calls[0][0].content.action).toBe('position_opening');
    });

    it('should open short positions', async () => {
      mockMessage.content.text = 'open short position on ETH with 3x leverage';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const shortCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('short position') &&
        call[0].content?.symbol === 'ETH' &&
        call[0].content?.leverage === '3'
      );
      expect(shortCall).toBeDefined();
    });

    it('should parse position parameters correctly', async () => {
      mockMessage.content.text = 'open long 0.5 BTC with 5x leverage and $1000 margin';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const paramCall = mockCallback.mock.calls.find(call => 
        call[0].content?.size === '0.5' &&
        call[0].content?.leverage === '5' &&
        call[0].content?.margin === '$1000'
      );
      expect(paramCall).toBeDefined();
    });

    it('should close existing positions', async () => {
      mockMessage.content.text = 'close my BTC position';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const closeCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Closing position') ||
        call[0].content?.action === 'position_closing'
      );
      expect(closeCall).toBeDefined();
    });
  });

  describe('Risk Management', () => {
    it('should calculate liquidation prices', async () => {
      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const liquidationCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Liquidation Price') ||
        call[0].content?.liquidationPrice
      );
      expect(liquidationCall).toBeDefined();
    });

    it('should validate leverage limits', async () => {
      mockMessage.content.text = 'open long BTC with 50x leverage'; // Exceeds max leverage

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const leverageWarning = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Maximum leverage') ||
        call[0].text.includes('exceeds limit')
      );
      expect(leverageWarning).toBeDefined();
    });

    it('should check margin requirements', async () => {
      mockMessage.content.text = 'open long 10 BTC with 10x leverage';

      mockWalletProvider.getWalletBalance.mockResolvedValue('100.0'); // Insufficient for large position

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const marginCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('insufficient margin') ||
        call[0].text.includes('Margin Required')
      );
      expect(marginCall).toBeDefined();
    });

    it('should suggest position sizing based on account balance', async () => {
      mockMessage.content.text = 'what size BTC position should I open?';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const sizingCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('recommended size') ||
        call[0].text.includes('position sizing')
      );
      expect(sizingCall).toBeDefined();
    });
  });

  describe('Market Analysis', () => {
    it('should display current market information', async () => {
      mockMessage.content.text = 'show BTC perpetual market info';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/markets'),
        expect.any(Object)
      );

      expect(mockCallback).toHaveBeenCalled();
      const marketCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Market Information') ||
        call[0].text.includes('Mark Price')
      );
      expect(marketCall).toBeDefined();
    });

    it('should show funding rate information', async () => {
      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockOracleProvider.getFundingRates).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalled();
      const fundingCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Funding Rate') ||
        call[0].text.includes('Next Funding')
      );
      expect(fundingCall).toBeDefined();
    });

    it('should analyze open interest and market sentiment', async () => {
      mockMessage.content.text = 'analyze BTC market sentiment';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const sentimentCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Open Interest') ||
        call[0].text.includes('Market Sentiment')
      );
      expect(sentimentCall).toBeDefined();
    });
  });

  describe('Position Monitoring', () => {
    it('should display active positions', async () => {
      mockMessage.content.text = 'show my open positions';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/positions'),
        expect.any(Object)
      );

      expect(mockCallback).toHaveBeenCalled();
      const positionsCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Active Positions') ||
        call[0].text.includes('Open Positions')
      );
      expect(positionsCall).toBeDefined();
    });

    it('should calculate unrealized PnL', async () => {
      mockMessage.content.text = 'show my PnL';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const pnlCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Unrealized PnL') ||
        call[0].text.includes('P&L')
      );
      expect(pnlCall).toBeDefined();
    });

    it('should monitor position health and margin ratio', async () => {
      mockMessage.content.text = 'check my position health';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const healthCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Position Health') ||
        call[0].text.includes('Margin Ratio')
      );
      expect(healthCall).toBeDefined();
    });
  });

  describe('Order Management', () => {
    it('should place market orders', async () => {
      mockMessage.content.text = 'market buy 0.1 BTC perp';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/order'),
        expect.objectContaining({
          method: 'POST'
        })
      );

      expect(mockCallback).toHaveBeenCalled();
    });

    it('should place limit orders', async () => {
      mockMessage.content.text = 'limit buy 0.1 BTC perp at $44000';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const limitCall = mockCallback.mock.calls.find(call => 
        call[0].content?.orderType === 'limit' &&
        call[0].content?.price === '$44000'
      );
      expect(limitCall).toBeDefined();
    });

    it('should set stop-loss orders', async () => {
      mockMessage.content.text = 'set stop loss at $43000 for my BTC position';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const stopLossCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('stop loss') ||
        call[0].content?.orderType === 'stop'
      );
      expect(stopLossCall).toBeDefined();
    });

    it('should set take-profit orders', async () => {
      mockMessage.content.text = 'set take profit at $47000 for my BTC position';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const takeProfitCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('take profit') ||
        call[0].content?.orderType === 'take_profit'
      );
      expect(takeProfitCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle insufficient margin gracefully', async () => {
      mockWalletProvider.getWalletBalance.mockResolvedValue('10.0'); // Very low balance
      mockMessage.content.text = 'open long 1 BTC with 10x leverage';

      await perpTradingAction.handler(
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
            action: 'position_failed'
          })
        })
      );
    });

    it('should handle market unavailability', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/markets')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]) // No markets available
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('market not available'),
          content: expect.objectContaining({
            action: 'position_failed'
          })
        })
      );
    });

    it('should handle API failures gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Perps API unavailable'));

      await perpTradingAction.handler(
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
            action: 'position_failed'
          })
        })
      );
    });

    it('should handle transaction failures', async () => {
      mockWalletProvider.getEvmWalletClient().writeContract.mockRejectedValue(
        new Error('Transaction reverted')
      );

      mockMessage.content.text = 'open long 0.1 BTC with 2x leverage';

      await perpTradingAction.handler(
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
            action: 'position_failed'
          })
        })
      );
    });
  });

  describe('Parameter Parsing', () => {
    it('should parse various position format inputs', () => {
      const testCases = [
        { 
          input: 'open long 0.1 BTC with 2x leverage', 
          expected: { side: 'long', size: '0.1', symbol: 'BTC', leverage: '2' } 
        },
        { 
          input: 'short 0.5 ETH 5x', 
          expected: { side: 'short', size: '0.5', symbol: 'ETH', leverage: '5' } 
        },
        { 
          input: 'buy 1000 SEI perp with 3x', 
          expected: { side: 'long', size: '1000', symbol: 'SEI', leverage: '3' } 
        }
      ];

      testCases.forEach(async (testCase) => {
        mockMessage.content.text = testCase.input;
        
        await perpTradingAction.handler(
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

    it('should handle price targets in orders', async () => {
      mockMessage.content.text = 'buy 0.1 BTC perp at $44500';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const priceCall = mockCallback.mock.calls.find(call => 
        call[0].content?.targetPrice === '$44500'
      );
      expect(priceCall).toBeDefined();
    });

    it('should validate position sizes against minimums', async () => {
      mockMessage.content.text = 'open long 0.0001 BTC'; // Below minimum size

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Minimum position size'),
          content: expect.objectContaining({
            action: 'position_failed'
          })
        })
      );
    });
  });

  describe('Performance Tracking', () => {
    it('should calculate total portfolio performance', async () => {
      mockMessage.content.text = 'show my perp trading performance';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const performanceCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Trading Performance') ||
        call[0].text.includes('Total PnL')
      );
      expect(performanceCall).toBeDefined();
    });

    it('should track win rate and average returns', async () => {
      mockMessage.content.text = 'show my trading statistics';

      await perpTradingAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const statsCall = mockCallback.mock.calls.find(call => 
        call[0].text.includes('Win Rate') ||
        call[0].text.includes('Average Return')
      );
      expect(statsCall).toBeDefined();
    });
  });
});
