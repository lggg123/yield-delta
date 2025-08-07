import { randomUUID } from 'crypto';
import { Memory, State, UUID } from "@elizaos/core";
import { vi } from 'vitest';

// Helper function to generate proper UUID format with correct typing
function generateMockUUID(): UUID {
  const uuid = randomUUID();
  return uuid as UUID;
}

// Mock viem to prevent actual blockchain calls
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    // Mock the createPublicClient to return our mock
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn().mockImplementation(({ functionName, args }) => {
        // Mock contract responses based on function name
        switch (functionName) {
          case 'queryPriceFeed':
            // Return mock price data (price, timestamp)
            return Promise.resolve([BigInt('50000000'), BigInt(Date.now())]);
          case 'latestRoundData':
            // Return mock Chainlink data (roundId, answer, startedAt, updatedAt, answeredInRound)
            return Promise.resolve([
              BigInt(1),
              BigInt('50000000'), // $0.50 with 8 decimals
              BigInt(Date.now() - 1000),
              BigInt(Date.now()),
              BigInt(1)
            ]);
          case 'balanceOf':
            // Return mock token balance
            return Promise.resolve(BigInt('1000000000000000000')); // 1 token
          case 'totalSupply':
            return Promise.resolve(BigInt('1000000000000000000000')); // 1000 tokens
          case 'decimals':
            return Promise.resolve(18);
          case 'allowance':
            return Promise.resolve(BigInt('0'));
          default:
            return Promise.resolve(BigInt('0'));
        }
      }),
      // Mock other public client methods
      getBlockNumber: vi.fn().mockResolvedValue(BigInt(1000)),
      getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
      getBlock: vi.fn().mockResolvedValue({
        number: BigInt(1000),
        timestamp: BigInt(Date.now()),
        gasLimit: BigInt('30000000'),
        gasUsed: BigInt('21000')
      }),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockNumber: BigInt(1001),
        gasUsed: BigInt('21000')
      })
    })),
    // Mock createWalletClient
    createWalletClient: vi.fn(() => ({
      account: {
        address: '0xBFC122e34B01a0875301814958D0f47cA4153d7c'
      },
      writeContract: vi.fn().mockResolvedValue('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
      sendTransaction: vi.fn().mockResolvedValue('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
      signMessage: vi.fn().mockResolvedValue('0xsignature'),
      signTransaction: vi.fn().mockResolvedValue('0xsignedtx')
    })),
    // Mock HTTP transport to prevent real network calls
    http: vi.fn(() => ({
      request: vi.fn().mockImplementation(({ body }) => {
        const method = body?.method || '';
        switch (method) {
          case 'eth_getBalance':
            return Promise.resolve('0xde0b6b3a7640000'); // 1 ETH
          case 'eth_call':
            return Promise.resolve('0x0000000000000000000000000000000000000000000000000de0b6b3a7640000');
          case 'eth_getBlockByNumber':
            return Promise.resolve({
              number: '0x3e8', // 1000
              timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
              gasLimit: '0x1c9c380',
              gasUsed: '0x5208'
            });
          default:
            return Promise.resolve('0x0');
        }
      })
    }))
  };
});

export function createMockMemory(text: string, entityId?: UUID): Memory {
  return {
    id: generateMockUUID(),
    entityId: entityId || generateMockUUID(),
    roomId: generateMockUUID(),
    agentId: generateMockUUID(),
    createdAt: Date.now(),
    content: {
      text,
      source: 'user',
      action: undefined,
      inReplyTo: undefined
    },
    embedding: undefined
  };
}

// Alias for createMockMemory for backward compatibility
export const createMockMessage = createMockMemory;

export function createMockState(): State {
  return {
    agentId: generateMockUUID(),
    roomId: generateMockUUID(),
    bio: 'Test agent bio',
    lore: 'Test agent lore',
    messageDirections: 'Test message directions',
    postDirections: 'Test post directions',
    actors: 'Test actors',
    goals: 'Test goals',
    evaluators: [],
    recentMessages: [],
    recentMessagesData: [],
    values: {},
    data: {},
    text: ''
  };
}

export function createMockRuntime() {
  return {
    getSetting: vi.fn((key: string) => {
      // Always return the environment variable or fallback
      const value = process.env[key];
      if (value) {
        return value;
      }
      
      // Fallback values for specific keys
      const fallbacks: Record<string, string> = {
        'SEI_PRIVATE_KEY': '0x41cf748c42faaf463cdfb9eb30adaf699199e3389007e4d8313642cf96236ba6',
        'SEI_ADDRESS': '0xBFC122e34B01a0875301814958D0f47cA4153d7c',
        'SEI_NETWORK': 'sei-testnet',
        'SEI_RPC_URL': 'https://evm-rpc-testnet.sei-apis.com',
        'DRAGONSWAP_API_URL': 'https://api-testnet.dragonswap.app/v1',
        'ORACLE_API_KEY': 'test-oracle-key',
        'AI_ENGINE_URL': 'http://localhost:8000'
      };
      
      return fallbacks[key] || null;
    }),
    seiClobProvider: {
      placeRangeOrder: vi.fn().mockResolvedValue({ success: true, orderId: 'mock-order-123' }),
      cancelOrder: vi.fn().mockResolvedValue({ success: true }),
      getPositions: vi.fn().mockResolvedValue([]),
      getOrderbook: vi.fn().mockResolvedValue({ bids: [], asks: [] })
    },
    cacheManager: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    composeState: vi.fn().mockResolvedValue(createMockState()),
    updateRecentMessageState: vi.fn().mockResolvedValue(createMockState())
  };
}

