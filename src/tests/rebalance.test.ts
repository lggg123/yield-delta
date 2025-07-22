import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebalanceEvaluatorAction } from '../actions/rebalance';

// Import test helpers
import { 
  createMockMemory, 
  createMockState, 
  createMockRuntime,
  createMockCallback,
  findCallbackWithText,
  wasCallbackSuccessful,
  wasCallbackError,
  debugCallbacks,
  setupGlobalFetchMocks
} from './test-helpers';

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

describe('Portfolio Rebalance Action', () => {
  let mockRuntime: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalFetchMocks(); // Set up comprehensive fetch mocking
    mockRuntime = createMockRuntime();
  });

  describe('Action Validation', () => {
    it('should validate runtime configuration correctly', async () => {
      const mockMessage = createMockMemory('rebalance my portfolio');
      
      const isValid = await rebalanceEvaluatorAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(true);
    });

    it('should have correct action properties', () => {
      expect(rebalanceEvaluatorAction.name).toBe('PORTFOLIO_REBALANCE');
      expect(rebalanceEvaluatorAction.description).toContain('portfolio');
      expect(rebalanceEvaluatorAction.similes).toContain('REBALANCE_PORTFOLIO');
    });
  });

  describe('Portfolio Analysis', () => {
    it('should analyze portfolio with balanced strategy', async () => {
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
      
      // More flexible text matching
      const analysisCall = findCallbackWithText(mockCallback, 'portfolio') ||
                          findCallbackWithText(mockCallback, 'analysis') ||
                          findCallbackWithText(mockCallback, 'balance') ||
                          findCallbackWithText(mockCallback, 'rebalance');
      
      if (!analysisCall) {
        debugCallbacks(mockCallback, 'Portfolio Analysis');
      }
      expect(analysisCall).toBeDefined();
    });

    it('should handle conservative strategy request', async () => {
      const mockMessage = createMockMemory('rebalance my portfolio using conservative strategy');
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
      
      // Look for any strategy or rebalance related content
      const strategyCall = findCallbackWithText(mockCallback, 'conservative') ||
                          findCallbackWithText(mockCallback, 'strategy') ||
                          findCallbackWithText(mockCallback, 'rebalance') ||
                          findCallbackWithText(mockCallback, 'portfolio');
      
      if (!strategyCall) {
        debugCallbacks(mockCallback, 'Conservative Strategy');
      }
      expect(strategyCall).toBeDefined();
    });

    it('should handle aggressive strategy request', async () => {
      const mockMessage = createMockMemory('rebalance portfolio with aggressive strategy');
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
      
      const strategyCall = findCallbackWithText(mockCallback, 'aggressive') ||
                          findCallbackWithText(mockCallback, 'strategy') ||
                          findCallbackWithText(mockCallback, 'rebalance') ||
                          findCallbackWithText(mockCallback, 'portfolio');
      
      if (!strategyCall) {
        debugCallbacks(mockCallback, 'Aggressive Strategy');
      }
      expect(strategyCall).toBeDefined();
    });

    it('should provide rebalance recommendations', async () => {
      const mockMessage = createMockMemory('analyze portfolio and suggest rebalancing');
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
      
      const recommendationCall = findCallbackWithText(mockCallback, 'recommend') ||
                                findCallbackWithText(mockCallback, 'suggest') ||
                                findCallbackWithText(mockCallback, 'rebalance') ||
                                findCallbackWithText(mockCallback, 'portfolio');
      
      if (!recommendationCall) {
        debugCallbacks(mockCallback, 'Recommendations');
      }
      expect(recommendationCall).toBeDefined();
    });
  });

  describe('Auto-execution', () => {
    it('should handle auto-execute requests', async () => {
      const mockMessage = createMockMemory('rebalance portfolio execute');
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
      
      const executeCall = findCallbackWithText(mockCallback, 'execut') ||
                         findCallbackWithText(mockCallback, 'rebalance') ||
                         findCallbackWithText(mockCallback, 'complete') ||
                         findCallbackWithText(mockCallback, 'portfolio');
      
      if (!executeCall) {
        debugCallbacks(mockCallback, 'Auto-execution');
      }
      expect(executeCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle configuration errors gracefully', async () => {
      // Mock runtime with missing config
      const badRuntime = {
        ...mockRuntime,
        getSetting: vi.fn().mockReturnValue(null)
      };

      const mockMessage = createMockMemory('rebalance my portfolio');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await rebalanceEvaluatorAction.handler(
        badRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(wasCallbackError(mockCallback)).toBe(true);
      const errorCall = findCallbackWithText(mockCallback, 'failed') ||
                       findCallbackWithText(mockCallback, 'error') ||
                       findCallbackWithText(mockCallback, 'configuration');
      expect(errorCall).toBeDefined();
    });
  });
});
