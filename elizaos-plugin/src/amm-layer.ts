export type LiquidityRange = { min: number; max: number };

export type PositionAnalytics = {
  fees: number;
  slippage: number;
  rebalances: number;
};

export class AMMLayerManager {
  private clob: any;
  private positions: Record<string, { range: LiquidityRange; amount: number; analytics: PositionAnalytics }> = {};
  private onRebalance?: (symbol: string, pos: any) => void;
  private onFallback?: (symbol: string) => void;

  constructor(clob: any, hooks?: { onRebalance?: (symbol: string, pos: any) => void; onFallback?: (symbol: string) => void }) {
    this.clob = clob;
    if (hooks) {
      this.onRebalance = hooks.onRebalance;
      this.onFallback = hooks.onFallback;
    }
  }

  async initPosition(symbol: string, min: number, max: number, amount: number) {
    this.positions[symbol] = {
      range: { min, max },
      amount,
      analytics: { fees: 0, slippage: 0, rebalances: 0 }
    };
    return this.positions[symbol];
  }

  // Advanced: Dynamically adjust range based on volatility or price bands
  setDynamicRange(symbol: string, price: number, volatility: number = 0.05) {
    // Example: set range to price ± volatility band
    const band = price * volatility;
    if (this.positions[symbol]) {
      this.positions[symbol].range.min = price - band;
      this.positions[symbol].range.max = price + band;
    }
    return this.positions[symbol]?.range;
  }

  async rebalance(symbol: string, newPrice: number, fee = 0, slippage = 0, threshold: number = 0.02) {
    const pos = this.positions[symbol];
    if (!pos) return null;
    // Only rebalance if price moves outside threshold of current range
    const minThreshold = pos.range.min - (pos.range.min * threshold);
    const maxThreshold = pos.range.max + (pos.range.max * threshold);
    if (newPrice < minThreshold || newPrice > maxThreshold) {
      // Optionally use dynamic range adjustment
      this.setDynamicRange(symbol, newPrice);
      pos.analytics.rebalances++;
      pos.analytics.fees += fee;
      pos.analytics.slippage += slippage;
      if (this.onRebalance) this.onRebalance(symbol, pos);
      await this.placeRangeOrder(symbol);
    }
    return pos;
  }

  async placeRangeOrder(symbol: string) {
    const pos = this.positions[symbol];
    if (!pos) return null;
    return this.clob.placeRangeOrder(symbol, pos.range, pos.amount);
  }

  async handleEscape(symbol: string, price: number) {
    const pos = this.positions[symbol];
    if (!pos) return null;
    if (price > pos.range.max || price < pos.range.min) {
      if (this.onFallback) this.onFallback(symbol);
      // Fallback to options hedging
      return 'options-hedge-activated';
    }
    return 'in-range';
  }

  getAnalytics(symbol: string): PositionAnalytics | null {
    const pos = this.positions[symbol];
    return pos ? pos.analytics : null;
  }

  async rebalanceAll(prices: Record<string, number>, fee = 0, slippage = 0, threshold: number = 0.02) {
    for (const symbol of Object.keys(prices)) {
      await this.rebalance(symbol, prices[symbol], fee, slippage, threshold);
    }
  }
}


