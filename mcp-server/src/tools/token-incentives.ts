import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import type { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { publicKeySchema } from "../utils/validation.js";
import { formatBN, rawToTokens, instructionsToJson } from "../utils/formatting.js";
import { success, error } from "../types.js";
import type { ToolResult } from "../types.js";

// ── get_unclaimed_tokens ──
export const getUnclaimedTokensSchema = z.object({
  user: publicKeySchema.describe("User wallet address"),
});

export async function getUnclaimedTokens(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getUnclaimedTokensSchema>
): Promise<ToolResult> {
  try {
    const user = new PublicKey(params.user);
    const unclaimed = await sdk.getTotalUnclaimedTokensBothPrograms(user);

    return success({
      user: params.user,
      unclaimedRaw: formatBN(unclaimed),
      unclaimedTokens: rawToTokens(unclaimed),
    });
  } catch (e: any) {
    return error(`Failed to get unclaimed tokens: ${e.message}`);
  }
}

// ── get_current_day_tokens ──
export const getCurrentDayTokensSchema = z.object({
  user: publicKeySchema.describe("User wallet address"),
});

export async function getCurrentDayTokens(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getCurrentDayTokensSchema>
): Promise<ToolResult> {
  try {
    const user = new PublicKey(params.user);
    const tokens = await sdk.getCurrentDayTokensBothPrograms(user);

    return success({
      user: params.user,
      currentDayRaw: formatBN(tokens),
      currentDayTokens: rawToTokens(tokens),
    });
  } catch (e: any) {
    return error(`Failed to get current day tokens: ${e.message}`);
  }
}

// ── get_volume_stats ──
export const getVolumeStatsSchema = z.object({
  user: publicKeySchema.describe("User wallet address"),
});

export async function getVolumeStats(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getVolumeStatsSchema>
): Promise<ToolResult> {
  try {
    const user = new PublicKey(params.user);
    const stats = await sdk.fetchUserVolumeAccumulatorTotalStats(user);

    return success({
      user: params.user,
      totalVolume: formatBN(stats.totalVolume),
      totalClaimed: formatBN(stats.totalClaimed),
      totalUnclaimed: formatBN(stats.totalUnclaimed),
    });
  } catch (e: any) {
    return error(`Failed to get volume stats: ${e.message}`);
  }
}

// ── build_claim_incentives ──
export const buildClaimIncentivesSchema = z.object({
  user: publicKeySchema.describe("User wallet address"),
  payer: publicKeySchema.describe("Transaction fee payer address"),
});

export async function buildClaimIncentives(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof buildClaimIncentivesSchema>
): Promise<ToolResult> {
  try {
    const user = new PublicKey(params.user);
    const payer = new PublicKey(params.payer);
    const instructions = await sdk.claimTokenIncentivesBothPrograms(user, payer);

    return success({
      instructions: instructionsToJson(instructions),
      note: "Claims token incentives from both Pump and PumpAMM programs.",
    });
  } catch (e: any) {
    return error(`Failed to build claim incentives: ${e.message}`);
  }
}

// ── build_claim_cashback ──
export const buildClaimCashbackSchema = z.object({
  user: publicKeySchema.describe("User wallet address"),
});

export async function buildClaimCashback(
  _sdk: OnlinePumpSdk,
  params: z.infer<typeof buildClaimCashbackSchema>
): Promise<ToolResult> {
  try {
    const user = new PublicKey(params.user);
    const instruction = PUMP_SDK.claimCashbackInstruction({ user });

    return success({
      instructions: instructionsToJson([instruction]),
      note: "Claims accumulated cashback rewards.",
    });
  } catch (e: any) {
    return error(`Failed to build claim cashback: ${e.message}`);
  }
}
