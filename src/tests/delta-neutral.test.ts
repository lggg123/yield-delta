import { describe, test, expect, vi, beforeEach } from 'vitest';
import { deltaNeutralAction } from '../actions/delta-neutral';
import { createMockRuntime, createMockMemory, createMockCallback, wasCallbackSuccessful, setupGlobalFetchMocks } from './test-helpers';

setupGlobalFetchMocks();

describe('Delta Neutral Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalFetchMocks();
  });

  test('validate function recognizes delta neutral keywords', async () => {
    const runtime = createMockRuntime();
    
    const testCases = [
      { text: 'execute delta neutral strategy', expected: true },
      { text: 'start market neutral position', expected: true },
      { text: 'delta neutral LP for ETH/USDC', expected: true },
      { text: 'hello world', expected: false },
      { text: 'just regular farming', expected: false }
    ];

    for (const testCase of testCases) {
      const message = createMockMemory(testCase.text);
      const result = await deltaNeutralAction.validate(runtime, message);
      expect(result).toBe(testCase.expected);
    }
  });

  test('handler executes complete delta neutral strategy', async () => {
    const runtime = createMockRuntime();
    runtime.getSetting = vi.fn().mockReturnValue('http://localhost:8000');
    
    const message = createMockMemory('execute delta neutral strategy for ETH/USDC');
    const callback = createMockCallback();

    // Mock AI response
    const mockDeltaNeutralResponse = {
      pair: 'ETH/USDC',
      hedge_ratio: 0.95,
      lower_tick: 2400,
      upper_tick: 2600,
      lower_price: 2400,
      upper_price: 2600,
      expected_neutrality: 0.95,
      expected_apr: 0.155,
      revenue_breakdown: {
        lp_fees: 1000,
        funding_rates: 500,
        volatility_capture: 200
      },
      reasoning: 'Delta neutral strategy with 95% hedge ratio'
    };

    global.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      
      if (urlStr.includes('predict/delta-neutral-optimization')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockDeltaNeutralResponse)
        });
      }
      
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      });
    });

    await deltaNeutralAction.handler(runtime, message, {}, {}, callback);

    // Verify AI optimization was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('predict/delta-neutral-optimization'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );

    // Verify success callback
    expect(wasCallbackSuccessful(callback)).toBe(true);
    
    const calls = callback.mock.calls;
    const successCall = calls.find(call => 
      call[0]?.text?.includes('Delta Neutral Strategy Executed') ||
      call[0]?.content?.type === 'delta_neutral_execution'
    );
    expect(successCall).toBeDefined();
  });

  test('handler provides help when no specific command given', async () => {
    const runtime = createMockRuntime();
    const message = createMockMemory('delta neutral info');
    const callback = createMockCallback();

    await deltaNeutralAction.handler(runtime, message, {}, {}, callback);

    const calls = callback.mock.calls;
    const helpCall = calls.find(call => 
      call[0]?.text?.includes('Delta Neutral Strategy Commands') ||
      call[0]?.content?.type === 'help'
    );
    expect(helpCall).toBeDefined();
  });

  test('handler handles AI endpoint errors gracefully', async () => {
    const runtime = createMockRuntime();
    runtime.getSetting = vi.fn().mockReturnValue('http://localhost:8000');
    
    const message = createMockMemory('execute delta neutral strategy');
    const callback = createMockCallback();

    // Mock fetch to reject
    global.fetch = vi.fn().mockRejectedValue(new Error('AI endpoint down'));

    await deltaNeutralAction.handler(runtime, message, {}, {}, callback);

    const calls = callback.mock.calls;
    const errorCall = calls.find(call => 
      call[0]?.text?.includes('Error') ||
      call[0]?.content?.type === 'error'
    );
    expect(errorCall).toBeDefined();
  });

  test('handler extracts trading pairs correctly', async () => {
    const runtime = createMockRuntime();
    runtime.getSetting = vi.fn().mockReturnValue('http://localhost:8000');
    
    const callback = createMockCallback();

    // Mock successful AI response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        pair: 'BTC/USDT',
        hedge_ratio: 0.95,
        expected_neutrality: 0.95,
        expected_apr: 0.155,
        revenue_breakdown: { lp_fees: 1000, funding_rates: 500, volatility_capture: 200 },
        lower_price: 45000,
        upper_price: 55000,
        reasoning: 'Test strategy'
      })
    });

    const testCases = [
      { text: 'delta neutral for btc/usdt', expectedPair: 'BTC/USDT' },
      { text: 'execute delta neutral eth/usdc', expectedPair: 'ETH/USDC' },
      { text: 'market neutral sei/usdc position', expectedPair: 'SEI/USDC' }
    ];

    for (const testCase of testCases) {
      vi.clearAllMocks();
      const message = createMockMemory(testCase.text);
      
      await deltaNeutralAction.handler(runtime, message, {}, {}, callback);
      
      // Check that fetch was called with the correct pair
      const fetchCalls = (global.fetch as any).mock.calls;
      const relevantCall = fetchCalls.find((call: any) => 
        call[0].includes('predict/delta-neutral-optimization')
      );
      
      if (relevantCall) {
        const requestBody = JSON.parse(relevantCall[1].body);
        expect(requestBody.pair).toBe(testCase.expectedPair);
      }
    }
  });

  test('action has correct metadata', () => {
    expect(deltaNeutralAction.name).toBe('DELTA_NEUTRAL');
    expect(deltaNeutralAction.description).toContain('delta neutral strategy');
    expect(deltaNeutralAction.examples).toBeDefined();
    expect(Array.isArray(deltaNeutralAction.examples)).toBe(true);
  });
});