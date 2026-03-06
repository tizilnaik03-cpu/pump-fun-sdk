import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { bondingCurveMarketCap } from "@pump-fun/pump-sdk";
import type { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { publicKeySchema } from "../utils/validation.js";
import { lamportsToSol, formatBN } from "../utils/formatting.js";
import { success, error } from "../types.js";
import type { ToolResult } from "../types.js";

// ── search_tokens ──
export const searchTokensSchema = z.object({
  query: z.string().min(1).max(100).describe("Search query (token name or symbol)"),
});

export async function searchTokens(
  _sdk: OnlinePumpSdk,
  params: z.infer<typeof searchTokensSchema>
): Promise<ToolResult> {
  try {
    return success({
      query: params.query,
      note: "Token search requires an indexer or the PumpFun API. Use the PumpFun website or a third-party API like Birdeye/DexScreener to search by name/symbol. Once you have the mint address, use get_token_info.",
    });
  } catch (e: any) {
    return error(`Token search failed: ${e.message}`);
  }
}

// ── get_token_metadata_uri ──
export const getTokenMetadataUriSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getTokenMetadataUri(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getTokenMetadataUriSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const bondingCurve = await sdk.fetchBondingCurve(mint);

    return success({
      mint: params.mint,
      creator: bondingCurve.creator.toBase58(),
      note: "The metadata URI is stored in the Metaplex metadata account. Use @metaplex-foundation/mpl-token-metadata to fetch the full metadata JSON including name, symbol, image, and description.",
    });
  } catch (e: any) {
    return error(`Failed to get token metadata URI: ${e.message}`);
  }
}

// ── get_token_socials ──
export const getTokenSocialsSchema = z.object({
  mint: publicKeySchema.describe("Token mint address"),
});

export async function getTokenSocials(
  sdk: OnlinePumpSdk,
  params: z.infer<typeof getTokenSocialsSchema>
): Promise<ToolResult> {
  try {
    const mint = new PublicKey(params.mint);
    const bondingCurve = await sdk.fetchBondingCurve(mint);

    return success({
      mint: params.mint,
      creator: bondingCurve.creator.toBase58(),
      note: "Social links are stored in the off-chain metadata JSON. Fetch the metadata URI from the Metaplex account, then parse the JSON for twitter, telegram, website, and discord fields.",
    });
  } catch (e: any) {
    return error(`Failed to get token socials: ${e.message}`);
  }
}
