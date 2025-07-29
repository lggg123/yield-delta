import { AMMLayerManager } from '../amm-layer';

// Example: AMM optimization action for actions/amm-optimize.ts
export const ammOptimizeAction = {
  name: 'AMM_OPTIMIZE',
  description: 'Optimizes concentrated liquidity ranges and rebalances positions using Sei CLOB',
  validate: async (runtime: any, message: any) => {
    const text = message.content?.text?.toLowerCase() || "";
    return text.includes('optimize') && (text.includes('lp') || text.includes('amm'));
  },
  async handler(runtime: any, message: any, _, __, callback: any) {
    const clob = runtime.seiClobProvider;
    const manager = new AMMLayerManager(clob);
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    await manager.rebalanceAll({ 'ETH/USDC': 2500, 'BTC/USDT': 32000 }, 2, 0.5, 0.02);
    const analytics = Object.keys(manager['positions']).map(symbol => ({ symbol, ...manager.getAnalytics(symbol) }));
    callback({ text: `AMM optimization complete. Analytics: ${JSON.stringify(analytics)}` });
  },
  examples: [
    [
      { content: { text: 'Optimize my LP positions for ETH/USDC and BTC/USDT' } },
      { content: { action: 'AMM_OPTIMIZE' } }
    ]
  ]
};
