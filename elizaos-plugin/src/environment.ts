import { elizaLogger } from "@elizaos/core";

export interface SeiChain {
  readonly id: number;
  readonly name: string;
  readonly network: string;
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly rpcUrls: {
    readonly default: {
      readonly http: readonly string[];
    };
  };
  readonly blockExplorers: {
    readonly default: {
      readonly name: string;
      readonly url: string;
    };
  };
}

export type SeiNetworkName = "sei-mainnet" | "sei-testnet" | "sei-devnet";

export interface SeiConfig {
    SEI_RPC_URL: string;
    SEI_CHAIN_ID?: string;
    SEI_PRIVATE_KEY?: string;
    SEI_ADDRESS?: string;
    SEI_NETWORK?: SeiNetworkName;
    DRAGONSWAP_API_URL?: string;
    ORACLE_API_KEY?: string;
    YEI_API_KEY?: string;
    
    // Geographic configuration for regulatory compliance
    USER_GEOGRAPHY?: 'US' | 'EU' | 'ASIA' | 'GLOBAL';
    PERP_PREFERENCE?: 'COINBASE' | 'ON_CHAIN' | 'GEOGRAPHIC' | 'AUTO';
    
    // Coinbase Advanced API for US users
    COINBASE_ADVANCED_API_KEY?: string;
    COINBASE_ADVANCED_SECRET?: string;
    COINBASE_ADVANCED_PASSPHRASE?: string;
    COINBASE_SANDBOX?: boolean;
}

export const seiChains: Record<SeiNetworkName, SeiChain> = {
  "sei-mainnet": {
    id: 1329,
    name: "Sei Mainnet",
    network: "sei-mainnet",
    nativeCurrency: {
      name: "SEI",
      symbol: "SEI",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ["https://evm-rpc.sei-apis.com"],
      },
    },
    blockExplorers: {
      default: {
        name: "Seitrace",
        url: "https://seitrace.com",
      },
    },
  },
  "sei-testnet": {
    id: 713715,
    name: "Sei Testnet",
    network: "sei-testnet",
    nativeCurrency: {
      name: "SEI",
      symbol: "SEI",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ["https://evm-rpc-testnet.sei-apis.com"],
      },
    },
    blockExplorers: {
      default: {
        name: "Seitrace Testnet",
        url: "https://testnet.seitrace.com",
      },
    },
  },
  "sei-devnet": {
    id: 713715,
    name: "Sei Devnet",
    network: "sei-devnet",
    nativeCurrency: {
      name: "SEI",
      symbol: "SEI",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ["https://evm-rpc-arctic-1.sei-apis.com"],
      },
    },
    blockExplorers: {
      default: {
        name: "Seitrace Devnet",
        url: "https://devnet.seitrace.com",
      },
    },
  },
};

// Token addresses for different networks
export const TOKEN_ADDRESSES = {
  "sei-mainnet": {
    USDC: "0x3894085Ef7Ff0f0aeDf52E2A2704928d259f9c3a",
    USDT: "0xB75D0B03c06A926e488e2659DF1A861F860bD3d1", 
    SEI: "0x0000000000000000000000000000000000000000", // Native token
    WSEI: "0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7",
    ETH: "0x160345fC359604fC6e70E3c5fAcbdE5F7A9342d8",
    BTC: "0x30D6Ca5CCd7B21523516bF7c3A2E92C77F74E472",
  },
  "sei-testnet": {
    USDC: "0x3894085Ef7Ff0f0aeDf52E2A2704928d259f9c3a", 
    USDT: "0xB75D0B03c06A926e488e2659DF1A861F860bD3d1",
    SEI: "0x0000000000000000000000000000000000000000",
    WSEI: "0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7",
    ETH: "0x160345fC359604fC6e70E3c5fAcbdE5F7A9342d8",
    BTC: "0x30D6Ca5CCd7B21523516bF7c3A2E92C77F74E472",
  },
  "sei-devnet": {
    USDC: "0x3894085Ef7Ff0f0aeDf52E2A2704928d259f9c3a",
    USDT: "0xB75D0B03c06A926e488e2659DF1A861F860bD3d1", 
    SEI: "0x0000000000000000000000000000000000000000",
    WSEI: "0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7",
    ETH: "0x160345fC359604fC6e70E3c5fAcbdE5F7A9342d8",
    BTC: "0x30D6Ca5CCd7B21523516bF7c3A2E92C77F74E472",
  },
};

/**
 * Get configuration for a specific SEI chain
 */
export function getSeiChainConfig(network: SeiNetworkName): SeiChain {
  const config = seiChains[network];
  if (!config) {
    throw new Error(`Unsupported SEI network: ${network}`);
  }
  return config;
}

/**
 * Get the token address for a specific token on a network
 */
export function getTokenAddress(
  network: SeiNetworkName,
  tokenSymbol: string
): string {
  const networkTokens = TOKEN_ADDRESSES[network];
  if (!networkTokens) {
    throw new Error(`No token addresses configured for network: ${network}`);
  }
  
  const address = networkTokens[tokenSymbol.toUpperCase() as keyof typeof networkTokens];
  if (!address) {
    throw new Error(`Token ${tokenSymbol} not found on ${network}`);
  }
  
  return address;
}

