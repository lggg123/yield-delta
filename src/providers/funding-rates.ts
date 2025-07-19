import { Provider, IAgentRuntime, elizaLogger } from “@ai16z/eliza”;

export interface FundingRateData {
exchange: string;
symbol: string;
fundingRate: number;
fundingTime: Date;
nextFundingTime: Date;
markPrice: number;
indexPrice: number;
premium: number;
}

export interface ArbitrageOpportunity {
longExchange: string;
shortExchange: string;
fundingSpread: number; // Difference in funding rates
estimatedProfit: number; // Per $1000 position
confidence: number; // 0-1 score
riskLevel: ‘LOW’ | ‘MEDIUM’ | ‘HIGH’;
}

export class FundingRateProvider implements Provider {
private cache: Map<string, FundingRateData[]> = new Map();
private lastUpdate: Date = new Date(0);
private updateInterval = 5 * 60 * 1000; // 5 minutes

constructor(private runtime: IAgentRuntime) {}

async get(symbol: string = “SEI-USDT”): Promise<FundingRateData[]> {
const now = new Date();
const cacheKey = symbol.toUpperCase();

```
// Return cached data if still fresh
if (
  this.cache.has(cacheKey) && 
  now.getTime() - this.lastUpdate.getTime() < this.updateInterval
) {
  return this.cache.get(cacheKey)!;
}

try {
  elizaLogger.log(`Fetching funding rates for ${symbol}...`);
  
  const exchangePromises = [
    this.getBinanceFunding(symbol),
    this.getBybitFunding(symbol),
    this.getBitMEXFunding(symbol),
    this.getHuobiFunding(symbol),
    this.getHyperliquidFunding(symbol),
    this.getKrakenFunding(symbol),
    this.getWooXFunding(symbol)
  ];

  const results = await Promise.allSettled(exchangePromises);
  const fundingRates: FundingRateData[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      fundingRates.push(result.value);
    } else {
      const exchanges = ['Binance', 'Bybit', 'BitMEX', 'Huobi', 'Hyperliquid', 'Kraken', 'WooX'];
      elizaLogger.warn(`Failed to fetch from ${exchanges[index]}:`, result.status === 'rejected' ? result.reason : 'No data');
    }
  });

  this.cache.set(cacheKey, fundingRates);
  this.lastUpdate = now;

  elizaLogger.log(`Successfully fetched funding rates from ${fundingRates.length} exchanges`);
  return fundingRates;
} catch (error) {
  elizaLogger.error("Error fetching funding rates:", error);
  return this.cache.get(cacheKey) || [];
}
```

}

async findArbitrageOpportunities(symbol: string = “SEI-USDT”): Promise<ArbitrageOpportunity[]> {
const fundingRates = await this.get(symbol);
if (fundingRates.length < 2) return [];

```
const opportunities: ArbitrageOpportunity[] = [];

// Compare each exchange pair
for (let i = 0; i < fundingRates.length; i++) {
  for (let j = i + 1; j < fundingRates.length; j++) {
    const rate1 = fundingRates[i];
    const rate2 = fundingRates[j];
    
    const spread = Math.abs(rate1.fundingRate - rate2.fundingRate);
    
    // Only consider opportunities with significant spread (>0.01% = 10bps)
    if (spread > 0.0001) {
      const longExchange = rate1.fundingRate > rate2.fundingRate ? rate2.exchange : rate1.exchange;
      const shortExchange = rate1.fundingRate > rate2.fundingRate ? rate1.exchange : rate2.exchange;
      
      opportunities.push({
        longExchange,
        shortExchange, 
        fundingSpread: spread,
        estimatedProfit: this.calculateProfit(spread, 1000), // Per $1000
        confidence: this.calculateConfidence(rate1, rate2),
        riskLevel: this.assessRisk(spread, rate1, rate2)
      });
    }
  }
}

return opportunities.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
```

}

private async getBinanceFunding(symbol: string): Promise<FundingRateData | null> {
try {
const binanceSymbol = symbol.replace(’-’, ‘’);
const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`);
const data = await response.json();

```
  return {
    exchange: 'Binance',
    symbol,
    fundingRate: parseFloat(data.lastFundingRate),
    fundingTime: new Date(data.fundingTime),
    nextFundingTime: new Date(data.nextFundingTime),
    markPrice: parseFloat(data.markPrice),
    indexPrice: parseFloat(data.indexPrice),
    premium: parseFloat(data.markPrice) - parseFloat(data.indexPrice)
  };
} catch (error) {
  elizaLogger.error("Binance funding error:", error);
  return null;
}
```

}

private async getBybitFunding(symbol: string): Promise<FundingRateData | null> {
try {
const bybitSymbol = symbol.replace(’-’, ‘’);
const response = await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${bybitSymbol}&limit=1`);
const data = await response.json();

```
  if (data.result?.list?.[0]) {
    const latest = data.result.list[0];
    return {
      exchange: 'Bybit',
      symbol,
      fundingRate: parseFloat(latest.fundingRate),
      fundingTime: new Date(parseInt(latest.fundingRateTimestamp)),
      nextFundingTime: new Date(parseInt(latest.fundingRateTimestamp) + 8 * 60 * 60 * 1000),
      markPrice: parseFloat(latest.markPrice || '0'),
      indexPrice: parseFloat(latest.indexPrice || '0'),
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("Bybit funding error:", error);
  return null;
}
```

}

