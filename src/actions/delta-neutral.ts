// Delta Neutral strategy action for combining LP positions with perpetual hedging
export const deltaNeutralAction = {
  name: 'DELTA_NEUTRAL',
  description: 'Execute delta neutral strategy combining LP positions with perpetual hedging',
  
  validate: async (runtime: any, message: any) => {
    const text = message.content?.text?.toLowerCase() || '';
    return (text.includes('delta') && text.includes('neutral')) ||
           (text.includes('market') && text.includes('neutral')) ||
           text.includes('delta neutral');
  },

  handler: async (runtime: any, message: any, state: any, options: any, callback: any) => {
    try {
      const text = message.content?.text?.toLowerCase() || '';
      
      if (text.includes('info') || text.includes('help') || text.includes('explain')) {
        await callback({
          text: `🔄 **Delta Neutral Strategy Commands:**

• **"execute delta neutral strategy for [PAIR]"** - Start delta neutral position
• **"delta neutral optimization"** - Get AI-optimized parameters  
• **"market neutral LP for [PAIR]"** - Create market-neutral liquidity position

**What is Delta Neutral?**
A delta neutral strategy combines:
1. **Concentrated LP positions** to earn fees
2. **Perpetual hedging** to minimize price risk
3. **AI optimization** for optimal parameters

This strategy profits from volatility and fees while staying market-neutral.`,
          content: { type: 'help' }
        });
        return;
      }

      // Extract trading pair from message
      const pairMatch = text.match(/(eth\/usdc|btc\/usdt|sei\/usdc|atom\/sei)/);
      const pair = pairMatch ? pairMatch[1].toUpperCase() : 'ETH/USDC';

      // Call Python AI for delta neutral optimization
      const aiEngineUrl = runtime.getSetting?.('AI_ENGINE_URL') || 'http://localhost:8000';
      
      const requestBody = {
        pair,
        position_size: 10000,
        current_price: pair.includes('BTC') ? 32000 : 2500,
        volatility: 0.25,
        market_conditions: {
          funding_rate: 0.01,
          liquidity_depth: 5000000
        }
      };

      const response = await fetch(`${aiEngineUrl}/predict/delta-neutral-optimization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`AI optimization failed: ${response.status}`);
      }

      const optimization = await response.json();

      await callback({
        text: `🎯 **Delta Neutral Strategy Executed for ${pair}**

🔄 **Strategy Details:**
• Hedge Ratio: ${(optimization.hedge_ratio * 100).toFixed(1)}%
• Market Neutrality: ${(optimization.expected_neutrality * 100).toFixed(1)}%
• Expected APR: ${(optimization.expected_apr * 100).toFixed(1)}%

💰 **Revenue Breakdown:**
• LP Fees: $${optimization.revenue_breakdown.lp_fees.toLocaleString()}
• Funding Rates: $${optimization.revenue_breakdown.funding_rates.toLocaleString()}
• Volatility Capture: $${optimization.revenue_breakdown.volatility_capture.toLocaleString()}

📊 **Position Range:**
• Lower Price: $${optimization.lower_price.toFixed(2)}
• Upper Price: $${optimization.upper_price.toFixed(2)}

🤖 **AI Analysis:**
${optimization.reasoning}`,
        content: {
          type: 'delta_neutral_execution',
          optimization
        }
      });

    } catch (error) {
      await callback({
        text: `❌ Error executing delta neutral strategy: ${error instanceof Error ? error.message : 'Unknown error'}

💡 **Troubleshooting:**
• Check if AI engine is running on port 8000
• Verify network connectivity  
• Try again with a simpler command like "delta neutral info"`,
        content: { type: 'error' }
      });
    }
  },

  examples: [
    [
      { name: 'user', content: { text: 'execute delta neutral strategy for ETH/USDC' } },
      { name: 'agent', content: { action: 'DELTA_NEUTRAL', text: 'Delta Neutral Strategy Executed for ETH/USDC...' } }
    ],
    [
      { name: 'user', content: { text: 'delta neutral info' } },
      { name: 'agent', content: { action: 'DELTA_NEUTRAL', text: 'Delta Neutral Strategy Commands...' } }
    ]
  ]
};