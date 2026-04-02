const TelegramBot = require('node-telegram-bot-api');
const web3 = require('@solana/web3.js');

const BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
const HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

const MAX = 10;
const CACHE_TTL = 5 * 60 * 1000;
const QUEUE_MAX = 200;
const POLL_INTERVAL = 15000;   // Faster polling (15s)

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const users = {};           // chatId -> [{mint, ticker}]
const watchingMints = {};   // mint -> {ticker, feeWallet?}
const watchingWallets = {}; // wallet -> {label, trackedMints: []}  // for direct wallet tracking
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

// Prevent Railway crashes
process.on('uncaughtException', (err) => console.error('[FATAL] Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('[FATAL] Rejection:', reason));

bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'track', description: 'Track a token - /track <CA>' },
  { command: 'trackwallet', description: 'Track a fee wallet directly - /trackwallet <address>' },
  { command: 'list', description: 'See your tracked tokens/wallets' },
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

// Main polling loop
setInterval(() => {
  // Poll tracked mints + their fee wallets
  Object.keys(watchingMints).forEach(mint => {
    const info = watchingMints[mint];
    if (!info) return;
    pollAddress(mint, mint, info.ticker, true);
    if (info.feeWallet && info.feeWallet !== mint) {
      pollAddress(info.feeWallet, mint, info.ticker, false);
    }
  });

  // Poll directly tracked wallets
  Object.keys(watchingWallets).forEach(wallet => {
    pollAddress(wallet, null, 'Direct Wallet', false);
  });
}, POLL_INTERVAL);

async function pollAddress(addressStr, mint, ticker, isMint) {
  let pub;
  try { pub = new web3.PublicKey(addressStr); } catch (e) { return; }

  const sigKey = addressStr;

  try {
    const sigs = await globalConn.getSignaturesForAddress(pub, { limit: 25 });
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
        const hasClaimLog = logs.some(l => l && (
          l.includes('CollectCreatorFee') ||
          l.includes('collectCreatorFee') ||
          l.includes('distributeCreatorFees') ||
          l.includes('distribute_creator_fees') ||
          l.includes('creator fee') ||
          l.includes('fee')
        ));

        let isClaim = false;
        let receivedSol = 0;

        if (isMint) {
          isClaim = hasClaimLog && hasPumpProgram;
        } else {
          // Wallet side - detect incoming SOL
          const walletIdx = accountKeys.findIndex(acc => acc.pubkey?.toString() === addressStr);
          if (walletIdx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
            receivedSol = (tx.meta.postBalances[walletIdx] - tx.meta.preBalances[walletIdx]) / 1e9;
            if (receivedSol > 0.001 && (hasPumpProgram || hasClaimLog)) {
              isClaim = true;
            }
          }
        }

        if (isClaim) {
          claimsCount[mint || addressStr] = (claimsCount[mint || addressStr] || 0) + 1;
          console.log(`[CLAIM DETECTED] ${mint ? 'Mint' : 'Wallet'} \( { (mint || addressStr).slice(0,8) }... + \){receivedSol.toFixed(4)} SOL #${claimsCount[mint || addressStr]}`);
          fireAlert(mint || addressStr, ticker || 'Fee Wallet', sigInfo.signature, claimsCount[mint || addressStr], receivedSol);
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error(`[Poll Error] ${addressStr.slice(0,12)}`, e.message);
  }
}

// === Helper functions (unchanged from your original where possible) ===
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
  return fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: [sig] })
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
    if (data) tokenCache[ca] = { data, timestamp: Date.now() };
    return data;
  });
}

