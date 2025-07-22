import { config } from 'dotenv';
import { beforeAll, vi } from 'vitest';

// Global test setup
beforeAll(() => {
  // Load environment variables before any tests run
  config({ path: '.env' });
  config({ path: '.env.local', override: true });

  // Set default test values if not provided
  if (!process.env.SEI_PRIVATE_KEY) {
    process.env.SEI_PRIVATE_KEY =
      '0x41cf748c42faaf463cdfb9eb30adaf699199e3389007e4d8313642cf96236ba6';
  }
  if (!process.env.SEI_ADDRESS) {
    process.env.SEI_ADDRESS = '0xBFC122e34B01a0875301814958D0f47cA4153d7c';
  }
  if (!process.env.SEI_NETWORK) {
    process.env.SEI_NETWORK = 'testnet';
  }
  if (!process.env.SEI_RPC_URL) {
    process.env.SEI_RPC_URL = 'https://evm-rpc-testnet.sei-apis.com';
  }
  if (!process.env.DRAGONSWAP_API_URL) {
    process.env.DRAGONSWAP_API_URL = 'https://api-testnet.dragonswap.app/v1';
  }
  if (!process.env.ORACLE_API_KEY) {
    process.env.ORACLE_API_KEY = 'test-oracle-key';
  }

  // Reset all mocks before each test
  vi.clearAllMocks();
});

// Global fetch mock
global.fetch = vi.fn();