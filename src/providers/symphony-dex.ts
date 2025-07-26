import { createPublicClient, http, Address } from 'viem';
import { seiTestnet, sei } from 'viem/chains';

interface SymphonyConfig {
  timeout: number;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  nativeAddress: string;
  wrappedNativeAddress: string;
  slippage: string;
  publicClient: any;
  tokens: Record<string, TokenData>;
  additionalTokens: Record<string, TokenData>;
  overrideDefaultTokens: boolean;
  feeParams: {
    paramFee: string;
    feeAddress: string;
    feeSharePercentage: string;
  };
}

interface TokenData {
  id: string;
  attributes: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string;
  };
}

interface SwapQuote {
  amountIn: string;
  amountOut: string;
  route: any[];
  priceImpact: string;
  gasEstimate: string;
  exchange: 'symphony';
}

export class SymphonyDexProvider {
  private config: SymphonyConfig;
  private publicClient: any;

  constructor(networkConfig: { network: string; rpcUrl: string }) {
    const chain = networkConfig.network === 'mainnet' ? sei : seiTestnet;
    
    this.publicClient = createPublicClient({
      chain,
      transport: http(networkConfig.rpcUrl)
    });

    this.config = {
      timeout: 10000,
      chainId: networkConfig.network === 'mainnet' ? 1329 : 1328,
      chainName: "sei",
      rpcUrl: networkConfig.rpcUrl,
      nativeAddress: "0x0",
      wrappedNativeAddress: "0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7",
      slippage: "0.5",
      publicClient: this.publicClient,
      tokens: {},
      additionalTokens: {},
      overrideDefaultTokens: false,
      feeParams: {
        paramFee: "0",
        feeAddress: "0x0000000000000000000000000000000000000000",
        feeSharePercentage: "0",
      },
    };
  }

  /**
   * Helper method to create fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get swap quote from Symphony DEX
   */
  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    slippage?: string
  ): Promise<SwapQuote> {
    try {
      const symphonySlippage = slippage || this.config.slippage;
      
      const quoteUrl = `https://api.symphony.finance/v1/quote`;
      const params = new URLSearchParams({
        tokenIn: tokenIn.toLowerCase(),
        tokenOut: tokenOut.toLowerCase(),
        amountIn,
        slippage: symphonySlippage,
        chainId: this.config.chainId.toString()
      });

      const response = await this.fetchWithTimeout(`${quoteUrl}?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Symphony API error: ${response.status}`);
      }

      const quoteData = await response.json();

      return {
        amountIn,
        amountOut: quoteData.amountOut,
        route: quoteData.route || [],
        priceImpact: quoteData.priceImpact || "0",
        gasEstimate: quoteData.gasEstimate || "150000",
        exchange: 'symphony'
      };

    } catch (error: unknown) {
      console.error('Symphony quote error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get Symphony quote: ${errorMessage}`);
    }
  }

  /**
   * Execute swap on Symphony DEX
   */
  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    minAmountOut: string,
    walletAddress: string,
    slippage?: string
  ): Promise<any> {
    try {
      const symphonySlippage = slippage || this.config.slippage;

      const swapUrl = `https://api.symphony.finance/v1/swap`;
      
      const swapParams = {
        tokenIn: tokenIn.toLowerCase(),
        tokenOut: tokenOut.toLowerCase(),
        amountIn,
        minAmountOut,
        recipient: walletAddress,
        slippage: symphonySlippage,
        chainId: this.config.chainId
      };

      const response = await this.fetchWithTimeout(swapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(swapParams)
      });

      if (!response.ok) {
        throw new Error(`Symphony swap error: ${response.status}`);
      }

      const swapData = await response.json();
      return swapData;

    } catch (error: unknown) {
      console.error('Symphony swap execution error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to execute Symphony swap: ${errorMessage}`);
    }
  }

  /**
   * Get supported tokens from Symphony
   */
  async getSupportedTokens(): Promise<Record<string, TokenData>> {
    try {
      const tokensUrl = `https://api.symphony.finance/v1/tokens?chainId=${this.config.chainId}`;
      
      const response = await this.fetchWithTimeout(tokensUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch Symphony tokens: ${response.status}`);
      }

      const tokens = await response.json();
      return tokens;

    } catch (error) {
      console.error('Failed to fetch Symphony tokens:', error);
      // Return fallback token list
      return {
        "0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7": {
          id: "sei_0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7",
          attributes: {
            address: "0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7",
            name: "Wrapped SEI",
            symbol: "WSEI",
            decimals: 18,
            logoUrl: "https://symphony.finance/tokens/wsei.png"
          }
        }
      };
    }
  }

  /**
   * Add custom tokens to Symphony configuration
   */
  addCustomTokens(customTokens: Record<string, TokenData>) {
    this.config.additionalTokens = {
      ...this.config.additionalTokens,
      ...customTokens
    };
  }

  /**
   * Get best route for a swap (considers multiple paths)
   */
  async getBestRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<any> {
    try {
      const routeUrl = `https://api.symphony.finance/v1/route`;
      const params = {
        tokenIn: tokenIn.toLowerCase(),
        tokenOut: tokenOut.toLowerCase(),
        amountIn,
        chainId: this.config.chainId
      };

      const response = await this.fetchWithTimeout(routeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        throw new Error(`Symphony routing error: ${response.status}`);
      }

      return await response.json();

    } catch (error: unknown) {
      console.error('Symphony routing error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get Symphony route: ${errorMessage}`);
    }
  }
}