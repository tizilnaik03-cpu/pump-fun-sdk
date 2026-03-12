# Tutorial 28: Advanced Analytics & Price Quotes

> Master every quote function in the SDK — calculate buy/sell prices, measure price impact, track graduation progress, and build real-time price feeds.

## Prerequisites

- Node.js 18+
- `@nirholas/pump-sdk` installed
- Understanding of [Tutorial 05](./05-bonding-curve-math.md) (bonding curve basics)

```bash
npm install @nirholas/pump-sdk @solana/web3.js bn.js
```

## The Quote Function Family

The SDK provides several quote functions, each answering a different pricing question:

| Function | Question It Answers |
|----------|-------------------|
| `getBuyTokenAmountFromSolAmount` | "How many tokens do I get for X SOL?" |
| `getBuySolAmountFromTokenAmount` | "How much SOL to buy X tokens?" |
| `getSellSolAmountFromTokenAmount` | "How much SOL do I get for selling X tokens?" |
| `calculateBuyPriceImpact` | "How much does my buy move the price?" |
| `calculateSellPriceImpact` | "How much does my sell move the price?" |
| `getTokenPrice` | "What's the current buy/sell price per token?" |
| `bondingCurveMarketCap` | "What's the total market cap?" |
| `getGraduationProgress` | "How close is the token to graduating?" |
| `getBondingCurveSummary` | "Give me everything at once" |

## Step 1: Set Up State Fetching

All analytics functions need on-chain state. Fetch it once and reuse:
