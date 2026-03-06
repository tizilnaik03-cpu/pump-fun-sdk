import { PublicKey } from "@solana/web3.js";

import {
  bondingCurvePda,
  creatorVaultPda,
  pumpPoolAuthorityPda,
  canonicalPumpPoolPda,
  userVolumeAccumulatorPda,
  getEventAuthorityPda,
  feeSharingConfigPda,
  ammCreatorVaultPda,
  GLOBAL_PDA,
  AMM_GLOBAL_PDA,
  PUMP_FEE_CONFIG_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
} from "../pda";

import { TEST_PUBKEY, TEST_CREATOR } from "./fixtures";

describe("pda", () => {
  // ── Static PDAs ────────────────────────────────────────────────────

  describe("static PDAs", () => {
    it("GLOBAL_PDA is a valid PublicKey", () => {
      expect(GLOBAL_PDA).toBeInstanceOf(PublicKey);
    });

    it("AMM_GLOBAL_PDA is a valid PublicKey", () => {
      expect(AMM_GLOBAL_PDA).toBeInstanceOf(PublicKey);
    });

    it("PUMP_FEE_CONFIG_PDA is a valid PublicKey", () => {
      expect(PUMP_FEE_CONFIG_PDA).toBeInstanceOf(PublicKey);
    });

    it("GLOBAL_VOLUME_ACCUMULATOR_PDA is a valid PublicKey", () => {
      expect(GLOBAL_VOLUME_ACCUMULATOR_PDA).toBeInstanceOf(PublicKey);
    });

    it("AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA is a valid PublicKey", () => {
      expect(AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA).toBeInstanceOf(PublicKey);
    });
  });

  // ── Derived PDAs ───────────────────────────────────────────────────

  describe("derived PDAs", () => {
    const mint = new PublicKey("So11111111111111111111111111111111");

    it("bondingCurvePda is deterministic", () => {
      const a = bondingCurvePda(mint);
      const b = bondingCurvePda(mint);
      expect(a.equals(b)).toBe(true);
    });

    it("bondingCurvePda differs for different mints", () => {
      const a = bondingCurvePda(mint);
      const b = bondingCurvePda(TEST_PUBKEY);
      expect(a.equals(b)).toBe(false);
    });

    it("creatorVaultPda is deterministic", () => {
      const a = creatorVaultPda(TEST_CREATOR);
      const b = creatorVaultPda(TEST_CREATOR);
      expect(a.equals(b)).toBe(true);
    });

    it("pumpPoolAuthorityPda returns a valid PublicKey", () => {
      const result = pumpPoolAuthorityPda(mint);
      expect(result).toBeInstanceOf(PublicKey);
    });

    it("canonicalPumpPoolPda returns a valid PublicKey", () => {
      const result = canonicalPumpPoolPda(mint);
      expect(result).toBeInstanceOf(PublicKey);
    });

    it("userVolumeAccumulatorPda is deterministic", () => {
      const a = userVolumeAccumulatorPda(TEST_CREATOR);
      const b = userVolumeAccumulatorPda(TEST_CREATOR);
      expect(a.equals(b)).toBe(true);
    });

    it("getEventAuthorityPda returns consistent results", () => {
      const programId = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
      const a = getEventAuthorityPda(programId);
      const b = getEventAuthorityPda(programId);
      expect(a.equals(b)).toBe(true);
    });

    it("feeSharingConfigPda is deterministic", () => {
      const a = feeSharingConfigPda(mint);
      const b = feeSharingConfigPda(mint);
      expect(a.equals(b)).toBe(true);
    });

    it("ammCreatorVaultPda is deterministic", () => {
      const a = ammCreatorVaultPda(TEST_CREATOR);
      const b = ammCreatorVaultPda(TEST_CREATOR);
      expect(a.equals(b)).toBe(true);
    });
  });
});
