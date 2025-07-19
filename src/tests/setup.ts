import { vi } from 'vitest';

// Global test setup
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

// Mock environment variables for tests
process.env.SEI_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
process.env.SEI_NETWORK = 'testnet';
process.env.SEI_RPC_URL = 'https://evm-rpc-testnet.sei-apis.com';

// Global fetch mock
global.fetch = vi.fn();