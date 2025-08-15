import { describe, it, expect, vi, beforeEach } from 'vitest';
import { yeiFinanceAction } from '../actions/yei-finance';
import { createMockRuntime, createMockMessage, createMockCallback, createMockState } from './test-helpers';

// Mock the environment module
vi.mock('../environment', () => ({
  validateSeiConfig: vi.fn().mockReturnValue(true)
}));

// Mock the oracle provider
vi.mock('../providers/sei-oracle', () => ({
  SeiOracleProvider: vi.fn().mockImplementation(() => ({
    getPrice: vi.fn().mockImplementation((symbol: string) => {
      if (symbol === 'BTC') {
        return Promise.resolve({
          symbol: 'BTC',
          price: 45000,
          source: 'yei-multi-oracle',
          timestamp: Date.now(),
          confidence: 0.95
        });
      }
      if (symbol === 'ETH') {
        return Promise.resolve({
          symbol: 'ETH',
          price: 2500,
          source: 'yei-multi-oracle',
          timestamp: Date.now(),
          confidence: 0.95
        });
      }
      return Promise.resolve(null);
    })
  }))
}));

describe('YEI Finance Action', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
    mockCallback = createMockCallback();
  });

  describe('Action Validation', () => {
    it('should validate YEI Finance related messages', async () => {
      mockMessage = createMockMessage('What are YEI Finance lending rates?');
      const isValid = await yeiFinanceAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(true);
    });

    it('should validate multi-oracle queries', async () => {
      mockMessage = createMockMessage('How does YEI multi oracle system work?');
      const isValid = await yeiFinanceAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(true);
    });

    it('should not validate unrelated messages', async () => {
      mockMessage = createMockMessage('What is the weather today?');
      const isValid = await yeiFinanceAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(false);
    });
  });

  describe('Oracle Integration', () => {
    it('should fetch prices from YEI multi-oracle system', async () => {
      mockMessage = createMockMessage('Get YEI Finance oracle prices');
      
      await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        createMockState(),
        createMockState(),
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      
      const callbackData = mockCallback.mock.calls[0][0];
      expect(callbackData.text).toContain('YEI Finance');
      expect(callbackData.text).toContain('Current Prices (Multi-Oracle)');
      expect(callbackData.content.source).toBe('yei-finance');
    });

    it('should handle oracle fallback gracefully', async () => {
      mockMessage = createMockMessage('Check YEI oracle status');
      
      await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        createMockState(),
        createMockState(),
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe('Lending Information', () => {
    it('should provide comprehensive lending information', async () => {
      mockMessage = createMockMessage('Tell me about YEI Finance lending');
      
      await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        createMockState(),
        createMockState(),
        mockCallback
      );
      
      expect(mockCallback).toHaveBeenCalled();
      const callbackData = mockCallback.mock.calls[0][0];
      expect(callbackData.text).toContain('Advanced DeFi Lending Protocol');
      expect(callbackData.text).toContain('API3');
      expect(callbackData.text).toContain('Pyth + Redstone');
      expect(callbackData.text).toContain('Redstone');
    });
  });
});