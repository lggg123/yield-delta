import { AMMLayerManager } from '../amm-layer';
import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';

// ElizaOS-compatible AMM provider for providers/amm-manager.ts
export class AMMManagerProvider implements Provider {
  private manager: AMMLayerManager;
  
  name = 'AMM_MANAGER';
  description = 'Provides AMM layer management for SEI yield optimization strategies';

  constructor(clob?: any, hooks?: { onRebalance?: (symbol: string, pos: any) => void; onFallback?: (symbol: string) => void }) {
    this.manager = new AMMLayerManager(clob, hooks);
  }

  // Required ElizaOS Provider interface method
  async get(runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> {
    try {
      const managerStatus = {
        isActive: true,
        supportedPools: [],
        activeStrategies: [],
        lastUpdate: new Date().toISOString()
      };

      return {
        text: `AMM Manager Status: ${JSON.stringify(managerStatus, null, 2)}`,
        values: managerStatus,
        data: {
          provider: 'AMM_MANAGER',
          timestamp: Date.now()
        }
      };
    } catch (error) {
      return {
        text: `AMM Manager unavailable: ${error instanceof Error ? error.message : String(error)}`,
        values: { error: true },
        data: {
          provider: 'AMM_MANAGER',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        }
      };
    }
  }

  getManager() {
    return this.manager;
  }
  
  // Optionally expose more provider methods
}

// Export instance for use in plugin
export const AMMManagerProvider_Instance = new AMMManagerProvider();
