import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import { SeiOracleProvider } from "../providers/sei-oracle";
import { validateSeiConfig } from "../environment";

const yeiFinanceTemplate = `Respond to messages about YEI Finance lending and borrowing operations.

YEI Finance is a decentralized lending protocol on Sei that offers:
- Multi-oracle price feeds (API3, Pyth, Redstone)
- Collateralized lending and borrowing
- Liquidation protection
- Interest rate optimization

Recent messages:
{{recentMessages}}

Current message: "{{currentMessage}}"

Respond with detailed information about YEI Finance operations, including current rates, oracle prices, and lending opportunities.

Response should be helpful and informative about DeFi lending strategies.`;

export const yeiFinanceAction: Action = {
  name: "YEI_FINANCE",
  similes: [
    "YEI_LENDING",
    "YEI_BORROWING", 
    "YEI_ORACLE",
    "YEI_RATES"
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = validateSeiConfig(runtime);
    const content = message.content?.text?.toLowerCase() || '';
    
    const yeiKeywords = [
      'yei finance', 'yei lending', 'yei borrow', 'yei oracle',
      'lending rates', 'borrow rates', 'collateral', 'liquidation',
      'api3', 'multi oracle', 'defi lending'
    ];
    
    return yeiKeywords.some(keyword => content.includes(keyword));
  },
  description: "Get information about YEI Finance lending protocol, rates, and oracle prices",
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      const config = validateSeiConfig(runtime);
      const oracle = new SeiOracleProvider(runtime);
      
      const content = message.content?.text?.toLowerCase() || '';
      
      let response = "";
      
      if (content.includes('lending rates') || content.includes('borrow rates')) {
        response = `YEI Finance Lending Rates:
• Multi-oracle price feeds ensure accurate valuations
• API3 dAPI (Primary) + Pyth Network (Backup) + Redstone (Fallback)
• Competitive interest rates with liquidation protection
• Current supported assets: BTC, ETH, SEI, USDC, USDT

For real-time rates, prices are fetched from our multi-oracle system.`;
      } else if (content.includes('oracle') || content.includes('api3') || content.includes('pyth')) {
        // Try to get some sample prices
        try {
          const btcPrice = await oracle.getPrice('BTC');
          const ethPrice = await oracle.getPrice('ETH');
          
          response = `YEI Finance Multi-Oracle System:
🔹 API3 dAPI: Primary oracle source with high accuracy
🔹 Pyth Network: 100+ publishers for price consensus  
🔹 Redstone Classic: Backup for stablecoin pairs

Current Prices (Multi-Oracle):
${btcPrice ? `• BTC: $${btcPrice.price.toFixed(2)} (${btcPrice.source})` : '• BTC: Price unavailable'}
${ethPrice ? `• ETH: $${ethPrice.price.toFixed(2)} (${ethPrice.source})` : '• ETH: Price unavailable'}

This multi-oracle approach provides manipulation resistance and high reliability.`;
        } catch (error) {
          response = `YEI Finance Multi-Oracle System:
🔹 API3 dAPI: Primary oracle source
� Pyth Network: Backup with 100+ publishers
🔹 Redstone Classic: Fallback for stablecoins

The multi-oracle system ensures price accuracy and manipulation resistance for safe lending operations.`;
        }
      } else {
        response = `YEI Finance - Advanced DeFi Lending Protocol:

🏦 **Core Features:**
• Multi-collateral lending and borrowing
• API3 + Pyth + Redstone oracle integration
• Automated liquidation protection
• Interest rate optimization

🔒 **Security:**
• Multi-oracle price validation
• Manipulation-resistant pricing
• Smart contract audited protocols

📊 **Supported Assets:**
• BTC, ETH, SEI (Native)
• USDC, USDT (Stablecoins)

💡 **Benefits:**
• Higher capital efficiency
• Lower liquidation risks
• Competitive interest rates
• Transparent on-chain operations

Ask about specific lending rates, oracle prices, or collateral requirements!`;
      }

      if (callback) {
        callback({
          text: response,
          content: { 
            text: response,
            source: 'yei-finance',
            action: 'YEI_FINANCE'
          }
        });
      }

    } catch (error) {
      console.error("Error in YEI Finance action:", error);
      
      if (callback) {
        callback({
          text: "I encountered an error fetching YEI Finance information. Please try again.",
          content: { 
            error: error instanceof Error ? error.message : 'Unknown error',
            action: 'YEI_FINANCE'
          }
        });
      }
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What are the current YEI Finance lending rates?" }
      },
      {
        name: "{{agentName}}",
        content: { 
          text: "Let me check the current YEI Finance lending rates and oracle prices...",
          action: "YEI_FINANCE"
        }
      }
    ],
    [
      {
        name: "{{user1}}",  
        content: { text: "How does YEI Finance's multi-oracle system work?" }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "YEI Finance uses a sophisticated multi-oracle strategy...",
          action: "YEI_FINANCE"
        }
      }
    ]
  ]
};