function getTokenData(ca) {
  const pumpReq = fetch('https://frontend-api.pump.fun/coins/' + ca).then(r => r.ok ? r.json() : null).catch(() => null);
  const pumpV2Req = fetch('https://frontend-api-v2.pump.fun/coins/' + ca).then(r => r.ok ? r.json() : null).catch(() => null);
  const dexReq = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca).then(r => r.ok ? r.json() : null).catch(() => null);

  return Promise.all([pumpReq, pumpV2Req, dexReq]).then(results => {
    const pump = results[0];
    const pumpV2 = results[1];
    const dex = results[2];
    const pair = dex?.pairs?.[0] || null;

    const pumpData = {};
    if (pump) Object.keys(pump).forEach(k => { if (pump[k] != null) pumpData[k] = pump[k]; });
    if (pumpV2) Object.keys(pumpV2).forEach(k => { if (!pumpData[k] && pumpV2[k] != null) pumpData[k] = pumpV2[k]; });

    const metaReq = pumpData.metadata_uri ? fetchMetadata(pumpData.metadata_uri) : Promise.resolve(null);

    return metaReq.then(meta => {
      const ticker = clean(pumpData.symbol || meta?.symbol || pair?.baseToken?.symbol || 'UNKNOWN');
      const name = clean(pumpData.name || meta?.name || pair?.baseToken?.name || ticker);
      const rawPfp = meta?.image || pumpData.image_uri || pair?.info?.imageUrl || null;
      const pfp = normalizeImageUrl(rawPfp);

      const mc = pair ? formatNum(pair.fdv) : 'N/A';
      const vol = pair ? formatNum(pair.volume?.h24) : 'N/A';
      const createdAt = pumpData.created_timestamp || null;
      const feeWallet = pumpData.creator || null;   // fallback

      const dexPaid = !!pair && (pair.boosts?.active > 0 || pair.profile?.header || pair.labels?.length > 0 ||
        (pair.info?.imageUrl && (pair.info.socials?.length || pair.info.websites?.length)));

      let twitter = pumpData.twitter || meta?.twitter || null;
      let website = pumpData.website || meta?.website || null;
      let telegram = pumpData.telegram || meta?.telegram || null;

      if (pair?.info?.socials) {
        pair.info.socials.forEach(s => {
          if (s.type === 'twitter' && !twitter) twitter = s.url;
          if (s.type === 'telegram' && !telegram) telegram = s.url;
        });
      }
      if (!website && pair?.info?.websites?.[0]) website = pair.info.websites[0].url;

      return { ticker, name, pfp, mc, vol, dexPaid, website, twitter, telegram, createdAt, feeWallet };
    });
  });
}

function buildSocials(data) {
  const parts = [];
  if (data.twitter) parts.push(`<a href="${data.twitter}">X</a>`);
  if (data.website) parts.push(`<a href="${data.website}">Web</a>`);
  if (data.telegram) parts.push(`<a href="${data.telegram}">TG</a>`);
  return parts.length > 0 ? parts.join(' | ') : 'None';
}

function buildText(ca, data, header) {
  const dex = data.dexPaid ? '🟢' : '🔴';
  return header +
    `<a href="https://pump.fun/coin/${ca}"><b>\[ {data.ticker}</b></a> — ${data.name}\n` +
    `<code>${ca}</code>\n\n` +
    `📊 <b>Stats</b>\n` +
    `├ MC: ${data.mc}\n` +
    `├ Vol: ${data.vol}\n` +
    `├ Age: ${formatAge(data.createdAt)}\n` +
    `└ Dex: ${dex}\n\n` +
    `🔗 <b>Socials</b>\n` +
    `└ ${buildSocials(data)}`;
}

function buildAlertText(ca, data, solAmount, claimNum) {
  const dex = data.dexPaid ? '🟢' : '🔴';
  const tier = getClaimTier(solAmount);
  const amtLine = `💰 <b>${solAmount ? solAmount.toFixed(4) + ' SOL claimed' : 'Amount unknown'}</b>\n`;
  const claimLine = claimNum > 1 ? `📍 Claim #${claimNum}\n` : '';
  return `🚨 <b>FEE CLAIM ALERT</b>\n\n` +
    tier + amtLine + claimLine + '\n' +
    (ca.length > 40 ? `<code>\( {ca}</code>` : `<a href="https://pump.fun/coin/ \){ca}"><b> \]{data.ticker || 'Token'}</b></a> — \( {data.name || ''}\n<code> \){ca}</code>`) + '\n\n' +
    `📊 <b>Stats</b>\n` +
    `├ MC: ${data.mc}\n` +
    `├ Vol: ${data.vol}\n` +
    `├ Age: ${formatAge(data.createdAt)}\n` +
    `└ Dex: ${dex}\n\n` +
    `🔗 <b>Socials</b>\n` +
    `└ ${buildSocials(data)}`;
}