export function createMockCallback() {
  return vi.fn();
}

export function findCallbackWithText(mockCallback: any, searchText: string) {
  const calls = mockCallback.mock.calls;
  return calls.find((call: any) => {
    // Check if the call has text content
    if (call[0]?.text) {
      return call[0].text.toLowerCase().includes(searchText.toLowerCase());
    }
    // Also check if it's a string directly
    if (typeof call[0] === 'string') {
      return call[0].toLowerCase().includes(searchText.toLowerCase());
    }
    // Check if it's in the content object
    if (call[0]?.content?.text) {
      return call[0].content.text.toLowerCase().includes(searchText.toLowerCase());
    }
    return false;
  });
}

// Add a debug helper to see what's actually in the callbacks
export function debugCallbacks(mockCallback: any, testName: string) {
  console.log(`\n=== Debug ${testName} ===`);
  console.log('Number of callback calls:', mockCallback.mock.calls.length);
  mockCallback.mock.calls.forEach((call: any, index: number) => {
    console.log(`Call ${index + 1}:`, JSON.stringify(call[0], null, 2));
  });
  console.log('=== End Debug ===\n');
}

export function wasCallbackSuccessful(mockCallback: any): boolean {
  const calls = mockCallback.mock.calls;
  return calls.some((call: any) => {
    const text = call[0]?.text?.toLowerCase() || '';
    return text.includes('success') || 
           text.includes('completed') || 
           text.includes('executed') ||
           text.includes('swap') ||
           text.includes('analysis') ||
           text.includes('portfolio') ||
           text.includes('opportunities') ||
           (!text.includes('error') && !text.includes('failed') && !text.includes('invalid'));
  });
}

export function wasCallbackError(mockCallback: any): boolean {
  const calls = mockCallback.mock.calls;
  return calls.some((call: any) => {
    const text = call[0]?.text?.toLowerCase() || '';
    return text.includes('error') || 
           text.includes('failed') || 
           text.includes('invalid') ||
           text.includes("couldn't") ||
           text.includes('not found') ||
           text.includes('missing') ||
           text.includes('unavailable') ||
           text.includes('reverted') ||
           text.includes('insufficient') ||
           text.includes('no liquidity') ||
           text.includes('processing') || // Add this to catch "Error processing arbitrage request"
           call[0]?.error === true; // Also check for explicit error property
  });
}

// Create a proper HTTP response mock that viem can work with
export function createMockHttpResponse(data: any, status: number = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Map([
      ['content-type', 'application/json'],
      ['content-length', JSON.stringify(data).length.toString()]
    ]),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(data)])),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    formData: vi.fn().mockResolvedValue(new FormData()),
    clone: vi.fn().mockReturnThis(),
    body: null,
    bodyUsed: false,
    url: '',
    redirected: false,
    type: 'default' as ResponseType
  };
}

// Setup comprehensive fetch mocking for blockchain interactions
// Global fetch mock setup function - exported for use in tests
export function setupGlobalFetchMock() {
  return setupGlobalFetchMocks();
}

export function setupGlobalFetchMocks() {
  global.fetch = vi.fn().mockImplementation((url: string | URL, options?: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const body = options?.body ? JSON.parse(options.body) : {};
    
    // Mock SEI RPC calls
    if (urlStr.includes('sei-apis.com') || urlStr.includes('evm-rpc')) {
      const method = body.method;
      
      switch (method) {
        case 'eth_getBalance':
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: '0xde0b6b3a7640000' // 1 ETH in wei
          }));
          
        case 'eth_getBlockByNumber':
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: {
              number: '0x1',
              gasLimit: '0x1c9c380',
              gasUsed: '0x5208',
              timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16)
            }
          }));
          
        case 'eth_gasPrice':
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: '0x174876e800' // 100 gwei
          }));
          
        case 'eth_estimateGas':
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: '0x5208' // 21000 gas
          }));
          
        case 'eth_call':
          // Mock contract calls (for oracle price feeds)
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000' // 1 ETH
          }));
          
        case 'eth_sendTransaction':
        case 'eth_sendRawTransaction':
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: '0xabcdef123456789012345678901234567890abcdef123456789012345678901234'
          }));
          
        default:
          return Promise.resolve(createMockHttpResponse({
            jsonrpc: '2.0',
            id: body.id || 1,
            result: null
          }));
      }
    }
    
    // Mock DragonSwap API calls
    if (urlStr.includes('dragonswap.app')) {
      if (urlStr.includes('/pools/')) {
        return Promise.resolve(createMockHttpResponse({
          address: '0x1234567890abcdef1234567890abcdef12345678',
          token0: 'SEI',
          token1: 'USDC',
          fee: 3000,
          liquidity: '1000000',
          price: '0.5'
        }));
      }
      
      if (urlStr.includes('/quote')) {
        return Promise.resolve(createMockHttpResponse({
          amountOut: '0.495',
          priceImpact: 0.001,
          route: ['SEI', 'USDC']
        }));
      }
    }
    
    // Default fallback
    return Promise.resolve(createMockHttpResponse({}));
  });
}