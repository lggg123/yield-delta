import { AMMLayerManager } from '../amm-layer';

// Example: AMM risk evaluator for evaluators/amm-risk.ts
export const ammRiskEvaluator = {
  name: 'AMM_RISK_EVALUATOR',
  description: 'Evaluates risk and opportunity for AMM positions using analytics and price bands',
  validate: async (runtime: any, positions: any) => {
    return Array.isArray(positions) && positions.length > 0;
  },
  async handler(runtime: any, positions: any, _, __, callback: any) {
    const clob = runtime.seiClobProvider;
    const manager = new AMMLayerManager(clob);
    for (const p of positions) {
      await manager.initPosition(p.symbol, p.min, p.max, p.amount);
    }
    const riskReport = Object.keys(manager['positions']).map(symbol => {
      const analytics = manager.getAnalytics(symbol);
      const pos = manager['positions'][symbol];
      const riskLevel = (analytics && (analytics.rebalances > 2 || analytics.slippage > 1)) ? 'HIGH' : 'LOW';
      return { symbol, riskLevel, analytics, range: pos.range };
    });
    const result = { success: true, data: riskReport };
    if (callback) callback(result);
    return result;
  },
  examples: [
    {
      prompt: "Evaluate AMM risk for my positions",
      messages: [
        { name: "{{user1}}", content: { text: "Evaluate AMM risk for my positions" } },
        { name: "{{agentName}}", content: { action: "AMM_RISK_EVALUATOR", text: "AMM risk evaluation complete. Report: ..." } }
      ],
      outcome: "AMM risk evaluation complete. Report: ..." // ✅ Now a string
    }
  ]
};
