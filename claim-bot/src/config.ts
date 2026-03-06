/**
 * PumpFun Claim Bot — Configuration
 *
 * Loads and validates environment variables.
 */

import 'dotenv/config';

import type { BotConfig } from './types.js';

export function loadConfig(): BotConfig {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramToken) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is required. Create a bot via @BotFather and set the env var.',
        );
    }

    const solanaRpcUrl =
        process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    const extraUrls = process.env.SOLANA_RPC_URLS
        ? process.env.SOLANA_RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const solanaRpcUrls = [solanaRpcUrl, ...extraUrls.filter((u) => u !== solanaRpcUrl)];

    let solanaWsUrl = process.env.SOLANA_WS_URL;
    if (!solanaWsUrl) {
        try {
            const url = new URL(solanaRpcUrl);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            solanaWsUrl = url.toString();
        } catch {
            // leave undefined — monitor will use polling
        }
    }

    const pollIntervalSeconds = Number.parseInt(
        process.env.POLL_INTERVAL_SECONDS || '15',
        10,
    );

    const logLevel = (process.env.LOG_LEVEL || 'info') as BotConfig['logLevel'];

    return {
        logLevel,
        pollIntervalSeconds,
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        telegramToken,
    };
}
