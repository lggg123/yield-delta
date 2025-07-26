import type { Token } from "@lifi/types";
import type {
    Account,
    Address,
    Chain,
    Hash,
    HttpTransport,
    PublicClient,
    WalletClient,
} from "viem";
import * as viemChains from "viem/chains";
export * from "./precompiles"

const _SupportedChainList = Object.keys([viemChains.seiDevnet, viemChains.seiTestnet, viemChains.sei]) as Array<
    keyof typeof viemChains
>;

export interface ChainWithName {
    name: string;
    chain: any
}

// Transaction types
export interface Transaction {
    hash: Hash;
    from: Address;
    to: string;
    value: bigint;
    data?: `0x${string}`;
    chainId?: number;
}

// Token types
export interface TokenWithBalance {
    token: Token;
    balance: bigint;
    formattedBalance: string;
    priceUSD: string;
    valueUSD: string;
}

export interface WalletBalance {
    chain: string;
    address: Address;
    totalValueUSD: string;
    tokens: TokenWithBalance[];
}

export interface ChainConfig {
    chain: Chain;
    publicClient: PublicClient<HttpTransport, Chain, Account | undefined>;
    walletClient?: WalletClient;
}

// Action parameters
export interface TransferParams {
    toAddress: string;
    amount: string;
    data?: `0x${string}`;
}

// Provider types
export interface TokenData extends Token {
    symbol: string;
    decimals: number;
    address: Address;
    name: string;
    logoURI?: string;
    chainId: number;
}

export interface ProviderError extends Error {
    code?: number;
    data?: unknown;
}

export interface DragonSwapTradeParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  slippage?: number; // in basis points (100 = 1%)
}

export interface DragonSwapPoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  price: string;
}

export interface ArbitrageOpportunity {
  symbol: string;
  cexFundingRate: number;
  targetExchange: string;
  expectedReturn: number;
  risk: 'low' | 'medium' | 'high';
  requiredCapital: number;
  hedgeAction: 'short_dex' | 'long_dex';
  confidence: number;
}

export interface ArbitragePosition {
  id: string;
  symbol: string;
  cexSide: 'long' | 'short';
  dexSide: 'long' | 'short';
  size: number;
  entryTime: number;
  expectedReturn: number;
  status: 'active' | 'closing' | 'closed';
  cexFundingCollected: number;
  netPnl: number;
}

export interface PriceFeed {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
  confidence: number;
}

export interface FundingRate {
  symbol: string;
  rate: number;
  timestamp: number;
  exchange: string;
  nextFundingTime: number;
}

export interface PortfolioAsset {
  symbol: string;
  balance: number;
  value: number;
  currentPercentage: number;
  targetPercentage: number;
  deviation: number;
  recommended: 'buy' | 'sell' | 'hold';
  amount?: number;
}

export interface RebalanceStrategy {
  name: string;
  description: string;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  allocations: Record<string, number>;
  rebalanceThreshold: number;
}

export interface PortfolioAnalysis {
  totalValue: number;
  assets: PortfolioAsset[];
  strategy: RebalanceStrategy;
  rebalanceNeeded: boolean;
  recommendations: RebalanceRecommendation[];
}

export interface RebalanceRecommendation {
  asset: string;
  action: 'buy' | 'sell';
  amount: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}