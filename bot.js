const TelegramBot = require('node-telegram-bot-api');
const web3 = require('@solana/web3.js');

const BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
const HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

const MAX = 10;
const CACHE_TTL = 5 * 60 * 1000;
const QUEUE_MAX = 200;
const POLL_INTERVAL = 18000; // \~18 seconds

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const users = {};           // chatId -> [{mint, ticker}]
const watchingMints = {};   // mint -> {ticker, feeWallet?}
const tokenCache = {};
const lastSig = {};
const lastSigInit = {};
const claimsCount = {};
const messageQueue = [];
let isProcessing = false;
const messageTypes = {};

const globalConn = new web3.Connection(
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,
  'confirmed'
);

// Prevent crashes on Railway
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'track', description: 'Track a token - /track <CA>' },
  { command: 'list', description: 'See your tracked tokens' },
  { command: 'help', description: 'How to use this bot' }
]);

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  Object.keys(tokenCache).forEach(k => {
    if (now - tokenCache[k].timestamp > CACHE_TTL) delete tokenCache[k];
  });
  if (messageQueue.length > QUEUE_MAX) messageQueue.splice(0, messageQueue.length - QUEUE_MAX);
}, 300000);

// Main polling loop (mint + fee wallet)
setInterval(() => {
  const mints = Object.keys(watchingMints);
  if (mints.length === 0) return;

  mints.forEach(mint => {
    const info = watchingMints[mint];
    if (!info) return;

    pollAddress(mint, mint, info.ticker, true); // mint side
    if (info.feeWallet && info.feeWallet !== mint) {
      pollAddress(info.feeWallet, mint, info.ticker, false); // wallet side
    }
  });
}, POLL_INTERVAL);

async function pollAddress(addressStr, mint, ticker, isMint) {
  let pub;
  try {
    pub = new web3.PublicKey(addressStr);
  } catch (e) {
    console.error(`[Poll] Invalid address: ${addressStr}`);
    return;
  }

  const sigKey = addressStr;

  try {
    const sigs = await globalConn.getSignaturesForAddress(pub, { limit: 20 });

    if (!sigs || sigs.length === 0) return;

    if (!lastSigInit[sigKey]) {
      lastSigInit[sigKey] = true;
      lastSig[sigKey] = sigs[0].signature;
      console.log(`[Init] ${isMint ? 'Mint' : 'Fee Wallet'} ${addressStr.slice(0, 12)}...`);
      return;
    }

    const newSigs = [];
    for (let i = 0; i < sigs.length; i++) {
      if (sigs[i].signature === lastSig[sigKey]) break;
      if (!sigs[i].err) newSigs.push(sigs[i]);
    }

    if (newSigs.length === 0) return;

    lastSig[sigKey] = sigs[0].signature;

    for (const sigInfo of newSigs) {
      try {
        const tx = await globalConn.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });

        if (!tx?.meta) continue;

        const logs = tx.meta.logMessages || [];
        const accountKeys = tx.transaction?.message?.accountKeys || [];
        const programAddrs = accountKeys.map(a => a.pubkey?.toString() || '');

        const hasPumpProgram = programAddrs.includes(PUMP_PROGRAM) || programAddrs.includes(PUMP_FEE_PROGRAM);
        const hasClaimLog = logs.some(l =>
          l && (
            l.includes('CollectCreatorFee') ||
            l.includes('collectCreatorFee') ||
            l.includes('distributeCreatorFees') ||
            l.includes('distribute_creator_fees') ||
            l.includes('creator')
          )
        );

        let isClaim = false;

        if (isMint) {
          isClaim = hasClaimLog && hasPumpProgram;
        } else {
          // Fee wallet: check for incoming SOL
          const walletIdx = accountKeys.findIndex(acc => acc.pubkey?.toString() === addressStr);
          if (walletIdx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
            const solChange = (tx.meta.postBalances[walletIdx] - tx.meta.preBalances[walletIdx]) / 1e9;
            if (solChange > 0.005 && (hasPumpProgram || hasClaimLog)) {
              isClaim = true;
            }
          }
        }

        if (isClaim) {
          claimsCount[mint] = (claimsCount[mint] || 0) + 1;
          console.log(`[CLAIM] Mint:\( {mint.slice(0,8)}... via: \){isMint ? 'mint' : 'wallet'} Sig:${sigInfo.signature.slice(0,20)}...`);
          fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint]);
        }
      } catch (txErr) {
        // Many transactions fail to parse - ignore silently
      }
    }
  } catch (e) {
    console.error(`[Poll Error] ${addressStr.slice(0,12)}...`, e.message);
  }
}

