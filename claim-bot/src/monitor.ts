/**
 * PumpFun Claim Bot — Solana Fee Claim Monitor
 *
 * Monitors Pump and PumpSwap programs for fee claim transactions.
 * Supports WebSocket (real-time) with HTTP polling fallback.
 */

import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    type Logs,
    type SignaturesForAddressOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { BotConfig, FeeClaimEvent, ClaimType } from './types.js';
import {
    CLAIM_INSTRUCTIONS,
    CLAIM_EVENT_DISCRIMINATORS,
    MONITORED_PROGRAM_IDS,
    PUMPFUN_FEE_ACCOUNT,
} from './types.js';
import { log } from './logger.js';

// ============================================================================
// Rate limiter
// ============================================================================

const MAX_CONCURRENCY = 1;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const MAX_QUEUE_SIZE = 50;

class RpcQueue {
    private queue: string[] = [];
    private inFlight = 0;
    private processing = false;
    private lastRequestTime = 0;
    private processFn: (sig: string) => Promise<void>;

    constructor(processFn: (sig: string) => Promise<void>) {
        this.processFn = processFn;
    }

    enqueue(signature: string): boolean {
        if (this.queue.length >= MAX_QUEUE_SIZE) return false;
        this.queue.push(signature);
        this.drain();
        return true;
    }

    private async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0 && this.inFlight < MAX_CONCURRENCY) {
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < MIN_REQUEST_INTERVAL_MS) {
                await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
            }
            const sig = this.queue.shift();
            if (!sig) break;
            this.lastRequestTime = Date.now();
            this.inFlight++;
            this.processFn(sig)
                .catch((err) => log.debug('Queue item failed: %s', err))
                .finally(() => { this.inFlight--; this.drain(); });
        }
        this.processing = false;
    }
}

// ============================================================================
// Monitor
// ============================================================================

export class ClaimMonitor {
    private connection: Connection;
    private wsConnection?: Connection;
    private config: BotConfig;
    private onClaim: (event: FeeClaimEvent) => void;
    private pollTimer?: ReturnType<typeof setInterval>;
    private wsSubscriptionIds: number[] = [];
    private lastSignatures = new Map<string, string | undefined>();
    private programPubkeys: PublicKey[];
    private processedSignatures = new Set<string>();
    private readonly MAX_PROCESSED_CACHE = 10_000;
    private rpcQueue: RpcQueue;
    private isRunning = false;
    private startedAt = 0;
    public claimsDetected = 0;
    private useWs = false;

    constructor(config: BotConfig, onClaim: (event: FeeClaimEvent) => void) {
        this.config = config;
        this.onClaim = onClaim;
        this.connection = new Connection(config.solanaRpcUrl, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
        });
        this.programPubkeys = MONITORED_PROGRAM_IDS.map((id) => new PublicKey(id));
        this.rpcQueue = new RpcQueue((sig) => this.processTransaction(sig));
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startedAt = Date.now();

        log.info('Claim monitor: monitoring %d programs', MONITORED_PROGRAM_IDS.length);

        if (this.config.solanaWsUrl && process.env.SOLANA_WS_URL) {
            try {
                await this.startWebSocket();
                this.useWs = true;
                log.info('Claim monitor: WebSocket mode');
                return;
            } catch (err) {
                log.warn('WS failed, falling back to polling: %s', err);
            }
        }

