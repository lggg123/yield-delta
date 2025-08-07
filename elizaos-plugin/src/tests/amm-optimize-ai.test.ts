import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ammOptimizeAction } from '../actions/amm-optimize';
import { createMockRuntime, createMockMemory, createMockCallback, wasCallbackSuccessful, setupGlobalFetchMocks } from './test-helpers';

// Mock fetch for AI calls
setupGlobalFetchMocks();

describe('AI-Enhanced AMM Optimize Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalFetchMocks();
  });

  test('validate function returns true for optimize keywords', async () => {
    const runtime = createMockRuntime();
    const message = createMockMemory('optimize my LP positions for ETH/USDC');
    
    const result = await ammOptimizeAction.validate(runtime, message);
    expect(result).toBe(true);
  });

  test('validate function returns false for non-optimize text', async () => {
    const runtime = createMockRuntime();
    const message = createMockMemory('hello world');
    
    const result = await ammOptimizeAction.validate(runtime, message);
    expect(result).toBe(false);
  });

  test('handler calls Python AI and executes optimization', async () => {
    const runtime = createMockRuntime();
    const message = createMockMemory('optimize LP for ETH/USDC with AI');
    const callback = createMockCallback();

    // Mock AI response for optimal range prediction
    const mockAIResponse = {
      lower_tick: 1800,
      upper_tick: 2200, 
      lower_price: 1.8,
      upper_price: 2.2,
      confidence: 0.94,
      expected_apr: 0.15,
      reasoning: 'AI-optimized range based on volatility analysis'
    };

    // Mock fetch to return our AI response
    global.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      
      if (urlStr.includes('predict/optimal-range')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAIResponse)
        });
      }
      
      // Default mock response for other calls
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      });
    });

    await ammOptimizeAction.handler(runtime, message, {}, {}, callback);

    // Verify AI was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('predict/optimal-range'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );

    // Verify callback was called with success message
    expect(wasCallbackSuccessful(callback)).toBe(true);
    
    // Check for specific content in the callback
    const calls = callback.mock.calls;
    const successCall = calls.find(call => 
      call[0]?.text?.includes('AI-optimized') || 
      call[0]?.text?.includes('optimization') ||
      call[0]?.content?.text?.includes('AI-optimized')
    );
    expect(successCall).toBeDefined();
  });

  test('handler handles AI endpoint errors gracefully', async () => {
    const runtime = createMockRuntime();
    const message = createMockMemory('optimize LP positions');
    const callback = createMockCallback();

    // Mock fetch to reject (simulate AI endpoint down)
    global.fetch = vi.fn().mockRejectedValue(new Error('AI endpoint down'));

    await ammOptimizeAction.handler(runtime, message, {}, {}, callback);

    // Should still call callback, but with error handling
    expect(callback).toHaveBeenCalled();
    
    // The handler should gracefully fallback or show appropriate error
    const calls = callback.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });

  test('validate function recognizes various optimize patterns', async () => {
    const runtime = createMockRuntime();
    
    const testCases = [
      { text: 'optimize my LP positions', expected: true },
      { text: 'optimize amm strategy', expected: true },
      { text: 'LP optimization needed', expected: true },
      { text: 'optimize concentrated liquidity', expected: true },
      { text: 'just regular trading', expected: false },
      { text: 'hello there', expected: false }
    ];

    for (const testCase of testCases) {
      const message = createMockMemory(testCase.text);
      const result = await ammOptimizeAction.validate(runtime, message);
      expect(result).toBe(testCase.expected);
    }
  });

  test('action has correct name and description', () => {
    expect(ammOptimizeAction.name).toBe('AMM_OPTIMIZE');
    expect(ammOptimizeAction.description).toContain('Optimizes concentrated liquidity');
    expect(ammOptimizeAction.description).toContain('Sei CLOB');
  });

  test('action includes examples', () => {
    expect(ammOptimizeAction.examples).toBeDefined();
    expect(Array.isArray(ammOptimizeAction.examples)).toBe(true);
    expect(ammOptimizeAction.examples.length).toBeGreaterThan(0);
  });
});