/**
 * Validate and get SEI configuration from runtime settings
 */
export async function validateSeiConfig(runtime: any): Promise<SeiConfig> {
  try {
    const requiredEnvVars = ["SEI_RPC_URL"];
    const missingVars: string[] = [];

    // Get configuration values from runtime settings
    const rpcUrl = runtime.getSetting("SEI_RPC_URL");
    const chainId = runtime.getSetting("SEI_CHAIN_ID");
    const privateKey = runtime.getSetting("SEI_PRIVATE_KEY");
    const address = runtime.getSetting("SEI_ADDRESS");
    const network = runtime.getSetting("SEI_NETWORK") as SeiNetworkName;
    const dragonswapApiUrl = runtime.getSetting("DRAGONSWAP_API_URL");
    const oracleApiKey = runtime.getSetting("ORACLE_API_KEY");
    const yeiApiKey = runtime.getSetting("YEI_API_KEY");
    
    // Geographic configuration
    const userGeography = runtime.getSetting("USER_GEOGRAPHY");
    const perpPreference = runtime.getSetting("PERP_PREFERENCE");
    
    // Coinbase Advanced configuration
    const coinbaseApiKey = runtime.getSetting("COINBASE_ADVANCED_API_KEY");
    const coinbaseSecret = runtime.getSetting("COINBASE_ADVANCED_SECRET");
    const coinbasePassphrase = runtime.getSetting("COINBASE_ADVANCED_PASSPHRASE");
    const coinbaseSandbox = runtime.getSetting("COINBASE_SANDBOX");

    // Check for required variables
    for (const envVar of requiredEnvVars) {
      const key = envVar as keyof SeiConfig;
      if (key === "SEI_RPC_URL" && !rpcUrl) {
        missingVars.push(envVar);
      }
    }

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    // Validate network if provided
    if (network && !seiChains[network]) {
      throw new Error(
        `Invalid SEI_NETWORK: ${network}. Must be one of: ${Object.keys(seiChains).join(", ")}`
      );
    }

    const config: SeiConfig = {
        SEI_RPC_URL: rpcUrl || 'https://evm-rpc-testnet.sei-apis.com',
        SEI_CHAIN_ID: chainId,
        SEI_PRIVATE_KEY: privateKey,
        SEI_ADDRESS: address,
        SEI_NETWORK: network || "sei-testnet",
        DRAGONSWAP_API_URL: dragonswapApiUrl,
        ORACLE_API_KEY: oracleApiKey,
        YEI_API_KEY: yeiApiKey,
        USER_GEOGRAPHY: userGeography,
        PERP_PREFERENCE: perpPreference,
        COINBASE_ADVANCED_API_KEY: coinbaseApiKey,
        COINBASE_ADVANCED_SECRET: coinbaseSecret,
        COINBASE_ADVANCED_PASSPHRASE: coinbasePassphrase,
        COINBASE_SANDBOX: coinbaseSandbox === 'true' || coinbaseSandbox === true,
    };

    elizaLogger.log("SEI configuration validated successfully");
    return config;
  } catch (error) {
    elizaLogger.error("SEI configuration validation failed:", error);
    throw error;
  }
}

/**
 * Get SEI configuration for testing purposes
 */
export function getTestSeiConfig(): SeiConfig {
  return {
    SEI_RPC_URL: "https://evm-rpc-testnet.sei-apis.com",
    SEI_CHAIN_ID: "713715",
    SEI_NETWORK: "sei-testnet",
    DRAGONSWAP_API_URL: "https://api.dragonswap.app",
    ORACLE_API_KEY: "test-oracle-key",
    YEI_API_KEY: "test-yei-key",
    USER_GEOGRAPHY: 'GLOBAL',
    PERP_PREFERENCE: 'AUTO',
    COINBASE_SANDBOX: true,
  };
}

/**
 * Create a minimal runtime mock for testing
 */
export function createTestRuntime(overrides: Partial<SeiConfig> = {}) {
  const defaultConfig = getTestSeiConfig();
  const config = { ...defaultConfig, ...overrides };
  
  return {
    getSetting: (key: string) => {
      return config[key as keyof SeiConfig];
    }
  };
}

/**
 * Create Sei configuration with runtime integration
 */
export async function createSeiConfig(runtime?: any, rpcUrl?: string): Promise<SeiConfig> {
  if (runtime) {
    return await validateSeiConfig(runtime);
  }
  
  // Fallback configuration for testing
  return {
    SEI_RPC_URL: rpcUrl,
    SEI_NETWORK: "sei-testnet" as SeiNetworkName,
    USER_GEOGRAPHY: 'GLOBAL',
    PERP_PREFERENCE: 'AUTO',
    COINBASE_SANDBOX: true,
  } as SeiConfig;
}
