import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import type { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { publicKeySchema, bnStringSchema } from "../utils/validation.js";
import { lamportsToSol, rawToTokens, formatBN, instructionsToJson } from "../utils/formatting.js";
import { success, error, getErrorMessage } from "../types.js";
import type { ToolResult } from "../types.js";

// ── get_amm_pool ──
export const getAmmPoolSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (graduated)"),
});

export async function getAmmPool(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getAmmPoolSchema>
): Promise<ToolResult> {
  try {
    const pool = await sdk.fetchPool(params.mint);
    return success({
      poolAddress: pool.address.toBase58(),
      baseMint: pool.baseMint.toBase58(),
      quoteMint: pool.quoteMint.toBase58(),
      baseReserve: formatBN(pool.baseReserve),
      quoteReserve: formatBN(pool.quoteReserve),
      lpSupply: formatBN(pool.lpSupply),
    });
  } catch (e: unknown) {
    return error(`Failed to get AMM pool: ${getErrorMessage(e)}`);
  }
}

// ── get_amm_reserves ──
export const getAmmReservesSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (graduated)"),
});

export async function getAmmReserves(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getAmmReservesSchema>
): Promise<ToolResult> {
  try {
    const pool = await sdk.fetchPool(params.mint);
    return success({
      baseReserve: formatBN(pool.baseReserve),
      baseReserveTokens: rawToTokens(pool.baseReserve),
      quoteReserve: formatBN(pool.quoteReserve),
      quoteReserveSol: lamportsToSol(pool.quoteReserve),
    });
  } catch (e: unknown) {
    return error(`Failed to get AMM reserves: ${getErrorMessage(e)}`);
  }
}

// ── get_amm_price ──
export const getAmmPriceSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (graduated)"),
});

export async function getAmmPrice(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getAmmPriceSchema>
): Promise<ToolResult> {
  try {
    const pool = await sdk.fetchPool(params.mint);
    // price = quoteReserve / baseReserve (SOL per token)
    const priceLamportsPerRaw = pool.quoteReserve
      .mul(new BN(1_000_000))
      .div(pool.baseReserve);

    return success({
      pricePerToken: lamportsToSol(priceLamportsPerRaw),
      baseReserve: formatBN(pool.baseReserve),
      quoteReserve: formatBN(pool.quoteReserve),
      note: "Price derived from constant product formula (quoteReserve/baseReserve).",
    });
  } catch (e: unknown) {
    return error(`Failed to get AMM price: ${getErrorMessage(e)}`);
  }
}

// ── build_amm_deposit ──
export const buildAmmDepositSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (graduated)"),
  user: publicKeySchema.describe("Depositor wallet address"),
  maxBaseAmountIn: bnStringSchema.describe("Max token amount to deposit"),
  maxQuoteAmountIn: bnStringSchema.describe("Max SOL amount in lamports"),
  minLpTokenAmountOut: bnStringSchema.describe("Min LP tokens to receive"),
});

export async function buildAmmDeposit(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof buildAmmDepositSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const user = new PublicKey(params.user);
    const pool = await sdk.fetchPool(mint);

    const instruction = PUMP_SDK.ammDepositInstruction({
      user,
      pool: pool.address,
      mint,
      maxBaseAmountIn: new BN(params.maxBaseAmountIn),
      maxQuoteAmountIn: new BN(params.maxQuoteAmountIn),
      minLpTokenAmountOut: new BN(params.minLpTokenAmountOut),
    });

    return success({
      instructions: instructionsToJson([instruction]),
      pool: pool.address.toBase58(),
    });
  } catch (e: unknown) {
    return error(`Failed to build AMM deposit: ${getErrorMessage(e)}`);
  }
}

// ── build_amm_withdraw ──
export const buildAmmWithdrawSchema = z.object({
  mint: publicKeySchema.describe("Token mint address (graduated)"),
  user: publicKeySchema.describe("Withdrawer wallet address"),
  lpTokenAmountIn: bnStringSchema.describe("LP tokens to burn"),
  minBaseAmountOut: bnStringSchema.describe("Min tokens to receive"),
  minQuoteAmountOut: bnStringSchema.describe("Min SOL to receive (lamports)"),
});

export async function buildAmmWithdraw(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof buildAmmWithdrawSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const user = new PublicKey(params.user);
    const pool = await sdk.fetchPool(mint);

    const instruction = PUMP_SDK.ammWithdrawInstruction({
      user,
      pool: pool.address,
      mint,
      lpTokenAmountIn: new BN(params.lpTokenAmountIn),
      minBaseAmountOut: new BN(params.minBaseAmountOut),
      minQuoteAmountOut: new BN(params.minQuoteAmountOut),
    });

    return success({
      instructions: instructionsToJson([instruction]),
      pool: pool.address.toBase58(),
    });
  } catch (e: unknown) {
    return error(`Failed to build AMM withdraw: ${getErrorMessage(e)}`);
  }
}
