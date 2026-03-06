import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getBuySolAmountFromTokenAmount,
  getSellSolAmountFromTokenAmount,
  bondingCurveMarketCap,
  getGraduationProgress,
  getTokenPrice,
  getBondingCurveSummary,
} from "@pump-fun/pump-sdk";
import type { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { publicKeySchema, bnStringSchema } from "../utils/validation.js";
import { lamportsToSol, rawToTokens, formatBN } from "../utils/formatting.js";
import { success, error, getErrorMessage } from "../types.js";
import type { ToolResult } from "../types.js";

// ── get_buy_quote ──
export const getBuyQuoteSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
  solAmount: bnStringSchema.describe("SOL amount in lamports"),
});

export async function getBuyQuote(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getBuyQuoteSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const solAmount = new BN(params.solAmount);
    const global = await sdk.fetchGlobal();
    const feeConfig = await sdk.fetchFeeConfig();
    const bondingCurve = await sdk.fetchBondingCurve(mint);

    const tokensOut = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.virtualTokenReserves,
      bondingCurve,
      amount: solAmount,
    });

    return success({
      inputAmount: formatBN(solAmount),
      inputUnit: "lamports",
      inputSol: lamportsToSol(solAmount),
      outputAmount: formatBN(tokensOut),
      outputUnit: "raw tokens",
      outputTokens: rawToTokens(tokensOut),
    });
  } catch (e: unknown) {
    return error(`Failed to get buy quote: ${getErrorMessage(e)}`);
  }
}

// ── get_sell_quote ──
export const getSellQuoteSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
  tokenAmount: bnStringSchema.describe("Token amount in raw units"),
});

export async function getSellQuote(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getSellQuoteSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const tokenAmount = new BN(params.tokenAmount);
    const global = await sdk.fetchGlobal();
    const feeConfig = await sdk.fetchFeeConfig();
    const bondingCurve = await sdk.fetchBondingCurve(mint);

    const solOut = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.virtualTokenReserves,
      bondingCurve,
      amount: tokenAmount,
    });

    return success({
      inputAmount: formatBN(tokenAmount),
      inputUnit: "raw tokens",
      inputTokens: rawToTokens(tokenAmount),
      outputAmount: formatBN(solOut),
      outputUnit: "lamports",
      outputSol: lamportsToSol(solOut),
    });
  } catch (e: unknown) {
    return error(`Failed to get sell quote: ${getErrorMessage(e)}`);
  }
}

// ── get_price_impact ──
export const getPriceImpactSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
  amount: bnStringSchema.describe("Amount in lamports (buy) or raw tokens (sell)"),
  side: z.enum(["buy", "sell"]).describe("Trade side"),
});

export async function getPriceImpact(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getPriceImpactSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const amount = new BN(params.amount);
    const result =
      params.side === "buy"
        ? await sdk.fetchBuyPriceImpact(mint, amount)
        : await sdk.fetchSellPriceImpact(mint, amount);

    return success({
      side: params.side,
      impactPercentage: result.impactPercentage.toString(),
      priceBeforeTrade: result.preBuyPrice.toString(),
      priceAfterTrade: result.postBuyPrice.toString(),
    });
  } catch (e: unknown) {
    return error(`Failed to calculate price impact: ${getErrorMessage(e)}`);
  }
}

// ── get_market_cap ──
export const getMarketCapSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getMarketCap(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getMarketCapSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const bondingCurve = await sdk.fetchBondingCurve(mint);
    const mcap = bondingCurveMarketCap({
      mintSupply: bondingCurve.virtualTokenReserves,
      virtualSolReserves: bondingCurve.virtualSolReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
    });

    return success({
      marketCapLamports: formatBN(mcap),
      marketCapSol: lamportsToSol(mcap),
    });
  } catch (e: unknown) {
    return error(`Failed to get market cap: ${getErrorMessage(e)}`);
  }
}

// ── get_token_price ──
export const getTokenPriceSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getTokenPriceTool(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getTokenPriceSchema>
): Promise<ToolResult> {
  try {
    const result = await sdk.fetchTokenPrice(params.mint);
    return success({
      buyPricePerToken: result.buyPricePerToken.toString(),
      sellPricePerToken: result.sellPricePerToken.toString(),
      spread: result.spread.toString(),
    });
  } catch (e: unknown) {
    return error(`Failed to get token price: ${getErrorMessage(e)}`);
  }
}

// ── get_bonding_curve_summary ──
export const getBondingCurveSummarySchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getBondingCurveSummaryTool(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getBondingCurveSummarySchema>
): Promise<ToolResult> {
  try {
    const summary = await sdk.fetchBondingCurveSummary(params.mint);
    return success({
      virtualSolReserves: formatBN(summary.virtualSolReserves),
      virtualTokenReserves: formatBN(summary.virtualTokenReserves),
      realSolReserves: formatBN(summary.realSolReserves),
      realTokenReserves: formatBN(summary.realTokenReserves),
      tokenTotalSupply: formatBN(summary.tokenTotalSupply),
      complete: summary.complete,
      marketCapLamports: formatBN(summary.marketCapLamports),
      marketCapSol: lamportsToSol(summary.marketCapLamports),
      buyPricePerToken: summary.buyPricePerToken.toString(),
      sellPricePerToken: summary.sellPricePerToken.toString(),
      graduationProgress: summary.graduationProgress.toString(),
    });
  } catch (e: unknown) {
    return error(`Failed to get bonding curve summary: ${getErrorMessage(e)}`);
  }
}

// ── get_graduation_progress ──
export const getGraduationProgressSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getGraduationProgressTool(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getGraduationProgressSchema>
): Promise<ToolResult> {
  try {
    const result = await sdk.fetchGraduationProgress(params.mint);
    return success({
      progressPercentage: result.progressPercentage.toString(),
      currentRealSolReserves: formatBN(result.currentRealSolReserves),
      targetRealSolReserves: formatBN(result.targetRealSolReserves),
      isComplete: result.isComplete,
    });
  } catch (e: unknown) {
    return error(`Failed to get graduation progress: ${getErrorMessage(e)}`);
  }
}

// ── get_amm_quote ──
export const getAmmQuoteSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (must be graduated)"),
  amount: bnStringSchema.describe("Input amount"),
  side: z.enum(["buy", "sell"]).describe("Trade side"),
});

export async function getAmmQuote(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getAmmQuoteSchema>
): Promise<ToolResult> {
  try {
    const pool = await sdk.fetchPool(params.mint);
    return success({
      pool: pool.baseMint.toBase58(),
      baseReserve: formatBN(pool.baseReserve),
      quoteReserve: formatBN(pool.quoteReserve),
      side: params.side,
      note: "Use build_amm_swap for executable instructions",
    });
  } catch (e: unknown) {
    return error(`Failed to get AMM quote: ${getErrorMessage(e)}`);
  }
}
