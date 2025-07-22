import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transferAction } from '../actions/transfer';

// Import test helpers
import { 
  createMockMemory, 
  createMockState, 
  createMockRuntime,
  createMockCallback,
  findCallbackWithText,
  wasCallbackSuccessful,
  wasCallbackError,
  setupGlobalFetchMocks,
  createMockHttpResponse
} from './test-helpers';

// Mock dependencies
vi.mock('@elizaos/core', () => ({
  elizaLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn()
  },
  composeContext: vi.fn(() => 'mock context'),
  generateObjectDeprecated: vi.fn(() => ({
    amount: '1',
    toAddress: '0x331fCfeDeA9f3D8138713F4B2FB721C07ef61fD5'
  })),
  ModelClass: {
    SMALL: 'small',
    MEDIUM: 'medium',
    LARGE: 'large'
  }
}));

describe('Transfer Action', () => {
  let mockRuntime: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalFetchMocks(); // Set up comprehensive fetch mocking
    mockRuntime = createMockRuntime();
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(transferAction.name).toBe('transfer');
      expect(transferAction.description).toContain('Transfer');
      expect(transferAction.similes).toContain('SEND_TOKENS');
    });
  });

  describe('Transfer', () => {
    it('throws if transaction fails', async () => {
      const receiver = { address: '0x331fCfeDeA9f3D8138713F4B2FB721C07ef61fD5' };
      const mockMessage = createMockMemory(`transfer 1 SEI to ${receiver.address}`);
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      // Override fetch to return insufficient balance
      global.fetch = vi.fn().mockImplementation((url: string | URL, options?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const body = options?.body ? JSON.parse(options.body) : {};
        
        if (urlStr.includes('sei-apis.com')) {
          const method = body.method;
          
          if (method === 'eth_getBalance') {
            return Promise.resolve(createMockHttpResponse({
              jsonrpc: '2.0',
              id: body.id || 1,
              result: '0x0' // Zero balance
            }));
          }
          
          if (method === 'eth_gasPrice') {
            return Promise.resolve(createMockHttpResponse({
              jsonrpc: '2.0',
              id: body.id || 1,
              result: '0x174876e800' // 100 gwei
            }));
          }
          
          if (method === 'eth_estimateGas') {
            return Promise.resolve(createMockHttpResponse({
              jsonrpc: '2.0',
              id: body.id || 1,
              result: '0x5208' // 21000 gas
            }));
          }
          
          if (method === 'eth_getBlockByNumber') {
            return Promise.resolve(createMockHttpResponse({
              jsonrpc: '2.0',
              id: body.id || 1,
              result: {
                number: '0x1',
                gasLimit: '0x1c9c380'
              }
            }));
          }
        }
        
        return Promise.resolve(createMockHttpResponse({}));
      });

      await transferAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackError(mockCallback)).toBe(true);
      const errorCall = findCallbackWithText(mockCallback, 'failed') ||
                       findCallbackWithText(mockCallback, 'error') ||
                       findCallbackWithText(mockCallback, 'EIP-1559');
      expect(errorCall).toBeDefined();
    });

    it('should handle configuration errors gracefully', async () => {
      // Temporarily remove SEI_PRIVATE_KEY to trigger configuration error
      const originalKey = process.env.SEI_PRIVATE_KEY;
      const originalEnv = process.env.NODE_ENV;
      
      delete process.env.SEI_PRIVATE_KEY;
      process.env.NODE_ENV = 'production'; // Trigger validation
      
      const mockMessage = createMockMemory('transfer 1 SEI to 0x331fCfeDeA9f3D8138713F4B2FB721C07ef61fD5');
      const mockState = createMockState();
      const mockCallback = createMockCallback();

      await transferAction.handler(
        mockRuntime,
        mockMessage,
        mockState,
        {},
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(wasCallbackError(mockCallback)).toBe(true);
      const errorCall = findCallbackWithText(mockCallback, 'configuration') ||
                       findCallbackWithText(mockCallback, 'error') ||
                       findCallbackWithText(mockCallback, 'required');
      expect(errorCall).toBeDefined();
      
      // Restore environment variables
      if (originalKey) {
        process.env.SEI_PRIVATE_KEY = originalKey;
      }
      if (originalEnv) {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    });
  });
});
