import {
  elizaLogger,
} from "@elizaos/core";
import { CoinbaseAdvancedProvider, LiquidityPosition, HedgeStrategy } from './coinbase-advanced';
import { PerpsTradeParams, PerpsPosition } from '../actions/perp-trading';

export interface GeographicConfig {
  USER_GEOGRAPHY: 'US' | 'EU' | 'ASIA' | 'GLOBAL';
  PERP_PREFERENCE: 'GEOGRAPHIC' | 'GLOBAL' | 'COINBASE_ONLY' | 'ONCHAIN_ONLY';
  COINBASE_ADVANCED_API_KEY?: string;
  COINBASE_ADVANCED_SECRET?: string;
  COINBASE_ADVANCED_PASSPHRASE?: string;
  COINBASE_SANDBOX?: boolean;
}

export interface PerpProvider {
  name: string;
  geographic: boolean;
  regulated: boolean;
  openPosition(params: PerpsTradeParams): Promise<string | null>;
  closePosition(symbol: string, size?: string): Promise<string | null>;
  getPositions(): Promise<PerpsPosition[]>;
  getHedgeRecommendation?(lpPosition: LiquidityPosition): Promise<HedgeStrategy>;
}

export interface HedgeResult {
  success: boolean;
  provider: string;
  txHash?: string;
  hedgeRatio: number;
  expectedILReduction: string;
  error?: string;
}

export interface ProtectionStrategy {
  type: 'PERP_HEDGE' | 'OPTIONS_COLLAR' | 'REBALANCE_ONLY';
  provider: string;
  hedgeRatio: number;
  expectedILReduction: string;
  txHash?: string;
  cost?: string;
  reason: string;
}

export class GeographicTradingRouter {
  private config: GeographicConfig;
  private coinbaseProvider?: CoinbaseAdvancedProvider;

  constructor(config: GeographicConfig) {
    this.config = config;
    
    // Initialize Coinbase provider if credentials are available
    if (this.config.COINBASE_ADVANCED_API_KEY && 
        this.config.COINBASE_ADVANCED_SECRET && 
        this.config.COINBASE_ADVANCED_PASSPHRASE) {
      this.coinbaseProvider = new CoinbaseAdvancedProvider({
        apiKey: this.config.COINBASE_ADVANCED_API_KEY,
        apiSecret: this.config.COINBASE_ADVANCED_SECRET,
        passphrase: this.config.COINBASE_ADVANCED_PASSPHRASE,
        sandbox: this.config.COINBASE_SANDBOX || false,
      });
    }
  }

  async getBestPerpProvider(): Promise<PerpProvider> {
    const preference = this.config.PERP_PREFERENCE;
    const geography = this.config.USER_GEOGRAPHY;

    elizaLogger.log(`Selecting perp provider for ${geography} with preference ${preference}`);

    // Force Coinbase if specified
    if (preference === 'COINBASE_ONLY') {
      if (this.coinbaseProvider) {
        return this.createCoinbaseWrapper();
      } else {
        throw new Error('Coinbase credentials not configured');
      }
    }

    // Force on-chain if specified
    if (preference === 'ONCHAIN_ONLY') {
      return this.createOnChainWrapper();
    }

    // Geographic routing
    switch (geography) {
      case 'US':
        // Prefer Coinbase in US for regulatory compliance
        if (this.coinbaseProvider && (preference === 'GEOGRAPHIC' || preference === 'GLOBAL')) {
          elizaLogger.log('Using Coinbase Advanced for US user');
          return this.createCoinbaseWrapper();
        }
        // Fallback to on-chain if Coinbase not available
        elizaLogger.log('Fallback to on-chain perps for US user');
        return this.createOnChainWrapper();

      case 'EU':
        // EU can use global exchanges or on-chain
        if (preference === 'GEOGRAPHIC') {
          elizaLogger.log('Using on-chain perps for EU user (geographic preference)');
          return this.createOnChainWrapper();
        }
        // Could add Bybit/other EU-compliant exchanges here
        return this.createOnChainWrapper();

      case 'ASIA':
        // Asia has access to most global exchanges
        elizaLogger.log('Using on-chain perps for ASIA user');
        return this.createOnChainWrapper();

      default: // GLOBAL
        // Choose best option based on preference
        if (this.coinbaseProvider && preference === 'GEOGRAPHIC') {
          return this.createCoinbaseWrapper();
        }
        return this.createOnChainWrapper();
    }
  }

