import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AMMLayerManager } from '../amm-layer';

describe('AMM-Specific Layer', () => {
  let manager: AMMLayerManager;
  let mockSeiCLOB: any;
  let rebalanceEvents: string[];
  let fallbackEvents: string[];

  beforeEach(() => {
    mockSeiCLOB = {
      placeRangeOrder: vi.fn(),
      updateRangeOrder: vi.fn(),
      cancelOrder: vi.fn(),
    };
    rebalanceEvents = [];
    fallbackEvents = [];
    manager = new AMMLayerManager(mockSeiCLOB, {
      onRebalance: (symbol) => rebalanceEvents.push(symbol),
      onFallback: (symbol) => fallbackEvents.push(symbol),
    });
  });

  it('should initialize multiple positions', async () => {
    const eth = await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    const btc = await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    expect(eth.range).toEqual({ min: 1800, max: 2200 });
    expect(btc.range).toEqual({ min: 29000, max: 31000 });
    expect(manager.getAnalytics('ETH/USDC')).toEqual({ fees: 0, slippage: 0, rebalances: 0 });
    expect(manager.getAnalytics('BTC/USDT')).toEqual({ fees: 0, slippage: 0, rebalances: 0 });
  });

  it('should rebalance and track analytics for each position with threshold and dynamic range', async () => {
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    // Should not rebalance if within threshold
    await manager.rebalance('ETH/USDC', 2205, 2, 0.5, 0.02);
    expect(manager.getAnalytics('ETH/USDC')).toEqual({ fees: 0, slippage: 0, rebalances: 0 });
    // Should rebalance if outside threshold
    await manager.rebalance('ETH/USDC', 2500, 2, 0.5, 0.02);
    expect(manager.getAnalytics('ETH/USDC')).toEqual({ fees: 2, slippage: 0.5, rebalances: 1 });
    // Dynamic range should update
    const newRange = manager.setDynamicRange('ETH/USDC', 2500, 0.05);
    expect(newRange).toEqual({ min: 2375, max: 2625 });
    // BTC position
    await manager.rebalance('BTC/USDT', 32000, 3, 0.2, 0.02);
    expect(manager.getAnalytics('BTC/USDT')).toEqual({ fees: 3, slippage: 0.2, rebalances: 1 });
    expect(rebalanceEvents).toEqual(['ETH/USDC', 'BTC/USDT']);
  });
  it('should report total analytics across all positions', async () => {
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    await manager.rebalance('ETH/USDC', 2500, 2, 0.5, 0.02);
    await manager.rebalance('BTC/USDT', 32000, 3, 0.2, 0.02);
    // Add a reporting method for total analytics
    const total = Object.keys(manager['positions']).reduce((acc, symbol) => {
      const a = manager.getAnalytics(symbol);
      if (a) {
        acc.fees += a.fees;
        acc.slippage += a.slippage;
        acc.rebalances += a.rebalances;
      }
      return acc;
    }, { fees: 0, slippage: 0, rebalances: 0 });
    expect(total).toEqual({ fees: 5, slippage: 0.7, rebalances: 2 });
  });

  it('should place fee-optimized range order for each symbol', async () => {
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    await manager.placeRangeOrder('ETH/USDC');
    await manager.placeRangeOrder('BTC/USDT');
    expect(mockSeiCLOB.placeRangeOrder).toHaveBeenCalledWith('ETH/USDC', { min: 1800, max: 2200 }, 1000);
    expect(mockSeiCLOB.placeRangeOrder).toHaveBeenCalledWith('BTC/USDT', { min: 29000, max: 31000 }, 500);
  });

  it('should fallback to options hedging for each position', async () => {
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    const ethFallback = await manager.handleEscape('ETH/USDC', 2500);
    const btcFallback = await manager.handleEscape('BTC/USDT', 32000);
    expect(ethFallback).toEqual('options-hedge-activated');
    expect(btcFallback).toEqual('options-hedge-activated');
    expect(fallbackEvents).toEqual(['ETH/USDC', 'BTC/USDT']);
  });

  it('should rebalance all positions automatically', async () => {
    await manager.initPosition('ETH/USDC', 1800, 2200, 1000);
    await manager.initPosition('BTC/USDT', 29000, 31000, 500);
    await manager.rebalanceAll({ 'ETH/USDC': 2250, 'BTC/USDT': 31500 }, 1, 0.1);
    expect(manager.getAnalytics('ETH/USDC')).toEqual({ fees: 1, slippage: 0.1, rebalances: 1 });
    expect(manager.getAnalytics('BTC/USDT')).toEqual({ fees: 1, slippage: 0.1, rebalances: 1 });
    expect(rebalanceEvents).toEqual(['ETH/USDC', 'BTC/USDT']);
  });
});