        this.startPolling();
        log.info('Claim monitor: polling mode (every %ds)', this.config.pollIntervalSeconds);
    }

    stop(): void {
        this.isRunning = false;
        if (this.wsConnection) {
            for (const id of this.wsSubscriptionIds) {
                this.wsConnection.removeOnLogsListener(id).catch(() => {});
            }
            this.wsSubscriptionIds = [];
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        log.info('Claim monitor stopped');
    }

    getMode(): string {
        return this.useWs ? 'websocket' : 'polling';
    }

    getUptimeMs(): number {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    // ── WebSocket ────────────────────────────────────────────────────

    private async startWebSocket(): Promise<void> {
        const wsUrl = this.config.solanaWsUrl!;
        this.wsConnection = new Connection(this.config.solanaRpcUrl, {
            commitment: 'confirmed',
            wsEndpoint: wsUrl,
        });

        for (const programId of this.programPubkeys) {
            const subId = this.wsConnection.onLogs(
                programId,
                (logInfo: Logs) => {
                    if (logInfo.err) return;
                    const sig = logInfo.signature;
                    if (this.processedSignatures.has(sig)) return;

                    // Check if any claim instruction present
                    const logsStr = logInfo.logs.join(' ');
                    const hasClaimLog = CLAIM_INSTRUCTIONS.some(
                        (def) => logsStr.includes(def.discriminator) || logsStr.includes(def.label),
                    );

                    // Check event discriminators too
                    const hasClaimEvent = Object.keys(CLAIM_EVENT_DISCRIMINATORS).some(
                        (disc) => logsStr.includes(disc),
                    );

                    if (hasClaimLog || hasClaimEvent) {
                        this.rpcQueue.enqueue(sig);
                    }
                },
                'confirmed',
            );
            this.wsSubscriptionIds.push(subId);
        }
    }

    // ── Polling ──────────────────────────────────────────────────────

    private startPolling(): void {
        // Initial poll
        setTimeout(() => this.pollAll(), 1000);
        this.pollTimer = setInterval(
            () => this.pollAll(),
            this.config.pollIntervalSeconds * 1000,
        );
    }

    private async pollAll(): Promise<void> {
        for (const programId of this.programPubkeys) {
            try {
                await this.pollProgram(programId);
            } catch (err) {
                log.debug('Poll error for %s: %s', programId.toBase58().slice(0, 8), err);
            }
            // Small delay between programs to avoid rate limits
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    private async pollProgram(programId: PublicKey): Promise<void> {
        const key = programId.toBase58();
        const opts: SignaturesForAddressOptions = { limit: 20 };

        const lastSig = this.lastSignatures.get(key);
        if (lastSig) {
            opts.until = lastSig;
        }

        const signatures = await this.connection.getSignaturesForAddress(programId, opts);
        if (signatures.length === 0) return;

        // Update last seen
        const newest = signatures[0];
        if (newest) {
            this.lastSignatures.set(key, newest.signature);
        }

        for (const sigInfo of signatures) {
            if (sigInfo.err) continue;
            if (this.processedSignatures.has(sigInfo.signature)) continue;
            this.rpcQueue.enqueue(sigInfo.signature);
        }
    }

    // ── Transaction processing ───────────────────────────────────────

    private async processTransaction(signature: string): Promise<void> {
        if (this.processedSignatures.has(signature)) return;
        this.processedSignatures.add(signature);

        // Evict old entries
        if (this.processedSignatures.size > this.MAX_PROCESSED_CACHE) {
            const arr = [...this.processedSignatures];
            this.processedSignatures = new Set(arr.slice(-5000));
        }

        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (!tx || !tx.meta || tx.meta.err) return;

            const message = tx.transaction.message;
            const accountKeys = message.getAccountKeys({
                accountKeysFromLookups: tx.meta.loadedAddresses,
            });

            // Find claim instructions
            const compiledInstructions = message.compiledInstructions;
            for (const ix of compiledInstructions) {
                const programKey = accountKeys.get(ix.programIdIndex);
                if (!programKey) continue;
                const programIdStr = programKey.toBase58();

                // Check if this is a monitored program
                if (!MONITORED_PROGRAM_IDS.includes(programIdStr as typeof MONITORED_PROGRAM_IDS[number])) {
                    continue;
                }

                // Check instruction discriminator
                const dataHex = Buffer.from(ix.data).toString('hex');
                const disc8 = dataHex.slice(0, 16);

                const matchedInstruction = CLAIM_INSTRUCTIONS.find(
                    (def) => def.discriminator === disc8 && def.programId === programIdStr,
                );

                if (!matchedInstruction) continue;

                // Extract claim details
                const event = this.extractClaimEvent(
                    signature,
                    tx,
                    matchedInstruction,
                    accountKeys,
                );

                if (event) {
                    this.claimsDetected++;
                    log.info('Fee claim: %s %.4f SOL (%s)',
                        event.claimType, event.amountSol, event.tokenMint.slice(0, 8));
                    this.onClaim(event);
                }
            }
        } catch (err) {
            log.debug('Failed to process tx %s: %s', signature.slice(0, 12), err);
        }
    }

    private extractClaimEvent(
        signature: string,
        tx: Exclude<Awaited<ReturnType<Connection['getTransaction']>>, null>,
        def: typeof CLAIM_INSTRUCTIONS[number],
        accountKeys: ReturnType<typeof tx.transaction.message.getAccountKeys>,
    ): FeeClaimEvent | null {
        const meta = tx.meta!;
        const blockTime = tx.blockTime ?? Math.floor(Date.now() / 1000);

        // Calculate SOL transferred by looking at balance changes
        const preBalances = meta.preBalances;
        const postBalances = meta.postBalances;

        // The signer (index 0) is typically the claimer
        const signerKey = accountKeys.get(0);
        if (!signerKey) return null;
        const claimerWallet = signerKey.toBase58();

        // Find the fee account's balance change to determine amount
        let amountLamports = 0;
        const feeAccountIndex = this.findAccountIndex(accountKeys, PUMPFUN_FEE_ACCOUNT);

        if (feeAccountIndex >= 0 && preBalances[feeAccountIndex] !== undefined && postBalances[feeAccountIndex] !== undefined) {
            // Fee account's balance decreased = fees were claimed from it
            amountLamports = (preBalances[feeAccountIndex] ?? 0) - (postBalances[feeAccountIndex] ?? 0);
        }

        // If we couldn't find amount from fee account, use signer's balance increase
        if (amountLamports <= 0 && preBalances[0] !== undefined && postBalances[0] !== undefined) {
            amountLamports = (postBalances[0] ?? 0) - (preBalances[0] ?? 0);
            // Add back the tx fee the signer paid
            amountLamports += meta.fee;
        }

        if (amountLamports <= 0) amountLamports = 0;

        // Try to find the token mint from accounts
        let tokenMint = '';
        const numAccounts = accountKeys.length;
        for (let i = 0; i < numAccounts; i++) {
            const key = accountKeys.get(i);
            if (!key) continue;
            const addr = key.toBase58();
            // Skip known non-mint addresses
            if (addr === claimerWallet) continue;
            if (addr === PUMPFUN_FEE_ACCOUNT) continue;
            if (MONITORED_PROGRAM_IDS.includes(addr as typeof MONITORED_PROGRAM_IDS[number])) continue;
            if (addr === '11111111111111111111111111111111') continue;
            if (addr === 'SysvarRent111111111111111111111111111111111') continue;
            if (addr === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') continue;
            if (addr === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') continue;
            if (addr === 'So11111111111111111111111111111111111111112') continue;
            // Use the first non-system account as potential mint
            if (!tokenMint) tokenMint = addr;
        }

        return {
            txSignature: signature,
            slot: tx.slot,
            timestamp: blockTime,
            claimerWallet,
            tokenMint,
            amountSol: amountLamports / LAMPORTS_PER_SOL,
            amountLamports,
            claimType: def.claimType,
            isCashback: def.claimType === 'claim_cashback',
            programId: def.programId,
            claimLabel: def.label,
        };
    }

    private findAccountIndex(
        accountKeys: { get(index: number): PublicKey | undefined; length: number },
        target: string,
    ): number {
        for (let i = 0; i < accountKeys.length; i++) {
            const key = accountKeys.get(i);
            if (key && key.toBase58() === target) return i;
        }
        return -1;
    }
}
