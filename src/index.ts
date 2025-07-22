import type { Plugin } from "@elizaos/core";
import { evmWalletProvider } from "./providers/wallet";
import { oracleProvider } from "./providers/sei-oracle";

// Import all actions
import { transferAction } from "./actions/transfer";
import { dragonSwapTradeAction } from "./actions/dragonswap";
import { fundingArbitrageAction } from "./actions/funding-arbitrage";
import { perpsTradeAction } from "./actions/perp-trading";
import { rebalanceEvaluatorAction } from "./actions/rebalance";

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
    description: "Advanced DeFi yield optimization and arbitrage strategies for SEI blockchain",
    actions: [
        transferAction,
        dragonSwapTradeAction,
        fundingArbitrageAction,
        perpsTradeAction,
        rebalanceEvaluatorAction
    ],
    evaluators: [],
    providers: [
        evmWalletProvider,
        oracleProvider
    ],
};

// Export individual actions
export {
    transferAction,
    dragonSwapTradeAction,
    fundingArbitrageAction,
    perpsTradeAction,
    rebalanceEvaluatorAction
};

// Export providers
export {
    evmWalletProvider,
    oracleProvider
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