  private createCoinbaseWrapper(): PerpProvider {
    if (!this.coinbaseProvider) {
      throw new Error('Coinbase provider not initialized');
    }

    return {
      name: 'Coinbase Advanced',
      geographic: true,
      regulated: true,
      openPosition: (params: PerpsTradeParams) => this.coinbaseProvider!.openPerpPosition(params),
      closePosition: (symbol: string, size?: string) => this.coinbaseProvider!.closePerpPosition(symbol, size),
      getPositions: () => this.coinbaseProvider!.getPositions(),
      getHedgeRecommendation: (lpPosition: LiquidityPosition) => this.coinbaseProvider!.getHedgeRecommendation(lpPosition),
    };
  }

  private createOnChainWrapper(): PerpProvider {
    // This would wrap the existing Sei on-chain perps system
    return {
      name: 'Sei On-Chain Perps',
      geographic: false,
      regulated: false,
      openPosition: async (params: PerpsTradeParams) => {
        // This would call the existing PerpsAPI from perp-trading.ts
        elizaLogger.log('On-chain perp trading not yet implemented in wrapper');
        return null;
      },
      closePosition: async (symbol: string, size?: string) => {
        elizaLogger.log('On-chain perp closing not yet implemented in wrapper');
        return null;
      },
      getPositions: async () => {
        elizaLogger.log('On-chain position query not yet implemented in wrapper');
        return [];
      },
    };
  }

  async executeGeographicHedge(lpPosition: LiquidityPosition): Promise<HedgeResult> {
    try {
      elizaLogger.log(`Executing geographic hedge for LP position: ${lpPosition.baseToken}/${lpPosition.quoteToken}`);

      const provider = await this.getBestPerpProvider();
      
      if (!provider.getHedgeRecommendation) {
        throw new Error(`Provider ${provider.name} does not support hedge recommendations`);
      }

      const hedgeStrategy = await provider.getHedgeRecommendation(lpPosition);
      
      const hedgeParams: PerpsTradeParams = {
        symbol: hedgeStrategy.symbol,
        size: hedgeStrategy.size,
        side: hedgeStrategy.action.toLowerCase() as 'long' | 'short',
        leverage: 1, // Conservative leverage for hedging
        slippage: 50, // 0.5% slippage tolerance
      };

      const txHash = await provider.openPosition(hedgeParams);

      if (txHash) {
        return {
          success: true,
          provider: provider.name,
          txHash,
          hedgeRatio: parseFloat(hedgeStrategy.size) / lpPosition.value,
          expectedILReduction: hedgeStrategy.expectedILReduction,
        };
      } else {
        return {
          success: false,
          provider: provider.name,
          hedgeRatio: 0,
          expectedILReduction: '0%',
          error: 'Failed to execute hedge position',
        };
      }
    } catch (error) {
      elizaLogger.error('Geographic hedge execution failed:', error);
      return {
        success: false,
        provider: 'unknown',
        hedgeRatio: 0,
        expectedILReduction: '0%',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getProviderCapabilities(): Promise<any> {
    const provider = await this.getBestPerpProvider();
    return {
      name: provider.name,
      geographic: provider.geographic,
      regulated: provider.regulated,
      supportsHedging: !!provider.getHedgeRecommendation,
      geography: this.config.USER_GEOGRAPHY,
      preference: this.config.PERP_PREFERENCE,
    };
  }

  async getAvailableProviders(): Promise<string[]> {
    const providers: string[] = [];
    
    if (this.coinbaseProvider) {
      providers.push('Coinbase Advanced');
    }
    
    providers.push('Sei On-Chain Perps');
    
    return providers;
  }
}