private async getBitMEXFunding(symbol: string): Promise<FundingRateData | null> {
try {
const bitmexSymbol = symbol.replace(’-’, ‘’);
const response = await fetch(`https://www.bitmex.com/api/v1/funding?symbol=${bitmexSymbol}&count=1&reverse=true`);
const data = await response.json();

```
  if (data[0]) {
    return {
      exchange: 'BitMEX',
      symbol,
      fundingRate: data[0].fundingRate || 0,
      fundingTime: new Date(data[0].timestamp),
      nextFundingTime: new Date(Date.now() + 8 * 60 * 60 * 1000), // Estimate
      markPrice: 0,
      indexPrice: 0,
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("BitMEX funding error:", error);
  return null;
}
```

}

private async getHuobiFunding(symbol: string): Promise<FundingRateData | null> {
try {
const huobiSymbol = symbol.replace(’-’, ‘_’).toLowerCase();
const response = await fetch(`https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate?contract_code=${huobiSymbol}`);
const data = await response.json();

```
  if (data.data?.[0]) {
    const latest = data.data[0];
    return {
      exchange: 'Huobi',
      symbol,
      fundingRate: parseFloat(latest.funding_rate),
      fundingTime: new Date(latest.funding_time),
      nextFundingTime: new Date(latest.next_funding_time),
      markPrice: 0,
      indexPrice: 0,
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("Huobi funding error:", error);
  return null;
}
```

}

private async getHyperliquidFunding(symbol: string): Promise<FundingRateData | null> {
try {
const response = await fetch(‘https://api.hyperliquid.xyz/info’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({
type: ‘metaAndAssetCtxs’
})
});
const data = await response.json();

```
  // Find SEI funding data in response
  const seiData = data[1]?.find((asset: any) => asset.coin === 'SEI');
  if (seiData?.funding) {
    return {
      exchange: 'Hyperliquid',
      symbol,
      fundingRate: parseFloat(seiData.funding),
      fundingTime: new Date(),
      nextFundingTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      markPrice: parseFloat(seiData.markPx || '0'),
      indexPrice: parseFloat(seiData.indexPx || '0'),
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("Hyperliquid funding error:", error);
  return null;
}
```

}

private async getKrakenFunding(symbol: string): Promise<FundingRateData | null> {
try {
const krakenSymbol = `PF_${symbol.replace('-', '')}`;
const response = await fetch(`https://futures.kraken.com/derivatives/api/v3/instruments/${krakenSymbol}`);
const data = await response.json();

```
  if (data.result?.fundingRate !== undefined) {
    return {
      exchange: 'Kraken',
      symbol,
      fundingRate: parseFloat(data.result.fundingRate),
      fundingTime: new Date(),
      nextFundingTime: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
      markPrice: parseFloat(data.result.markPrice || '0'),
      indexPrice: parseFloat(data.result.indexPrice || '0'),
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("Kraken funding error:", error);
  return null;
}
```

}

private async getWooXFunding(symbol: string): Promise<FundingRateData | null> {
try {
const wooSymbol = symbol.replace(’-’, ‘_’);
const response = await fetch(`https://api.woo.org/v1/public/funding_rate/${wooSymbol}`);
const data = await response.json();

```
  if (data.fundingRate !== undefined) {
    return {
      exchange: 'WooX',
      symbol,
      fundingRate: parseFloat(data.fundingRate),
      fundingTime: new Date(data.fundingRateEpoch * 1000),
      nextFundingTime: new Date((data.fundingRateEpoch + 8 * 60 * 60) * 1000),
      markPrice: 0,
      indexPrice: 0,
      premium: 0
    };
  }
  return null;
} catch (error) {
  elizaLogger.error("WooX funding error:", error);
  return null;
}
```

}

private calculateProfit(spread: number, notional: number): number {
// 8-hour funding rate applied 3 times per day
return spread * notional * 3 * 365; // Annualized
}

private calculateConfidence(rate1: FundingRateData, rate2: FundingRateData): number {
// Higher confidence for larger, more established exchanges
const exchangeScores: { [key: string]: number } = {
‘Binance’: 1.0,
‘Bybit’: 0.9,
‘BitMEX’: 0.8,
‘Huobi’: 0.7,
‘Hyperliquid’: 0.8,
‘Kraken’: 0.8,
‘WooX’: 0.6
};

```
return Math.min(
  (exchangeScores[rate1.exchange] || 0.5) * 
  (exchangeScores[rate2.exchange] || 0.5), 
  1.0
);
```

}

private assessRisk(spread: number, rate1: FundingRateData, rate2: FundingRateData): ‘LOW’ | ‘MEDIUM’ | ‘HIGH’ {
if (spread > 0.001) return ‘LOW’;      // >10bps spread
if (spread > 0.0005) return ‘MEDIUM’;  // >5bps spread  
return ‘HIGH’;                         // <5bps spread
}
}