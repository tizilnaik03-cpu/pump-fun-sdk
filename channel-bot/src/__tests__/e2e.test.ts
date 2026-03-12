/**
 * Channel Bot — End-to-End Test Suite
 *
 * Tests claim tracking, formatters, and the GitHub claim feed pipeline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Claim Tracker Tests ────────────────────────────────────────────────────

describe('Claim Tracker', () => {
  let tracker: typeof import('../claim-tracker.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
      writeFileSync: vi.fn(),
    }));
    vi.mock('../logger.js', () => ({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    tracker = await import('../claim-tracker.js');
    tracker.loadPersistedClaims();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects first claim for a GitHub user', () => {
    const result = tracker.recordGitHubClaim(
      'user123',
      'MintABC123456789012345678901234567890abc',
      1.5,
      0,
      200,
      0.000001,
      50_000,
      25,
    );

    expect(result.isFirstClaim).toBe(true);
    expect(result.claimNumber).toBe(1);
  });

  it('detects repeat claim for same GitHub user', () => {
    const mint = 'MintABC123456789012345678901234567890abc';
    tracker.recordGitHubClaim('user456', mint, 1.0, 0, 150, 0.00001, 30_000, 20);
    const result = tracker.recordGitHubClaim('user456', mint, 2.0, 0, 200, 0.00002, 60_000, 30);

    expect(result.isFirstClaim).toBe(false);
    expect(result.claimNumber).toBe(2);
  });

  it('tracks different GitHub users independently', () => {
    const mint = 'MintXYZ123456789012345678901234567890xyz';
    const r1 = tracker.recordGitHubClaim('user_a', mint, 1.0, 0, 100, 0.00001, 20_000, 10);
    const r2 = tracker.recordGitHubClaim('user_b', mint, 1.0, 0, 100, 0.00001, 20_000, 10);

    expect(r1.isFirstClaim).toBe(true);
    expect(r2.isFirstClaim).toBe(true);
  });
});

// ── Type Constants Tests ───────────────────────────────────────────────────

describe('Type Constants', () => {
  let types: typeof import('../types.js');

  beforeEach(async () => {
    types = await import('../types.js');
  });

  it('has correct program IDs', () => {
    expect(types.PUMP_PROGRAM_ID).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    expect(types.PUMP_AMM_PROGRAM_ID).toBe('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
  });

  it('has claim instructions for both programs', () => {
    expect(types.CLAIM_INSTRUCTIONS.length).toBeGreaterThanOrEqual(6);
    const programs = new Set(types.CLAIM_INSTRUCTIONS.map((i) => i.programId));
    expect(programs.size).toBeGreaterThanOrEqual(2);
  });

  it('all discriminators are valid 16-char hex strings', () => {
    for (const instr of types.CLAIM_INSTRUCTIONS) {
      expect(instr.discriminator).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

// ── Formatter Tests ────────────────────────────────────────────────────────

describe('Formatters', () => {
  let formatters: typeof import('../formatters.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../x-client.js', () => ({
      getInfluencerTier: vi.fn(() => null),
      formatFollowerCount: vi.fn((n: number) => `${n}`),
      influencerLabel: vi.fn(() => ''),
    }));
    formatters = await import('../formatters.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats GitHub claim feed with all fields', () => {
    const ctx: import('../formatters.js').ClaimFeedContext = {
      event: {
        txSignature: 'sig_abc123',
        slot: 300_000_000,
        timestamp: 1700000000,
        claimerWallet: 'ClaimerWallet123456789012345678901234ab',
        tokenMint: 'MintABC123456789012345678901234567890abc',
        amountSol: 1.5,
        amountLamports: 1_500_000_000,
        claimType: 'claim_social_fee_pda',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Claim Social Fee PDA',
        githubUserId: '12345',
      },
      solUsdPrice: 180,
      githubUser: {
        id: 12345,
        login: 'testdev',
        name: 'Test Developer',
        avatarUrl: 'https://avatars.example.com/12345',
        bio: 'Building cool stuff',
        followers: 150,
        publicRepos: 30,
        createdAt: '2020-01-01T00:00:00Z',
        twitterUsername: 'testdev_x',
        blog: 'https://testdev.example.com',
        company: 'TestCorp',
        location: 'San Francisco',
        hireable: true,
      },
      xProfile: null,
      tokenInfo: {
        name: 'TestCoin',
        symbol: 'TST',
        mint: 'MintABC123456789012345678901234567890abc',
        priceSol: 0.001,
        usdMarketCap: 50_000,
        description: 'A test token',
        imageUri: 'https://img.example.com/token.png',
        creator: 'CreatorAddr',
        complete: false,
        curveProgress: 25,
        createdTimestamp: 1699000000,
        lastTradeTimestamp: 1700000000,
        replyCount: 42,
        marketCapSol: 277,
        athMarketCap: 100_000,
        kothTimestamp: 0,
        pumpSwapPool: null,
        website: null,
        twitter: 'https://x.com/testcoin',
        telegram: null,
      },
      isFirstClaim: true,
      isFake: false,
      claimNumber: 1,
    };

    const result = formatters.formatGitHubClaimFeed(ctx);
    expect(result.caption).toContain('FIRST CREATOR FEE CLAIM');
    expect(result.caption).toContain('MintABC123456789012345678901234567890abc');
    expect(result.caption).toContain('TestCoin');
    expect(result.caption).toContain('TST');
    expect(result.caption).toContain('Bonding curve');
  });

  it('formats fake claim with warning banner', () => {
    const ctx: import('../formatters.js').ClaimFeedContext = {
      event: {
        txSignature: 'sig_fake',
        slot: 300_000_000,
        timestamp: 1700000000,
        claimerWallet: 'FakeWallet',
        tokenMint: 'FakeMint',
        amountSol: 0,
        amountLamports: 0,
        claimType: 'claim_social_fee_pda',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Claim Social Fee PDA',
      },
      solUsdPrice: 180,
      githubUser: null,
      xProfile: null,
      isFake: true,
    };

    const result = formatters.formatGitHubClaimFeed(ctx);
    expect(result.caption).toContain('FAKE CLAIM');
  });

  it('formats repeat claim with claim number', () => {
    const ctx: import('../formatters.js').ClaimFeedContext = {
      event: {
        txSignature: 'sig_repeat',
        slot: 300_000_000,
        timestamp: 1700000000,
        claimerWallet: 'RepeatWallet',
        tokenMint: 'RepeatMint',
        amountSol: 0.5,
        amountLamports: 500_000_000,
        claimType: 'claim_social_fee_pda',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Claim Social Fee PDA',
      },
      solUsdPrice: 180,
      githubUser: null,
      xProfile: null,
      isFirstClaim: false,
      claimNumber: 3,
    };

    const result = formatters.formatGitHubClaimFeed(ctx);
    expect(result.caption).toContain('REPEAT CLAIM #3');
  });
});

// ── RPC Fallback Tests ─────────────────────────────────────────────────────

describe('RPC Fallback', () => {
  let rpcFallback: typeof import('../rpc-fallback.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../logger.js', () => ({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    rpcFallback = await import('../rpc-fallback.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a fallback connection from multiple URLs', () => {
    const urls = [
      'https://rpc1.example.com',
      'https://rpc2.example.com',
      'https://rpc3.example.com',
    ];

    const conn = rpcFallback.createFallbackConnection(urls);
    expect(conn).toBeDefined();
  });
});

// ── Config Tests ───────────────────────────────────────────────────────────

describe('Config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads config with required fields', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token-123');
    vi.stubEnv('CHANNEL_ID', '-100123456789');
    vi.stubEnv('SOLANA_RPC_URL', 'https://test-rpc.example.com');

    const { loadConfig } = await import('../config.js');
    const config = loadConfig();

    expect(config.telegramBotToken).toBe('test-token-123');
    expect(config.solanaRpcUrl).toBe('https://test-rpc.example.com');

    vi.unstubAllEnvs();
  });
});

// ── Social Fee Index Tests ─────────────────────────────────────────────────

describe('Social Fee Index', () => {
  let index: typeof import('../social-fee-index.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../logger.js', () => ({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    index = await import('../social-fee-index.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports expected functions', () => {
    expect(typeof index.resolveMintFromPda).toBe('function');
  });
});
