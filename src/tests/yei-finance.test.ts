import { describe, it, expect, vi, beforeEach } from 'vitest';
import { yeiFinanceAction } from '../actions/yei-finance';
import { createMockRuntime, createMockMessage, createMockCallback } from './test-helpers';

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
      
      const result = await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        {},
        {},
        mockCallback
      );

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalled();
      
      const callbackData = mockCallback.mock.calls[0][0];
      expect(callbackData.text).toContain('YEI Finance');
      expect(callbackData.text).toContain('Oracle Prices');
      expect(callbackData.content.data.oracleCount).toBe(3);
    });

    it('should handle oracle fallback gracefully', async () => {
      mockMessage = createMockMessage('Check YEI oracle status');
      
      const result = await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        {},
        {},
        mockCallback
      );

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe('Lending Information', () => {
    it('should provide comprehensive lending information', async () => {
      mockMessage = createMockMessage('Tell me about YEI Finance lending');
      
      const result = await yeiFinanceAction.handler(
        mockRuntime,
        mockMessage,
        {},
        {},
        mockCallback
      );

      expect(result).toBe(true);
      
      const callbackData = mockCallback.mock.calls[0][0];
      expect(callbackData.text).toContain('Multi-Oracle Lending Protocol');
      expect(callbackData.text).toContain('API3');
      expect(callbackData.text).toContain('Pyth Network');
      expect(callbackData.text).toContain('Redstone');
    });
  });
});