// Keep all your helper functions exactly as they were (clean, normalizeImageUrl, formatAge, etc.)
// I'll list only the changed/important ones below for brevity. Paste your original ones for the rest.

function getFeeWallet(pumpData) {
  if (pumpData?.fee_recipients?.length > 0) {
    return pumpData.fee_recipients[0].wallet || null;
  }
  return pumpData?.creator || null;
}

// ... paste your original clean(), normalizeImageUrl(), formatAge(), getClaimTier(), formatNum(), 
// getClaimedAmount(), fetchMetadata(), getCachedTokenData(), getTokenData(), buildSocials(), 
// buildText(), buildAlertText(), buildKeyboard(), processQueue(), queueCard() here ...

// Updated trackToken
async function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) {
    return bot.sendMessage(chatId, '⚠️ You have reached the maximum of 10 tracked tokens.');
  }
  if (users[uid].some(t => t.mint === ca)) {
    return bot.sendMessage(chatId, '⚠️ Already tracking this token.');
  }

  bot.sendMessage(chatId, '🔍 Looking up token...');

  try {
    const data = await getCachedTokenData(ca);
    if (!data) throw new Error('Token data not found');

    users[uid].push({ mint: ca, ticker: data.ticker });
    watchingMints[ca] = {
      ticker: data.ticker,
      feeWallet: data.feeWallet || data.creator || null
    };

    console.log(`[Track] ${ca.slice(0,8)}... feeWallet: ${watchingMints[ca].feeWallet ? watchingMints[ca].feeWallet.slice(0,12) : 'none'}`);

    // Initialize polling
    pollAddress(ca, ca, data.ticker, true);
    if (watchingMints[ca].feeWallet && watchingMints[ca].feeWallet !== ca) {
      pollAddress(watchingMints[ca].feeWallet, ca, data.ticker, false);
    }

    const text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
  } catch (e) {
    console.error('[Track Error]', e.message);
    bot.sendMessage(chatId, '❌ Could not load token. Please check the CA and try again.');
  }
}

// Commands
bot.onText(/\/start/, (msg) => { /* your original start message */ });
bot.onText(/\/help/, (msg) => { /* your original help message */ });

bot.onText(/\/list/, (msg) => { /* your original list logic */ });

bot.onText(/\/track (.+)/, (msg, match) => {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

bot.on('message', (msg) => {
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  if (text.length >= 32 && text.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    trackToken(String(msg.chat.id), text, msg.chat.id);
  }
});

bot.on('callback_query', (query) => { /* your original callback logic - keep as is */ });

// fireAlert
function fireAlert(mint, ticker, sig, claimNum) {
  tokenCache[mint] = null;
  Promise.all([getCachedTokenData(mint), getClaimedAmount(sig)])
    .then(([data, solAmount]) => {
      if (!data) return;
      const text = buildAlertText(mint, data, solAmount, claimNum);
      Object.keys(users).forEach(uid => {
        if (users[uid]?.some(t => t.mint === mint)) {
          queueCard(uid, mint, data, text, sig);
        }
      });
    })
    .catch(e => console.error('[fireAlert Error]', e.message));
}

console.log('[Bot] Started — Dual mint + fee wallet polling (stable version)');