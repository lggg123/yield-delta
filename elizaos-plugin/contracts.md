# Sei Perpetual Protocols Contract Addresses

## 🔧 Configuration Required

To enable real perpetual trading, you need to configure the contract addresses for perpetual protocols on Sei.

### Top Perpetual DEXes on Sei:

#### 1. **Vortex Protocol** (Recommended)
- **Description**: Leading perpetual DEX on Sei with deep liquidity
- **Testnet Contract**: `TBD - Contact Vortex team`
- **Mainnet Contract**: `TBD - Contact Vortex team`
- **Documentation**: https://docs.vortexprotocol.io
- **API**: https://api.vortexprotocol.io

#### 2. **Dragonswap Perps** (Alternative)
- **Description**: Native Sei DEX with perpetual futures
- **Testnet Contract**: `TBD - Check Dragonswap docs`
- **Mainnet Contract**: `TBD - Check Dragonswap docs`
- **Documentation**: https://docs.dragonswap.app
- **API**: https://api.dragonswap.app

#### 3. **Astroport Perps** (Alternative)
- **Description**: Multi-chain DEX with Sei deployment
- **Testnet Contract**: `TBD - Check Astroport docs`
- **Mainnet Contract**: `TBD - Check Astroport docs`
- **Documentation**: https://docs.astroport.fi

## 🛠️ How to Get Contract Addresses:

### Method 1: Protocol Documentation
1. Visit the protocol's official docs
2. Look for "Contract Addresses" or "Deployments" section
3. Find Sei network contracts

### Method 2: Block Explorer
1. Go to https://seistream.app (Sei block explorer)
2. Search for the protocol name
3. Find verified contracts

### Method 3: GitHub Repositories
1. Find the protocol's GitHub
2. Look for deployment scripts or addresses in README
3. Check `deployments/` or `contracts/` folders

### Method 4: Direct Contact
1. Join the protocol's Discord/Telegram
2. Ask for official contract addresses
3. Verify with multiple sources

## 📝 Update Instructions:

Once you have the addresses, update them in `/src/actions/perp-trading.ts`:

```typescript
// Replace these placeholder addresses:
this.contractAddress = isTestnet 
  ? '0x123abc...def' as `0x${string}`  // Real testnet address
  : '0x456def...abc' as `0x${string}`; // Real mainnet address
```

## ⚠️ Security Notes:

1. **Always verify** contract addresses from official sources
2. **Test on testnet** before using mainnet
3. **Start with small amounts** when testing
4. **Double-check** the protocol's audit reports
5. **Use verified contracts** only

## 🔗 Useful Links:

- **Sei Official**: https://sei.io
- **Sei Docs**: https://docs.sei.io
- **Sei Block Explorer**: https://seistream.app
- **Sei Ecosystem**: https://ecosystem.sei.io
- **DeFiLlama Sei**: https://defillama.com/chain/Sei

---

**Note**: The current implementation uses placeholder addresses. Real trading will only work after configuring actual protocol contracts.