function buildKeyboard(ca, sig) {
  const keyboard = [
    [
      {text: 'AXI', url: 'https://axiom.trade/t/' + ca},
      {text: 'TRO', url: 'https://t.me/solana_trojanbot?start=' + ca},
      {text: 'BLO', url: 'https://t.me/BloomSolana_bot?start=' + ca},
      {text: 'PHO', url: 'https://photon-sol.tinyastro.io/en/lp/' + ca}
    ],
    [
      {text: 'OKX', url: `https://www.okx.com/web3/dex-swap#inputChain=501&inputCurrency=SOL&outputChain=501&outputCurrency=${ca}`},
      {text: 'NEO', url: 'https://bullx.io/terminal?chainId=1399811149&address=' + ca},
      {text: 'TRM', url: 'https://padre.trade/token/' + ca},
      {text: 'DEX', url: 'https://dexscreener.com/solana/' + ca}
    ],
    [{text: '🔄 Refresh', callback_data: 'refresh:' + ca}]
  ];
  if (sig) keyboard[2].push({text: '🔍 Solscan', url: 'https://solscan.io/tx/' + sig});
  return { inline_keyboard: keyboard };
}

function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;
  const item = messageQueue.shift();

  const promise = item.type === 'photo'
    ? bot.sendPhoto(item.chatId, item.pfp, { caption: item.text, parse_mode: 'HTML', reply_markup: item.markup })
        .catch(() => bot.sendMessage(item.chatId, item.text, { parse_mode: 'HTML', reply_markup: item.markup, disable_web_page_preview: true }))
    : bot.sendMessage(item.chatId, item.text, { parse_mode: 'HTML', reply_markup: item.markup, disable_web_page_preview: true });

  promise.catch(e => console.log('[Queue Error]', e.message))
         .then(() => { isProcessing = false; setTimeout(processQueue, 150); });
}

function queueCard(chatId, ca, data, text, sig) {
  if (messageQueue.length >= QUEUE_MAX) messageQueue.shift();
  const markup = buildKeyboard(ca, sig);
  messageQueue.push(data.pfp 
    ? {type: 'photo', chatId, pfp: data.pfp, text, markup}
    : {type: 'text', chatId, text, markup}
  );
  processQueue();
}

// Commands
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, '<b>PumpFee Alert Bot</b> 🚨\n\nPaste CA or use /track <CA>\nUse /trackwallet <address> for direct fee wallet monitoring.', {parse_mode: 'HTML'});
});

bot.onText(/\/help/, msg => {
  bot.sendMessage(msg.chat.id, '<b>How to use:</b>\n• Paste CA\n• /track <CA>\n• /trackwallet <wallet>\n• /list\n\nMax 10 tokens.', {parse_mode: 'HTML'});
});

