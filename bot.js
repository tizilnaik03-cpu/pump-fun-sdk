var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

var MAX = 10;
var CACHE_TTL = 5 * 60 * 1000;
var QUEUE_MAX = 200;
var POLL_INTERVAL = 18000;        // 18 seconds - slightly staggered

var PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
var PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

var bot = new TelegramBot(BOT_TOKEN, { polling: true });

var users = {};           // chatId -> array of {mint, ticker}
var watchingMints = {};   // mint -> {ticker, feeWallet?}
var tokenCache = {};
var lastSig = {};
var lastSigInit = {};
var claimsCount = {};
var messageQueue = [];
var isProcessing = false;
var messageTypes = {};

var globalConn = new web3.Connection(
  'https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY,
  'confirmed'
);

// Global error handler (very important on Railway)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

// Bot commands
bot.setMyCommands([
  {command: 'start', description: 'Start the bot'},
  {command: 'track', description: 'Track a token - /track <CA>'},
  {command: 'list', description: 'See your tracked tokens'},
  {command: 'help', description: 'How to use this bot'}
]);

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  Object.keys(tokenCache).forEach(k => {
    if (now - tokenCache[k].timestamp > CACHE_TTL) delete tokenCache[k];
  });
  if (messageQueue.length > QUEUE_MAX) messageQueue = messageQueue.slice(-QUEUE_MAX);
}, 300000);

// Main polling loop
setInterval(() => {
  const mints = Object.keys(watchingMints);
  if (mints.length === 0) return;

  mints.forEach(mint => {
    const info = watchingMints[mint];
    if (!info) return;

    pollAddress(mint, mint, info.ticker, true);                    // Poll mint
    if (info.feeWallet && info.feeWallet !== mint) {
      pollAddress(info.feeWallet, mint, info.ticker, false);       // Poll fee wallet
    }
  });
}, POLL_INTERVAL);

// Improved poll function with better error handling and logging
async function pollAddress(addressStr, mint, ticker, isMint) {
  let pub;
  try {
    pub = new web3.PublicKey(addressStr);
  } catch (e) {
    console.error('[Poll] Invalid address:', addressStr);
    return;
  }

  const sigKey = addressStr;

  try {
    const sigs = await globalConn.getSignaturesForAddress(pub, { limit: 20 });

    if (!sigs || sigs.length === 0) return;

    if (!lastSigInit[sigKey]) {
      lastSigInit[sigKey] = true;
      lastSig[sigKey] = sigs[0].signature;
      console.log(`[Init] ${isMint ? 'Mint' : 'Wallet'} ${addressStr.slice(0,12)}...`);
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
          l && (l.includes('CollectCreatorFee') || 
                l.includes('distributeCreatorFees') || 
                l.includes('distribute_creator_fees') ||
                l.includes('creator'))
        );

        let isClaim = false;

        if (isMint) {
          isClaim = hasClaimLog && hasPumpProgram;
        } else {
          // Wallet side: check SOL received
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
          console.log(`[CLAIM DETECTED] Mint: ${mint.slice(0,8)}... via: ${isMint ? 'mint' : 'wallet'} | SOL change likely | Sig: ${sigInfo.signature.slice(0,20)}...`);
          fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint]);
        }
      } catch (txErr) {
        // Silent - many txs fail to parse
      }
    }
  } catch (e) {
    console.error(`[Poll Error] ${addressStr.slice(0,12)}...`, e.message);
  }
}

// ... (keep your clean, normalizeImageUrl, formatAge, getClaimTier, formatNum, getClaimedAmount, fetchMetadata, buildSocials, buildText, buildAlertText, buildKeyboard, processQueue, queueCard functions unchanged)

// Improved trackToken with better feeWallet fallback
async function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) {
    return bot.sendMessage(chatId, '⚠️ Max 10 tokens per user reached.');
  }
  if (users[uid].some(t => t.mint === ca)) {
    return bot.sendMessage(chatId, '⚠️ Already tracking this token.');
  }

  bot.sendMessage(chatId, '🔍 Fetching token data...');

  try {
    const data = await getCachedTokenData(ca);
    if (!data) throw new Error('No data');

    users[uid].push({ mint: ca, ticker: data.ticker });
    watchingMints[ca] = { 
      ticker: data.ticker, 
      feeWallet: data.feeWallet || data.creator || null 
    };

    console.log(`[Track] ${ca} | feeWallet: ${watchingMints[ca].feeWallet ? watchingMints[ca].feeWallet.slice(0,12) : 'none'}`);

    // Initialize polling
    pollAddress(ca, ca, data.ticker, true);
    if (watchingMints[ca].feeWallet && watchingMints[ca].feeWallet !== ca) {
      pollAddress(watchingMints[ca].feeWallet, ca, data.ticker, false);
    }

    const text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
  } catch (e) {
    console.error('[Track Error]', e.message);
    bot.sendMessage(chatId, '❌ Failed to load token. Check the CA.');
  }
}

// Fixed regex
bot.onText(/\/track (.+)/, (msg, match) => {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

bot.on('message', (msg) => {
  const text = msg.text?.trim() || '';
  if (text.startsWith('/')) return;

  if (text.length >= 32 && text.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    trackToken(String(msg.chat.id), text, msg.chat.id);
  }
});

// Keep your /start, /help, /list, callback_query, fireAlert, etc. (they look mostly fine)

// At the very end
console.log('[Bot] Started — Dual mint + fee wallet polling (improved stability)');