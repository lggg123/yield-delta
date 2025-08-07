import type { Plugin } from "@elizaos/core";
import { evmWalletProvider } from "./providers/wallet";
import { oracleProvider } from "./providers/sei-oracle";

// Import all actions
import { transferAction } from "./actions/transfer";
import { dragonSwapTradeAction } from "./actions/dragonswap";
import { fundingArbitrageAction } from "./actions/funding-arbitrage";
import { perpsTradeAction } from "./actions/perp-trading";
import { rebalanceEvaluatorAction } from "./actions/rebalance";
import { yeiFinanceAction } from './actions/yei-finance';
import { ilProtectionAction } from "./actions/il-protection";
import { ammOptimizeAction } from './actions/amm-optimize';
import { deltaNeutralAction } from './actions/delta-neutral';
import { ammRiskEvaluator } from './evaluators/amm-risk';
import { AMMManagerProvider } from './providers/amm-manager';

// Import utilities and types from environment
import { 
  validateSeiConfig, 
  seiChains, 
  getSeiChainConfig, 
  getTokenAddress,
  type SeiConfig,
  type SeiChain,
  type SeiNetworkName
} from './environment';

console.log("SEI YIELD-DELTA PLUGIN IS BEING INITIALIZED");

export const seiYieldDeltaPlugin: Plugin = {
    name: "sei-yield-delta",
    description: "Advanced DeFi yield optimization and arbitrage strategies for SEI blockchain with IL protection",
    actions: [
        transferAction,
        dragonSwapTradeAction,
        fundingArbitrageAction,
        perpsTradeAction,
        rebalanceEvaluatorAction,
        yeiFinanceAction,
        ilProtectionAction,
        ammOptimizeAction,
        deltaNeutralAction
    ],
    evaluators: [
        ammRiskEvaluator
    ],
    providers: [
        evmWalletProvider as any,
        oracleProvider as any,
        AMMManagerProvider as any
    ],
};

// Export individual actions
export {
    transferAction,
    dragonSwapTradeAction,
    fundingArbitrageAction,
    perpsTradeAction,
    rebalanceEvaluatorAction,
    yeiFinanceAction,
    ilProtectionAction,
    ammOptimizeAction,
    deltaNeutralAction
};

// Export providers
export {
    evmWalletProvider,
    oracleProvider,
    AMMManagerProvider
};

// Export provider classes
export { WalletProvider } from "./providers/wallet";
export { SeiOracleProvider } from "./providers/sei-oracle";

// Export utilities and config types
export { 
  validateSeiConfig, 
  seiChains, 
  getSeiChainConfig, 
  getTokenAddress,
  type SeiConfig,
  type SeiChain,
  type SeiNetworkName
};

// Export other types
export type {
    DragonSwapTradeParams,
    DragonSwapPoolInfo,
    ArbitrageOpportunity,
    ArbitragePosition,
    PriceFeed,
    FundingRate,
    PortfolioAsset,
    RebalanceStrategy,
    PortfolioAnalysis,
    RebalanceRecommendation
} from "./types";

// Default export
export default seiYieldDeltaPlugin;
