# Pump SDK Tutorials

> 19 hands-on tutorials for building on the Pump protocol with `@pump-fun/pump-sdk`.

## Getting Started

```bash
npm install @pump-fun/pump-sdk @solana/web3.js @coral-xyz/anchor bn.js
```

## Learning Path

**New to the SDK?** Follow the Core → Math → Advanced progression:

```
 01 Create Token → 02 Buy → 03 Sell → 04 Atomic Create+Buy
                                ↓
              05 Bonding Curve Math → 09 Fee System
                                ↓
        06 Migration → 07 Fee Sharing → 08 Token Incentives
                                ↓
              10 PDAs → 12 Offline vs Online → 15 Decode Accounts
                                ↓
         11 Trading Bot → 16 Monitoring Claims → 17 Dashboard
                                ↓
              18 Telegram Bot → 19 CoinGecko Integration
```

**Just want to build something specific?** Jump directly:

| I want to... | Start here |
|--------------|-----------|
| Launch a token | [Tutorial 01](./01-create-token.md) |
| Build a trading bot | [Tutorial 11](./11-trading-bot.md) |
| Set up fee sharing | [Tutorial 07](./07-fee-sharing.md) |
| Monitor on-chain activity | [Tutorial 16](./16-monitoring-claims.md) |
| Build a live dashboard | [Tutorial 17](./17-monitoring-website.md) |
| Build a Telegram bot | [Tutorial 18](./18-telegram-bot.md) |
| Generate vanity addresses | [Tutorial 13](./13-vanity-addresses.md) |
| Add paywalled APIs | [Tutorial 14](./14-x402-paywalled-apis.md) |
| Understand the math | [Tutorial 05](./05-bonding-curve-math.md) |

## Tutorials

### Core Token Operations

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 01 | [Create Your First Token](./01-create-token.md) | `createV2Instruction`, metadata, mint keypair | Beginner |
| 02 | [Buy Tokens from a Bonding Curve](./02-buy-tokens.md) | `buyInstructions`, `fetchBuyState`, slippage | Beginner |
| 03 | [Sell Tokens](./03-sell-tokens.md) | `sellInstructions`, `fetchSellState`, partial sells | Beginner |
| 04 | [Create and Buy Atomically](./04-create-and-buy.md) | `createV2AndBuyInstructions`, atomic transactions, frontrun protection | Beginner |

### Math & Pricing

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 05 | [Bonding Curve Math](./05-bonding-curve-math.md) | `getBuyTokenAmountFromSolAmount`, constant-product AMM, price impact | Intermediate |

### Advanced Operations

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 06 | [Token Migration to PumpAMM](./06-migration.md) | `migrateInstruction`, graduation detection, progress tracking, AMM pools | Intermediate |
| 07 | [Fee Sharing Setup](./07-fee-sharing.md) | `createFeeSharingConfig`, shareholders, BPS allocation | Intermediate |
| 08 | [Token Incentives](./08-token-incentives.md) | `claimTokenIncentives`, volume accumulators, daily rewards | Intermediate |
| 09 | [Fee System Deep Dive](./09-fee-system.md) | `computeFeesBps`, tiered fees, `FeeConfig`, supply-based tiers | Intermediate |

### Architecture & Infrastructure

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 10 | [Working with PDAs](./10-working-with-pdas.md) | `bondingCurvePda`, `feeSharingConfigPda`, all PDA derivation | Intermediate |
| 11 | [Building a Trading Bot](./11-trading-bot.md) | State monitoring, trade strategy, automated execution, slippage | Advanced |
| 12 | [Offline SDK vs Online SDK](./12-offline-vs-online.md) | `PumpSdk` vs `OnlinePumpSdk`, hybrid patterns, when to use each | Intermediate |

### Tools & Integrations

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 13 | [Generating Vanity Addresses](./13-vanity-addresses.md) | Rust generator, TypeScript generator, shell scripts, security | Beginner |
| 14 | [x402 Paywalled APIs](./14-x402-paywalled-apis.md) | HTTP 402, USDC micropayments, Express middleware, auto-paying client | Advanced |
| 15 | [Decoding On-Chain Accounts](./15-decoding-accounts.md) | `decodeGlobal`, `decodeBondingCurve`, batch decoding, account types | Intermediate |

### Monitoring & Operations

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 16 | [Monitoring Claims](./16-monitoring-claims.md) | Unclaimed tokens, creator vaults, fee distributions, cashback, real-time polling | Intermediate |

### Full-Stack & Integrations

| # | Tutorial | Topics | Difficulty |
|---|---------|--------|------------|
| 17 | [Build a Monitoring Website](./17-monitoring-website.md) | Live dashboard, real-time bonding curve UI, WebSocket integration | Advanced |
| 18 | [Telegram Bot](./18-telegram-bot.md) | Price alerts, claim checking, graduation notifications, grammY framework | Advanced |
| 19 | [CoinGecko Integration](./19-coingecko-integration.md) | SOL/USD prices, token discovery, price comparison, API usage | Intermediate |

## Prerequisites

- **Node.js 18+** (20+ recommended)
- A Solana wallet with devnet SOL (`solana airdrop 2`)
- Basic TypeScript knowledge
- For tutorials 13+: familiarity with the core SDK from tutorials 01-04

## Key Concepts

Before you start, here's the terminology used throughout the tutorials:

| Term | Meaning |
|------|---------|
| **Bonding curve** | The initial price discovery mechanism — a constant-product AMM that determines token price based on virtual reserves |
| **Graduation** | When a bonding curve fills up and migrates to PumpAMM |
| **PumpAMM** | The constant-product AMM pool that graduated tokens trade on |
| **Lamports** | Smallest unit of SOL. `1 SOL = 1,000,000,000 lamports` |
| **BN** | `bn.js` — the library used for all financial math (avoids JavaScript number precision loss) |
| **PDA** | Program Derived Address — deterministic addresses derived from seeds and a program ID |
| **BPS** | Basis points. `1 BPS = 0.01%`. `10,000 BPS = 100%` |
| **Mayhem mode** | Alternate PDA routing through the Mayhem program (set per-token at creation) |

## Resources

- [Getting Started Guide](../docs/getting-started.md) — SDK installation and first transaction
- [Ecosystem Overview](../docs/ecosystem.md) — everything in this repository
- [API Reference](../docs/api-reference.md) — every exported function and type
- [Examples](../docs/examples.md) — 20+ standalone code examples
- [Troubleshooting](../docs/TROUBLESHOOTING.md) — common issues and fixes

