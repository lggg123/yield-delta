import type { Plugin } from "@elizaos/core";
import { evmWalletProvider } from "./providers/wallet.ts";
import { oracleProvider } from "./providers/sei-oracle.ts";

// Import all actions
import { transferAction } from "./actions/transfer";
import { dragonSwapTradeAction } from "./actions/dragonswap";
import { fundingArbitrageAction } from "./actions/funding-arbitrage";
import { perpsTradeAction } from "./actions/perp-trading";
import { rebalanceEvaluatorAction } from "./actions/rebalance";

// Import evaluators (if you have any)
// import { riskEvaluator } from "./evaluators/risk";

console.log("SEI YIELD-DELTA PLUGIN IS BEING INITIALIZED");

export const seiPlugin: Plugin = {
    name: "sei-yield-delta",
    description: "Advanced DeFi yield optimization and arbitrage strategies for SEI blockchain",
    actions: [
        transferAction,
        dragonSwapTradeAction,
        fundingArbitrageAction,
        perpsTradeAction,
        rebalanceEvaluatorAction
    ],
    evaluators: [
        // Add evaluators here when you create them
        // riskEvaluator
    ],
    providers: [
        evmWalletProvider,
        oracleProvider
    ],
};

// Export individual components for advanced usage
export {
    // Actions
    transferAction,
    dragonSwapTradeAction,
    fundingArbitrageAction,
    perpsTradeAction,
    rebalanceEvaluatorAction,
    
    // Providers
    evmWalletProvider,
    oracleProvider,
    
    // Types
    type DragonSwapTradeParams,
    type ArbitrageOpportunity,
    type ArbitragePosition,
    type PriceFeed,
    type FundingRate
} from "./types";

// Export provider classes for direct usage
export { WalletProvider } from "./providers/wallet";
export { SeiOracleProvider } from "./providers/sei-oracle";

// Export action collection for easy integration
export const yieldDeltaActions = [
    transferAction,
    dragonSwapTradeAction,
    fundingArbitrageAction,
    perpsTradeAction,
    rebalanceEvaluatorAction
];

export default seiPlugin;