bot.onText(/\/list/, msg => {
  const uid = String(msg.chat.id);
  const tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tracked items yet.');
  bot.sendMessage(msg.chat.id, `<b>Tracked (${tokens.length}/10):</b>`, {parse_mode: 'HTML'});
  tokens.forEach(t => {
    const text = `<a href="https://pump.fun/coin/${t.mint}"><b>$${t.ticker}</b></a>\n<code>${t.mint}</code>`;
    const btns = {inline_keyboard: [[{text: '❌ Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML', reply_markup: btns, disable_web_page_preview: true});
  });
});

// New command: Track wallet directly
bot.onText(/\/trackwallet (.+)/, (msg, match) => {
  const uid = String(msg.chat.id);
  const wallet = match[1].trim();
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(msg.chat.id, '⚠️ Max limit reached.');
  if (users[uid].some(t => t.mint === wallet)) return bot.sendMessage(msg.chat.id, '⚠️ Already tracking.');

  users[uid].push({mint: wallet, ticker: 'Fee Wallet'});
  watchingWallets[wallet] = {label: 'Direct Fee Wallet', trackedMints: []};

  bot.sendMessage(msg.chat.id, `✅ Now tracking fee wallet:\n<code>${wallet}</code>\n\nAlerts will fire on incoming Pump fees.`, {parse_mode: 'HTML'});
  pollAddress(wallet, null, 'Fee Wallet', false);
});

bot.onText(/\/track (.+)/, (msg, match) => {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

bot.on('message', msg => {
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  if (text.length >= 32 && text.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    trackToken(String(msg.chat.id), text, msg.chat.id);
  }
});

bot.on('callback_query', query => {
  const uid = String(query.message.chat.id);
  const data = query.data;
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;

  if (data.startsWith('remove:')) {
    const ca = data.replace('remove:', '');
    if (users[uid]) users[uid] = users[uid].filter(t => t.mint !== ca);
    const stillTracked = Object.keys(users).some(u => users[u]?.some(t => t.mint === ca));
    if (!stillTracked) {
      if (watchingMints[ca]?.feeWallet) delete lastSig[watchingMints[ca].feeWallet];
      delete watchingMints[ca];
      delete watchingWallets[ca];
      delete lastSig[ca];
      delete lastSigInit[ca];
      delete claimsCount[ca];
      delete tokenCache[ca];
    }
    bot.answerCallbackQuery(query.id, {text: '✅ Removed!'});
    bot.editMessageReplyMarkup({inline_keyboard: []}, {chat_id: chatId, message_id: msgId}).catch(() => {});
  }

  if (data.startsWith('refresh:')) {
    const ca = data.replace('refresh:', '');
    bot.answerCallbackQuery(query.id, {text: '🔄 Refreshing...'});
    tokenCache[ca] = null;
    getCachedTokenData(ca).then(data => {
      if (!data) return;
      const text = buildText(ca, data, '🔄 <b>Refreshed</b>\n\n');
      const markup = buildKeyboard(ca, null);
      bot.editMessageText(text, {chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: markup, disable_web_page_preview: true}).catch(() => {});
    });
  }
});

async function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(chatId, '⚠️ Max 10 tokens reached.');
  if (users[uid].some(t => t.mint === ca)) return bot.sendMessage(chatId, '⚠️ Already tracking.');

  bot.sendMessage(chatId, '🔍 Looking up token...');
  try {
    const data = await getCachedTokenData(ca);
    if (!data) throw new Error();

    users[uid].push({mint: ca, ticker: data.ticker});
    watchingMints[ca] = {ticker: data.ticker, feeWallet: data.feeWallet || data.creator || null};

    pollAddress(ca, ca, data.ticker, true);
    if (watchingMints[ca].feeWallet && watchingMints[ca].feeWallet !== ca) {
      pollAddress(watchingMints[ca].feeWallet, ca, data.ticker, false);
    }

    const text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
  } catch (e) {
    bot.sendMessage(chatId, '❌ Could not load token. Check the CA.');
  }
}

function fireAlert(mintOrWallet, ticker, sig, claimNum, receivedSol = null) {
  tokenCache[mintOrWallet] = null;
  const isWalletOnly = mintOrWallet.length > 40 && !ticker.includes('Token'); // rough check

  Promise.all([isWalletOnly ? Promise.resolve({ticker: 'Fee Wallet', name: '', mc: 'N/A', vol: 'N/A', dexPaid: false, createdAt: null}) : getCachedTokenData(mintOrWallet), getClaimedAmount(sig)])
    .then(([data, solAmount]) => {
      if (!data) data = {ticker: ticker || 'Unknown', name: '', mc: 'N/A', vol: 'N/A', dexPaid: false, createdAt: null};
      const finalSol = receivedSol || solAmount;
      const text = buildAlertText(mintOrWallet, data, finalSol, claimNum);
      Object.keys(users).forEach(uid => {
        if (users[uid]?.some(t => t.mint === mintOrWallet)) {
          queueCard(uid, mintOrWallet, data, text, sig);
        }
      });
    })
    .catch(e => console.error('[fireAlert Error]', e.message));
}

console.log('[Bot] Started — Full version with /trackwallet + improved claim detection');