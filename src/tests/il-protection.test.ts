import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ilProtectionAction } from '../actions/il-protection';
import { createTestRuntime } from '../environment';
import type { Memory } from '@elizaos/core';

// Mock the IL protector
vi.mock('../providers/impermanent-loss-protector', () => ({
  ImpermanentLossProtector: vi.fn().mockImplementation(() => ({
    getILAnalysis: vi.fn().mockResolvedValue({
      riskLevel: 'HIGH',
      currentIL: 5.2,
      projectedIL: 12.8,
      volatility: 45.6,
      confidence: 85
    }),
    protectLiquidityPosition: vi.fn().mockResolvedValue({
      type: 'PERPETUAL_HEDGE',
      provider: 'COINBASE_ADVANCED',
      hedgeRatio: 0.75,
      expectedILReduction: '~65% IL protection',
      cost: '$12.50 in fees',
      txHash: '0x123...abc',
      reason: 'High volatility detected between ETH/USDC. Hedge ratio optimized for current market conditions.'
    }),
    simulateILScenarios: vi.fn().mockResolvedValue([
      { priceChange: -0.5, il: 25.0, hedgedIL: 8.75 },
      { priceChange: -0.25, il: 6.25, hedgedIL: 2.19 },
      { priceChange: 0, il: 0, hedgedIL: 0 },
      { priceChange: 0.25, il: 6.25, hedgedIL: 2.19 },
      { priceChange: 0.5, il: 25.0, hedgedIL: 8.75 },
      { priceChange: 1.0, il: 100.0, hedgedIL: 35.0 }
    ])
  }))
}));

describe('IL Protection Action', () => {
  let mockRuntime: any;
  let mockCallback: any;

  beforeEach(() => {
    // Create mock runtime with geographic settings
    mockRuntime = createTestRuntime({
      USER_GEOGRAPHY: 'US',
      PERP_PREFERENCE: 'COINBASE',
      COINBASE_ADVANCED_API_KEY: 'test-api-key',
      COINBASE_ADVANCED_SECRET: 'test-secret',
      COINBASE_ADVANCED_PASSPHRASE: 'test-passphrase',
      COINBASE_SANDBOX: true
    });

    mockCallback = vi.fn();
  });

  describe('validate', () => {
    it('should validate IL protection request', async () => {
      const message: Memory = {
        content: { text: 'protect my ETH/USDC LP position' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      const isValid = await ilProtectionAction.validate(mockRuntime, message);
      expect(isValid).toBe(true);
    });

    it('should validate hedge request', async () => {
      const message: Memory = {
        content: { text: 'hedge my BTC/USDT liquidity against impermanent loss' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      const isValid = await ilProtectionAction.validate(mockRuntime, message);
      expect(isValid).toBe(true);
    });

    it('should not validate unrelated requests', async () => {
      const message: Memory = {
        content: { text: 'check my wallet balance' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      const isValid = await ilProtectionAction.validate(mockRuntime, message);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should handle IL protection request successfully', async () => {
      const message: Memory = {
        content: { text: 'protect my ETH/USDC LP worth $5000' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('🛡️ **Impermanent Loss Protection Activated**'),
      });

      const callbackArg = mockCallback.mock.calls[0][0];
      expect(callbackArg.text).toContain('ETH/USDC');
      expect(callbackArg.text).toContain('$5,000');
      expect(callbackArg.text).toContain('PERPETUAL_HEDGE');
      expect(callbackArg.text).toContain('COINBASE_ADVANCED');
      expect(callbackArg.text).toContain('75.0%'); // Hedge ratio
      expect(callbackArg.text).toContain('IL Scenarios');
    });

    it('should handle low risk position without hedging', async () => {
      // Mock low risk analysis
      const { ImpermanentLossProtector } = await import('../providers/impermanent-loss-protector');
      const mockProtector = new (ImpermanentLossProtector as any)();
      mockProtector.getILAnalysis.mockResolvedValueOnce({
        riskLevel: 'LOW',
        currentIL: 0.8,
        projectedIL: 2.1,
        volatility: 15.2,
        confidence: 92
      });

      const message: Memory = {
        content: { text: 'protect my USDC/USDT LP worth $1000' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('📊 **IL Risk Analysis Complete**'),
      });

      const callbackArg = mockCallback.mock.calls[0][0];
      expect(callbackArg.text).toContain('Risk Level**: LOW ✅');
      expect(callbackArg.text).toContain('No hedging needed');
    });

    it('should handle invalid LP position format', async () => {
      const message: Memory = {
        content: { text: 'protect my position please' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: "Please provide liquidity position details in format: 'protect my ETH/USDC LP worth $1000'",
        error: true
      });
    });

    it('should handle BTC/USDT position', async () => {
      const message: Memory = {
        content: { text: 'hedge my BTC-USDT LP position worth $25000' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('BTC/USDT'),
      });

      const callbackArg = mockCallback.mock.calls[0][0];
      expect(callbackArg.text).toContain('$25,000');
    });

    it('should handle errors gracefully', async () => {
      // Mock error in IL protector
      const { ImpermanentLossProtector } = await import('../providers/impermanent-loss-protector');
      const mockProtector = new (ImpermanentLossProtector as any)();
      mockProtector.getILAnalysis.mockRejectedValueOnce(new Error('API connection failed'));

      const message: Memory = {
        content: { text: 'protect my ETH/USDC LP worth $5000 (error)' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('❌ Error setting up IL protection'),
        error: true
      });
    });

    it('should parse alternative LP formats', async () => {
      const message: Memory = {
        content: { text: 'Can you hedge my SOL/USDC lp with 10000 value?' },
        agentId: 'test-1-2-3-4-5',
        roomId: 'room-1-2-3-4-5',
        entityId: 'entity-1-2-3-4-5',
        createdAt: Date.now()
      };

      await ilProtectionAction.handler(mockRuntime, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        text: expect.stringContaining('SOL/USDC'),
      });

      const callbackArg = mockCallback.mock.calls[0][0];
      expect(callbackArg.text).toContain('10,000');
    });
  });

  describe('examples', () => {
    it('should have proper example structure', () => {
      expect(ilProtectionAction.examples).toBeDefined();
      if (ilProtectionAction.examples) {
        expect(ilProtectionAction.examples.length).toBeGreaterThan(0);
        const firstExample = ilProtectionAction.examples[0];
        expect(firstExample).toHaveLength(2);
        expect(firstExample[0].content.text).toContain('Protect');
        expect(firstExample[1].content.action).toBe('IL_PROTECTION');
      }
    });
  });

  describe('action properties', () => {
    it('should have correct name and similes', () => {
      expect(ilProtectionAction.name).toBe('IL_PROTECTION');
      expect(ilProtectionAction.similes).toContain('HEDGE_IL');
      expect(ilProtectionAction.similes).toContain('IMPERMANENT_LOSS_PROTECTION');
      expect(ilProtectionAction.description).toContain('impermanent loss');
    });
  });
});
