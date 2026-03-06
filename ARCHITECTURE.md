# Architecture

> System design and data flow for the Pump SDK (`@pump-fun/pump-sdk`).

---

## 📋 Table of Contents

- [Overview](#overview)
- [System Diagram](#system-diagram)
- [Directory Structure](#directory-structure)
- [Core Modules](#core-modules)
- [On-Chain Programs](#on-chain-programs)
- [Data Flow](#data-flow)
- [Token Lifecycle](#token-lifecycle)
- [Dependencies](#dependencies)
- [Design Decisions](#design-decisions)

---

## Overview

Pump SDK is an **offline-first TypeScript SDK** for the Pump protocol on Solana. It separates instruction building (pure functions, no I/O) from state fetching (RPC calls), allowing developers to compose transactions in any environment — browsers, servers, or scripts.

The SDK interfaces with three on-chain programs: **Pump** (bonding curves), **PumpAMM** (graduated AMM pools), and **PumpFees** (fee sharing). All instruction builders return `TransactionInstruction[]` — the SDK never signs or sends transactions.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
│                                                                  │
│   import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk"   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌──────────────────┐     ┌────────────────────────┐
    │     PumpSdk      │     │    OnlinePumpSdk        │
    │    (offline)      │     │  (extends PumpSdk)      │
    │                  │     │                        │
    │ • createV2       │     │ • fetchBondingCurve    │
    │ • buyInstructions│     │ • fetchBuyState        │
    │ • sellInstructions│    │ • fetchGraduationProgress│
    │ • feeSharing     │     │ • fetchTokenPrice      │
    │ • ammInstructions│     │ • collectCreatorFees   │
    │ • decodeEvents   │     │ • claimTokenIncentives │
    └────────┬─────────┘     └───────────┬────────────┘
             │                           │
             │  TransactionInstruction[]  │  + RPC fetchers
             ▼                           ▼
    ┌─────────────────────────────────────────────────┐
    │              Anchor IDL Codegen Layer             │
    │                                                  │
    │   pump.json  │  pump_amm.json  │  pump_fees.json │
    └────────────────────────┬────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────┐
    │                 Solana Blockchain                 │
    │                                                  │
    │  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
    │  │   Pump   │  │  PumpAMM  │  │  PumpFees    │ │
    │  │  6EF8r.. │  │  pAMMB..  │  │  pfeeU..     │ │
    │  └──────────┘  └───────────┘  └──────────────┘ │
    └─────────────────────────────────────────────────┘
```

---

## Directory Structure

```
pump-fun-sdk/
├── src/                          # Core SDK source
│   ├── index.ts                  # Public API exports
│   ├── sdk.ts                    # PumpSdk — offline instruction builder
│   ├── onlineSdk.ts              # OnlinePumpSdk — extends with RPC fetchers
│   ├── bondingCurve.ts           # Bonding curve math (buy/sell/market cap)
│   ├── fees.ts                   # Fee calculation (tiered, protocol, creator)
│   ├── pda.ts                    # Program Derived Address derivation
│   ├── state.ts                  # Account state interfaces & event types
│   ├── analytics.ts              # Price impact, graduation, token price
│   ├── tokenIncentives.ts        # Volume reward calculations
│   ├── errors.ts                 # Custom error types
│   ├── idl/                      # Anchor IDL definitions (auto-generated)
│   │   ├── pump.json             # Pump program IDL
│   │   ├── pump.ts               # Pump program TypeScript types
│   │   ├── pump_amm.json         # PumpAMM program IDL
│   │   ├── pump_amm.ts           # PumpAMM TypeScript types
│   │   ├── pump_fees.json        # PumpFees program IDL
│   │   └── pump_fees.ts          # PumpFees TypeScript types
│   └── __tests__/                # Unit tests
│       ├── bondingCurve.test.ts  # Bonding curve math tests
│       ├── fees.test.ts          # Fee calculation tests
│       ├── analytics.test.ts     # Analytics function tests
│       ├── pda.test.ts           # PDA derivation tests
│       ├── state.test.ts         # State enum tests
│       ├── tokenIncentives.test.ts # Token incentive calc tests
│       └── fixtures.ts           # Shared test data
├── rust/                         # Rust vanity address generator
│   ├── src/                      # Rayon + solana-sdk implementation
│   ├── benches/                  # Criterion benchmarks
│   └── tests/                    # Rust integration tests
├── typescript/                   # TypeScript vanity generator (educational)
├── telegram-bot/                 # PumpFun activity monitor bot
├── websocket-server/             # Real-time token launch relay
├── live/                         # Browser dashboards (launches + trades)
├── channel-bot/                  # Channel monitoring bot
├── x402/                         # HTTP 402 micropayment protocol
├── tutorials/                    # 19 hands-on SDK tutorial guides
├── scripts/                      # Bash wrappers (generate, verify, batch)
├── tests/                        # Cross-language integration tests
├── docs/                         # Extended documentation
├── security/                     # Security audits and checklists
└── website/                      # PumpOS web desktop
```

---

## Core Modules

| Module | File | Purpose | Key Exports |
|--------|------|---------|-------------|
| **SDK (offline)** | `sdk.ts` | Instruction builders for all 3 programs | `PumpSdk`, `PUMP_SDK`, program IDs |
| **SDK (online)** | `onlineSdk.ts` | RPC fetchers + convenience methods | `OnlinePumpSdk` |
| **Bonding Curve** | `bondingCurve.ts` | Buy/sell quoting, market cap | `getBuyTokenAmountFromSolAmount`, `getSellSolAmountFromTokenAmount`, `bondingCurveMarketCap` |
| **Fees** | `fees.ts` | Fee calculation with market-cap tiers | `getFee`, `computeFeesBps`, `calculateFeeTier` |
| **PDA** | `pda.ts` | Program Derived Address derivation | `bondingCurvePda`, `creatorVaultPda`, `canonicalPumpPoolPda`, 20+ more |
| **State** | `state.ts` | Account interfaces, event types, enums | `Global`, `BondingCurve`, `Pool`, `TradeEvent`, `Platform` |
| **Analytics** | `analytics.ts` | Price impact, graduation, pricing | `calculateBuyPriceImpact`, `getGraduationProgress`, `getTokenPrice` |
| **Token Incentives** | `tokenIncentives.ts` | Volume reward calculations | `totalUnclaimedTokens`, `currentDayTokens` |
| **Errors** | `errors.ts` | Typed errors for fee validation | `InvalidShareTotalError`, `DuplicateShareholderError`, etc. |
| **IDL** | `idl/` | Anchor IDL for all 3 programs | `Pump`, `PumpAmm`, `PumpFees` types |

---

## On-Chain Programs

### Pump Program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)

Handles the bonding curve lifecycle:
- Token creation (`create`, `createV2`)
- Buy/sell on bonding curve
- Migration to AMM on graduation
- Creator fee collection
- Volume accumulator tracking

### PumpAMM Program (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)

Handles graduated token trading:
- Constant-product AMM pool operations
- Buy/sell on AMM pools
- Liquidity provision (deposit/withdraw)
- LP token management
- Creator fee accumulation

### PumpFees Program (`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`)

Handles fee distribution:
- Fee sharing configuration (up to 10 shareholders)
- Social fee PDAs (referral accounts linked to social platforms)
- Fee distribution execution
- Authority transfer and revocation

---

## Data Flow

### Buy on Bonding Curve

```
1. App calls sdk.fetchBuyState(mint, user)
   └─ RPC: getMultipleAccountsInfo([global, feeConfig, bondingCurve, userATA])

2. App calls sdk.buyInstructions({ ...buyState, mint, user, solAmount, slippage })
   └─ SDK computes:
      a. Token amount from bonding curve math
      b. Fee from tiered fee schedule
      c. Slippage-adjusted maxSolCost
   └─ Returns: TransactionInstruction[]

3. App adds instructions to Transaction, signs, sends to Solana
   └─ Pump program executes on-chain:
      a. Transfer SOL from user → bonding curve
      b. Mint tokens to user's ATA
      c. Collect fee to fee recipient
      d. Update bonding curve reserves
      e. Emit TradeEvent
```

### Buy on AMM (Post-Graduation)

```
1. App calls sdk.fetchPool(mint) to get Pool state
2. App calls sdk.ammBuyInstruction({ user, pool, mint, ... })
   └─ Returns: TransactionInstruction
3. App signs + sends
   └─ PumpAMM program executes constant-product swap
```

### Fee Sharing Flow

```
1. Creator calls sdk.createFeeSharingConfig({ creator, mint, pool })
   └─ Creates SharingConfig account on PumpFees program

2. Creator calls sdk.updateFeeShares({ authority, mint, shareholders })
   └─ Validates: 1-10 shareholders, total = 10,000 BPS, no duplicates
   └─ Updates SharingConfig on-chain

3. Anyone calls sdk.distributeCreatorFees({ mint, sharingConfig })
   └─ Distributes accumulated fees to shareholders proportionally
```

---

## Token Lifecycle

```
         createV2Instruction
               │
               ▼
┌──────────────────────────┐
│      BONDING CURVE        │
│  (Pump Program)           │
│                          │
│  buy/sell against curve  │
│  price ∝ supply²         │
│  fees: tiered by mcap    │
└─────────────┬────────────┘
              │ realTokenReserves → 0
              │ (graduation threshold)
              ▼
┌──────────────────────────┐
│       MIGRATION           │
│  migrateInstruction       │
│                          │
│  Creates AMM pool         │
│  Seeds liquidity          │
│  Sets bondingCurve.       │
│    complete = true        │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│       AMM POOL            │
│  (PumpAMM Program)        │
│                          │
│  ammBuy/ammSell          │
│  deposit/withdraw (LP)   │
│  constant-product pricing │
│  creator fee accumulation │
└──────────────────────────┘
```

---

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `@coral-xyz/anchor` | ^0.31.1 | IDL-based program interaction — type-safe instruction building |
| `@solana/web3.js` | ^1.98.2 | Solana primitives (`PublicKey`, `TransactionInstruction`, `Connection`) |
| `@solana/spl-token` | ^0.4.13 | SPL Token program utilities (ATA creation, token operations) |
| `bn.js` | ^5.2.2 | Arbitrary-precision integers for all financial math |
| `@pump-fun/pump-swap-sdk` | ^1.13.0 | AMM swap instruction generation for PumpAMM |

### Dev Dependencies (Selected)

| Package | Purpose |
|---------|---------|
| `jest` / `ts-jest` | Test runner with TypeScript support |
| `tsup` | Dual CJS + ESM build tool |
| `eslint` + `prettier` | Linting and formatting |
| `typescript` | Type checking (strict mode) |
| `bs58` | Base58 encoding (dev/test only) |

---

## Design Decisions

### Offline-First Architecture

**Decision**: Separate instruction building from RPC state fetching.

**Rationale**: Instruction building is a pure function — given the right inputs, it always produces the same instructions. By isolating this in `PumpSdk`, the SDK works in offline environments, enables better testing (no RPC mocking), and gives developers full control over transaction composition.

**Tradeoff**: Users must fetch state themselves (or use `OnlinePumpSdk`). This adds one call but provides explicit control over caching and batching.

### BN for All Amounts

**Decision**: Use `bn.js` for every token/lamport amount, never `number`.

**Rationale**: Solana token amounts with 6-9 decimals routinely exceed JavaScript's safe integer limit (2^53). A 1B supply token with 6 decimals is `1_000_000_000_000_000` — beyond `Number.MAX_SAFE_INTEGER`. Using `BN` everywhere prevents silent precision loss.

**Tradeoff**: More verbose API (`new BN(100_000_000)` vs `100_000_000`). Worth the safety guarantee.

### TransactionInstruction[] Return Type

**Decision**: Return `TransactionInstruction[]` instead of `Transaction` objects.

**Rationale**: Returning instructions (not transactions) gives developers complete control over:
- Transaction grouping (combine instructions from different sources)
- Priority fees and compute budget
- Signing strategy (single signer, multisig, hardware wallet)
- Versioned vs. legacy transactions

**Tradeoff**: Slightly more work for simple cases. For production use, this flexibility is essential.

### Three-Program Architecture

**Decision**: Interact with three separate programs (Pump, PumpAMM, PumpFees) rather than a single monolithic program.

**Rationale**: This mirrors the on-chain architecture. Each program has a distinct responsibility:
- Pump: bonding curve lifecycle
- PumpAMM: graduated constant-product pools
- PumpFees: fee configuration and distribution

The SDK provides `BothPrograms` methods (e.g., `claimTokenIncentivesBothPrograms`) that aggregate across Pump + PumpAMM for convenience.

### Singleton Pattern

**Decision**: Export `PUMP_SDK` as a pre-instantiated `PumpSdk` singleton.

**Rationale**: `PumpSdk` is stateless (no connection, no mutable state). A singleton avoids unnecessary instantiation and provides a convenient import for most use cases.
