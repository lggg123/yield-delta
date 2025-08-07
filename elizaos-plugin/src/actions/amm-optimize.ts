import { AMMLayerManager } from '../amm-layer';

// AI-Enhanced AMM optimization action for actions/amm-optimize.ts
export const ammOptimizeAction = {
  name: 'AMM_OPTIMIZE',
  description: 'Optimizes concentrated liquidity ranges and rebalances positions using Sei CLOB with AI assistance',
  validate: async (runtime: any, message: any) => {
    const text = message.content?.text?.toLowerCase() || "";
    return (text.includes('optimize') && (text.includes('lp') || text.includes('amm') || text.includes('liquidity'))) ||
           (text.includes('lp') && text.includes('optimization')) ||
           (text.includes('concentrated') && text.includes('liquidity'));
  },
  async handler(runtime: any, message: any, state: any, options: any, callback: any) {
    try {
      // Get AI engine URL from runtime settings
      const aiEngineUrl = runtime.getSetting?.('AI_ENGINE_URL') || 'http://localhost:8000';
      
      // Extract trading pair from message (default to ETH/USDC)
      const text = message.content?.text?.toLowerCase() || '';
      const pairMatch = text.match(/(eth\/usdc|btc\/usdt|sei\/usdc|atom\/sei)/);
      const defaultPair = pairMatch ? pairMatch[1] : 'eth/usdc';
      
      // Get AI optimization for the position
      const requestBody = {
        vault_address: '0x1234567890123456789012345678901234567890',
        current_price: defaultPair.includes('btc') ? 32000 : 2500,
        volatility: 0.3,
        volume_24h: 1000000,
        liquidity: 500000,
        timeframe: '1d',
        chain_id: 713715
      };

      let aiOptimization: any = null;
      try {
        const response = await fetch(`${aiEngineUrl}/predict/optimal-range`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          aiOptimization = await response.json();
        }
      } catch (aiError) {
        console.log('AI optimization unavailable, using fallback strategy');
      }

      // Initialize CLOB manager with mock if needed
      const clob = runtime.seiClobProvider || {
        placeRangeOrder: async () => ({ success: true, orderId: 'mock-order-123' })
      };
      
      const manager = new AMMLayerManager(clob);
      
      if (aiOptimization) {
        // Use AI-optimized parameters
        const symbol = defaultPair.toUpperCase().replace('/', '/');
        await manager.initPosition(
          symbol, 
          aiOptimization.lower_tick, 
          aiOptimization.upper_tick, 
          1000
        );
        
        await callback({
          text: `🤖 AI-optimized AMM position created for ${symbol}

📊 **AI Analysis:**
• Lower Tick: ${aiOptimization.lower_tick}
• Upper Tick: ${aiOptimization.upper_tick}
• Confidence: ${(aiOptimization.confidence * 100).toFixed(1)}%
• Expected APR: ${(aiOptimization.expected_apr * 100).toFixed(1)}%

${aiOptimization.reasoning}`,
          content: {
            type: 'amm_optimization',
            optimization: aiOptimization
          }
        });
      } else {
        // Fallback to basic optimization
        await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
        await manager.initPosition('BTC/USDT', 29000, 31000, 500);
        await manager.rebalanceAll({ 'ETH/USDC': 2500, 'BTC/USDT': 32000 }, 2, 0.5, 0.02);
        const analytics = Object.keys(manager['positions']).map(symbol => ({ symbol, ...manager.getAnalytics(symbol) }));
        
        await callback({
          text: `AMM optimization complete. Analytics: ${JSON.stringify(analytics)}`,
          content: {
            type: 'amm_optimization',
            analytics
          }
        });
      }
    } catch (error) {
      await callback({
        text: `Error optimizing AMM positions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        content: {
          type: 'error'
        }
      });
    }
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: 'Optimize my LP positions for ETH/USDC and BTC/USDT' } },
      { name: "{{agentName}}", content: { action: 'AMM_OPTIMIZE', text: 'AMM optimization complete. Analytics: ...' } }
    ]
  ]
};
