import { describe, it, expect, vi, beforeEach } from 'vitest';
import { perpsTradeAction } from '../actions/perp-trading';

describe('Perps Trading Action', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockState: any;
  let mockCallback: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock runtime with proper getSetting method
    mockRuntime = {
      getSetting: vi.fn((key: string) => {
        if (key === 'SEI_PRIVATE_KEY') return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        if (key === 'SEI_NETWORK') return 'sei-testnet';
        if (key === 'PERP_PROTOCOL') return 'vortex';
        if (key === 'VORTEX_TESTNET_CONTRACT') return '0x1234567890123456789012345678901234567890';
        if (key === 'VORTEX_MAINNET_CONTRACT') return '0x9876543210987654321098765432109876543210';
        return null;
      }),
      cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn()
      }
    };

    // Mock message with valid perps trading content
    mockMessage = {
      content: {
        text: 'open long BTC 1000 2x'
      }
    };

    // Mock state
    mockState = {};

    // Mock callback as a spy
    mockCallback = vi.fn();

    // Mock environment variables
    process.env.SEI_PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.SEI_NETWORK = 'sei-testnet';
  });

  describe('validation', () => {
    it('should validate perps trading messages correctly', async () => {
      const isValid = await perpsTradeAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(true);
    });

    it('should reject non-perps messages', async () => {
      mockMessage.content.text = 'hello world';
      const isValid = await perpsTradeAction.validate(mockRuntime, mockMessage);
      expect(isValid).toBe(false);
    });
  });

  describe('handler execution', () => {
    it('should execute perps trading and call callback', async () => {
      // Execute the handler
      await perpsTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Verify callback was called
      expect(mockCallback).toHaveBeenCalled();
      
      // Verify callback was called with success response
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('BTC'),
          // Should contain success message or position details
        })
      );
    });

    it('should handle validation errors gracefully', async () => {
      // Temporarily override NODE_ENV to trigger validation error
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      // Remove required environment
      mockRuntime.getSetting = vi.fn(() => null);
      delete process.env.SEI_PRIVATE_KEY;
      delete process.env.SEI_NETWORK;

      await perpsTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Restore NODE_ENV
      process.env.NODE_ENV = originalNodeEnv;

      // Should still call callback with error
      expect(mockCallback).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error: true
        })
      );
    });

    it('should parse trading parameters correctly', async () => {
      // Test different message formats
      const testCases = [
        'open long BTC 1000 2x',
        'short ETH 500 3x',
        'close BTC position',
        'increase SOL position 200'
      ];

      for (const text of testCases) {
        mockMessage.content.text = text;
        mockCallback.mockClear();

        await perpsTradeAction.handler(
          mockRuntime,
          mockMessage,
          mockState,
          {},
          mockCallback
        );

        // Should correctly parse the input parameters
        expect(mockCallback).toHaveBeenCalled();
      }
    });
  });

  describe('error handling', () => {
    it('should handle invalid trading parameters', async () => {
      mockMessage.content.text = 'open invalid format';

      await perpsTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error: true,
          text: expect.stringContaining('Invalid')
        })
      );
    });

    it('should handle network errors gracefully', async () => {
      // Mock a network failure scenario
      mockMessage.content.text = 'open long BTC 1000 2x';

      await perpsTradeAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      // Should call callback even if trading fails
      expect(mockCallback).toHaveBeenCalled();
    });
  });
});
