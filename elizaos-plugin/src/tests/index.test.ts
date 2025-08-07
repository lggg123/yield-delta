import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import test helpers
import { 
  createMockMemory, 
  createMockState, 
  createMockRuntime,
  createMockCallback,
  findCallbackWithText,
  wasCallbackSuccessful,
  setupGlobalFetchMock
} from './test-helpers';

// Import actions
import { fundingArbitrageAction } from '../actions/funding-arbitrage';
import { rebalanceEvaluatorAction } from '../actions/rebalance';
import { WalletProvider } from '../providers/wallet';
import { SeiOracleProvider } from '../providers/sei-oracle';

// Mock external dependencies
vi.mock('../providers/wallet');
vi.mock('../providers/sei-oracle');
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn()
  },
  composeContext: vi.fn(() => 'mock context'),
  generateObjectDeprecated: vi.fn(() => ({}))
}));

describe('Yield Delta Actions Integration Tests', () => {
  let mockRuntime: any;
  let mockWalletProvider: any;
  let mockOracleProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalFetchMock(); // Set up comprehensive fetch mocking
    mockRuntime = createMockRuntime();
    
    // Set environment variables as fallback
    process.env.SEI_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.SEI_NETWORK = 'sei-testnet';

    // Mock WalletProvider with comprehensive methods
    mockWalletProvider = {
      getAddress: vi.fn().mockResolvedValue('0xBFC122e34B01a0875301814958D0f47cA4153d7c'),
      getWalletBalance: vi.fn().mockResolvedValue('1000.0'),
      getEvmWalletClient: vi.fn().mockReturnValue({
        account: { 
          address: '0xBFC122e34B01a0875301814958D0f47cA4153d7c' 
        },
        writeContract: vi.fn().mockResolvedValue('0xabcdef123456'),
        sendTransaction: vi.fn().mockResolvedValue('0xabcdef123456')
      }),
      getPublicClient: vi.fn().mockReturnValue({
        readContract: vi.fn().mockImplementation(({ functionName }) => {
          switch (functionName) {
            case 'queryPriceFeed':
              return Promise.resolve([BigInt('50000000'), BigInt(Date.now())]);
            case 'balanceOf':
              return Promise.resolve(BigInt('1000000000000000000'));
            default:
              return Promise.resolve(BigInt('0'));
          }
        }),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: '0xabcdef123456'
        })
      }),
      getEvmPublicClient: vi.fn().mockReturnValue({
        readContract: vi.fn().mockImplementation(({ functionName }) => {
          switch (functionName) {
            case 'queryPriceFeed':
              return Promise.resolve([BigInt('50000000'), BigInt(Date.now())]);
            case 'balanceOf':
              return Promise.resolve(BigInt('1000000000000000000'));
            default:
              return Promise.resolve(BigInt('0'));
          }
        }),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: '0xabcdef123456'
        })
      }),
      // Add cache methods for test environment
      readFromCache: vi.fn().mockResolvedValue(null),
      writeToCache: vi.fn().mockResolvedValue(undefined)
    };
    (WalletProvider as any).mockImplementation(() => mockWalletProvider);

    // Mock SeiOracleProvider with all required methods
    mockOracleProvider = {
      getPrice: vi.fn().mockImplementation((symbol: string) => {
        const prices: Record<string, any> = {
          'SEI': { symbol: 'SEI', price: 0.5, timestamp: Date.now(), source: 'mock', confidence: 0.01 },
          'USDC': { symbol: 'USDC', price: 1.0, timestamp: Date.now(), source: 'mock', confidence: 0.01 },
          'ETH': { symbol: 'ETH', price: 2500, timestamp: Date.now(), source: 'mock', confidence: 0.01 }
        };
        return Promise.resolve(prices[symbol] || null);
      }),
      getPythPrice: vi.fn().mockResolvedValue({ price: 0.5, confidence: 0.01 }),
      getChainlinkPrice: vi.fn().mockResolvedValue({ price: 0.5, timestamp: Date.now() }),
      validatePriceData: vi.fn().mockReturnValue(true),
      formatPrice: vi.fn().mockImplementation((price: number) => price.toString())
    };
    (SeiOracleProvider as any).mockImplementation(() => mockOracleProvider);
  });

  describe('Funding Arbitrage Action', () => {
    describe('Market Analysis', () => {
      it('should analyze funding rate trends', async () => {
        const mockMessage = createMockMemory('analyze funding rate trends for BTC');
        const mockState = createMockState();
        const mockCallback = createMockCallback();

        await fundingArbitrageAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        
        const analysisCall = findCallbackWithText(mockCallback, 'trend') ||
                           findCallbackWithText(mockCallback, 'Funding Rate') ||
                           findCallbackWithText(mockCallback, 'opportunities');
        
        expect(analysisCall).toBeDefined();
      });

      it('should identify optimal entry timing', async () => {
        const mockMessage = createMockMemory('when should I enter funding arbitrage for ETH');
        const mockState = createMockState();
        const mockCallback = createMockCallback();

        await fundingArbitrageAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        
        const timingCall = findCallbackWithText(mockCallback, 'Next Funding') ||
                          findCallbackWithText(mockCallback, 'timing') ||
                          findCallbackWithText(mockCallback, 'opportunities');
        
        expect(timingCall).toBeDefined();
      });
    });
  });

  describe('Portfolio Rebalance Action', () => {
    describe('Action Validation', () => {
      it('should validate runtime configuration', async () => {
        const mockMessage = createMockMemory('rebalance my portfolio');

        const isValid = await rebalanceEvaluatorAction.validate(mockRuntime, mockMessage);
        expect(isValid).toBe(true);
      });
    });

    describe('Portfolio Analysis', () => {
      it('should analyze portfolio with default balanced strategy', async () => {
        const mockMessage = createMockMemory('analyze my portfolio');
        const mockState = createMockState();
        const mockCallback = createMockCallback();

        await rebalanceEvaluatorAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        expect(mockCallback).toHaveBeenCalled();
        expect(wasCallbackSuccessful(mockCallback)).toBe(true);
        
        const calls = mockCallback.mock.calls;
        expect(calls[0][0]).toHaveProperty('text');
        expect(calls[0][0].text).toMatch(/(Analyzing portfolio|🔄)/i);
      });
    });
  });
});