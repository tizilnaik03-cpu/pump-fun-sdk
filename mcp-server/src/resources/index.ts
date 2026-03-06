import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from "@pump-fun/pump-sdk";

export const RESOURCES = [
  {
    uri: "solana://programs",
    name: "Pump Protocol Programs",
    description: "On-chain program IDs for Pump, PumpAMM, and PumpFees",
    mimeType: "application/json",
  },
  {
    uri: "solana://config",
    name: "SDK Configuration",
    description: "Current SDK version and configuration",
    mimeType: "application/json",
  },
];

export function readResource(uri: string): { contents: { uri: string; mimeType: string; text: string }[] } {
  switch (uri) {
    case "solana://programs":
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                pump: PUMP_PROGRAM_ID,
                pumpAmm: PUMP_AMM_PROGRAM_ID,
                pumpFees: PUMP_FEE_PROGRAM_ID,
              },
              null,
              2
            ),
          },
        ],
      };

    case "solana://config":
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                sdkVersion: "1.30.0",
                maxShareholders: 10,
                totalBps: 10000,
                tokenDecimals: 6,
                programs: {
                  pump: PUMP_PROGRAM_ID,
                  pumpAmm: PUMP_AMM_PROGRAM_ID,
                  pumpFees: PUMP_FEE_PROGRAM_ID,
                },
              },
              null,
              2
            ),
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}
