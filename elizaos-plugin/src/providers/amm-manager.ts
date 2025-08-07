import { AMMLayerManager } from '../amm-layer';

// Example: AMM provider for providers/amm-manager.ts
export class AMMManagerProvider {
  private manager: AMMLayerManager;
  constructor(clob: any, hooks?: { onRebalance?: (symbol: string, pos: any) => void; onFallback?: (symbol: string) => void }) {
    this.manager = new AMMLayerManager(clob, hooks);
  }
  getManager() {
    return this.manager;
  }
  // Optionally expose more provider methods
}
