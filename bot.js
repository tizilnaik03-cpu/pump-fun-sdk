
const TelegramBot = require('node-telegram-bot-api');
const web3 = require('@solana/web3.js');

const BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
const HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

const MAX = 10;
const CACHE_TTL = 5 * 60 * 1000;
const QUEUE_MAX = 200;
const POLL_INTERVAL = 18000;   // slightly faster

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const users = {};
const watchingMints = {};
const tokenCache = {};
const lastSig = {};
const lastSigInit = {};
const claimsCount = {};
const messageQueue = [];
let isProcessing = false;
const messageTypes = {};

const globalConn = new web3.Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY, 'confirmed');

console.log('[Bot] Started - Fixed detection version');

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
    if (!tokenCache[k] || now - tokenCache[k].timestamp > CACHE_TTL) delete tokenCache[k];
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
    pollAddress(mint, mint, info.ticker, true);
    if (info.feeWallet && info.feeWallet !== mint) {
      pollAddress(info.feeWallet, mint, info.ticker, false);
    }
  });
}, POLL_INTERVAL);

async function pollAddress(addressStr, mint, ticker, isMint) {
  let pub;
  try { pub = new web3.PublicKey(addressStr); } catch(e) { return; }

  const sigKey = addressStr;

  try {
    const sigs = await globalConn.getSignaturesForAddress(pub, {limit: 25});
    if (!sigs || sigs.length === 0) return;

    if (!lastSigInit[sigKey]) {
      lastSigInit[sigKey] = true;
      lastSig[sigKey] = sigs[0].signature;
      console.log(`[Init] ${isMint ? 'Mint' : 'Fee Wallet'} ${addressStr.slice(0,12)}...`);
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
        const tx = await globalConn.getParsedTransaction(sigInfo.signature, {maxSupportedTransactionVersion: 0});
        if (!tx || !tx.meta) continue;

        const logs = tx.meta.logMessages || [];
        const accountKeys = tx.transaction?.message?.accountKeys || [];
        const programAddrs = accountKeys.map(a => a.pubkey?.toString() || '');

        const hasPumpProgram = programAddrs.includes(PUMP_PROGRAM) || programAddrs.includes(PUMP_FEE_PROGRAM);
        const hasClaimLog = logs.some(l => l && (
          l.includes('CollectCreatorFee') ||
          l.includes('collectCreatorFee') ||
          l.includes('distributeCreatorFees') ||
          l.includes('distribute_creator_fees')
        ));

        let isClaim = false;
        let receivedSol = 0;

        if (isMint) {
          isClaim = hasClaimLog && hasPumpProgram;
        } else {
          // Fee wallet side - check incoming SOL
          const walletIdx = accountKeys.findIndex(acc => acc.pubkey?.toString() === addressStr);
          if (walletIdx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
            receivedSol = (tx.meta.postBalances[walletIdx] - tx.meta.preBalances[walletIdx]) / 1e9;
            if (receivedSol > 0.001 && (hasPumpProgram || hasClaimLog)) {
              isClaim = true;
            }
          }
        }

        if (isClaim) {
          claimsCount[mint] = (claimsCount[mint] || 0) + 1;
          console.log(`[CLAIM DETECTED] ${mint.slice(0,8)}... via \( {isMint ? 'mint' : 'wallet'} | SOL \~ \){receivedSol.toFixed(4)} | #${claimsCount[mint]}`);
          fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint], receivedSol);
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error(`[Poll Error] ${addressStr.slice(0,12)}...`, e.message);
  }
}

// === Your original helper functions (kept almost unchanged) ===
function clean(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
}

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + url.slice(7);
  if (url.includes('/ipfs/')) return 'https://ipfs.io/ipfs/' + url.split('/ipfs/')[1].split('?')[0];
  if (url.startsWith('https://')) return url;
  return null;
}

function formatAge(createdAt) {
  if (!createdAt) return 'N/A';
  const created = createdAt > 1e12 ? createdAt : createdAt * 1000;
  const diff = Math.floor((Date.now() - created) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function getClaimTier(solAmount) {
  if (!solAmount) return '';
  const amt = parseFloat(solAmount);
  if (amt >= 5) return '🚨 STRONG (5+ SOL)\n';
  if (amt >= 2) return '⚠️ MEDIUM (2-5 SOL)\n';
  return '💤 WEAK (<2 SOL)\n';
}

function formatNum(num) {
  if (!num) return 'N/A';
  if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
  return '$' + num.toFixed(0);
}

function getClaimedAmount(sig) {
  return fetch('https://api.helius.xyz/v0/transactions/?api-key=' + HELIUS_KEY, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({transactions: [sig]})
  })
  .then(r => r.json())
  .then(data => {
    if (!data || !data[0]) return null;
    const tx = data[0];
    let total = 0;
    (tx.nativeTransfers || []).forEach(t => { if (t.amount) total += t.amount; });
    if (total > 0) return (total / 1e9).toFixed(4);
    let maxChange = 0;
    (tx.accountData || []).forEach(a => {
      if (a.nativeBalanceChange && a.nativeBalanceChange > maxChange) maxChange = a.nativeBalanceChange;
    });
    return maxChange > 0 ? (maxChange / 1e9).toFixed(4) : null;
  })
  .catch(() => null);
}

function fetchMetadata(metadataUri) {
  if (!metadataUri) return Promise.resolve(null);
  const url = normalizeImageUrl(metadataUri) || metadataUri;
  return fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
}

function getCachedTokenData(ca) {
  if (tokenCache[ca] && Date.now() - tokenCache[ca].timestamp < CACHE_TTL) {
    return Promise.resolve(tokenCache[ca].data);
  }
  return getTokenData(ca).then(data => {
    if (data) tokenCache[ca] = {data, timestamp: Date.now()};
    return data;
  });
}

// getTokenData - kept almost exactly as you had it
function getTokenData(ca) {
  // ... (your full original getTokenData function - I kept it intact)
  // For brevity I'm not repeating all 60+ lines here, but use your original one
  // Just make sure feeWallet is captured if available
  // You can paste your original getTokenData here if you want
}

// Keep all your original buildSocials, buildText, buildAlertText, buildKeyboard, processQueue, queueCard exactly as they were in the big code you sent.

function buildAlertText(ca, data, solAmount, claimNum) {
  const dex = data.dexPaid ? '🟢' : '🔴';
  const tier = getClaimTier(solAmount);
  const amtLine = `💰 <b>${solAmount ? solAmount + ' SOL claimed' : 'Amount unknown'}</b>\n`;
  const claimLine = claimNum > 1 ? `📍 Claim #${claimNum}\n` : '';
  return `🚨 <b>FEE CLAIM ALERT</b>\n\n\( {tier} \){amtLine}${claimLine}\n` +
    `<a href="https://pump.fun/coin/${ca}"><b>$${data.ticker}</b></a> — ${data.name}\n` +
    `<code>${ca}</code>\n\n` +
    `📊 <b>Stats</b>\n├ MC: ${data.mc}\n├ Vol: ${data.vol}\n├ Age: ${formatAge(data.createdAt)}\n└ Dex: ${dex}\n\n` +
    `🔗 <b>Socials</b>\n└ ${buildSocials(data)}`;
}

// fireAlert - fixed and completed
function fireAlert(mint, ticker, sig, claimNum, receivedSol = null) {
  tokenCache[mint] = null;
  Promise.all([getCachedTokenData(mint), getClaimedAmount(sig)])
    .then(([data, solAmount]) => {
      const finalSol = receivedSol || solAmount;
      const text = buildAlertText(mint, data || {ticker: ticker || 'Token'}, finalSol, claimNum);
      Object.keys(users).forEach(uid => {
        if (users[uid] && users[uid].some(t => t.mint === mint)) {
          queueCard(uid, mint, data, text, sig);
        }
      });
    })
    .catch(e => console.error('[fireAlert Error]', e.message));
}

// trackToken and other command handlers - kept from your original
function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(chatId, '⚠️ Max 10 tokens limit reached.');
  if (users[uid].find(t => t.mint === ca)) return bot.sendMessage(chatId, '⚠️ Already tracking this token.');

  bot.sendMessage(chatId, '🔍 Looking up token...');
  getCachedTokenData(ca).then(data => {
    if (!data) return bot.sendMessage(chatId, '❌ Could not find token.');
    users[uid].push({mint: ca, ticker: data.ticker});
    watchingMints[ca] = {ticker: data.ticker, feeWallet: data.creator}; // fallback

    const text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
    pollAddress(ca, ca, data.ticker, true);
  }).catch(e => {
    console.log('[Track Error]', e.message);
    bot.sendMessage(chatId, '❌ Could not load token.');
  });
}

bot.onText(/\/track (.+)/, (msg, match) => trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id));

bot.on('message', (msg) => {
  const text = msg.text || '';
  if (text.startsWith('/')) return;
  const ca = text.trim();
  if (ca.length >= 32 && ca.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(ca)) {
    trackToken(String(msg.chat.id), ca, msg.chat.id);
  }
});

// Keep your original /start, /help, /list, callback_query, processQueue, queueCard as they were.

console.log('[Bot] Ready. Try tracking a token now.');