const TelegramBot = require('node-telegram-bot-api');
const web3 = require('@solana/web3.js');

const BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
const HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

const MAX = 10;
const CACHE_TTL = 5 * 60 * 1000;
const QUEUE_MAX = 200;
const POLL_INTERVAL = 16000;

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const users = {};           // chatId -> [{mint, ticker}]
const watchingMints = {};   // mint -> {ticker, feeWallet}
const tokenCache = {};
const lastSig = {};
const lastSigInit = {};
const claimsCount = {};
const messageQueue = [];
let isProcessing = false;
const messageTypes = {};

const globalConn = new web3.Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, 'confirmed');

// Crash protection
process.on('uncaughtException', err => console.error('[FATAL]', err.message));
process.on('unhandledRejection', reason => console.error('[FATAL Rejection]', reason));

bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'track', description: 'Track a token - /track <CA>' },
  { command: 'list', description: 'See tracked tokens' },
  { command: 'help', description: 'How to use' }
]);

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  Object.keys(tokenCache).forEach(k => {
    if (now - tokenCache[k].timestamp > CACHE_TTL) delete tokenCache[k];
  });
  if (messageQueue.length > QUEUE_MAX) messageQueue.splice(0, messageQueue.length - QUEUE_MAX);
}, 300000);

// Polling loop
setInterval(() => {
  Object.keys(watchingMints).forEach(mint => {
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
  try { pub = new web3.PublicKey(addressStr); } catch (e) { return; }

  const sigKey = addressStr;

  try {
    const sigs = await globalConn.getSignaturesForAddress(pub, { limit: 25 });
    if (!sigs?.length) return;

    if (!lastSigInit[sigKey]) {
      lastSigInit[sigKey] = true;
      lastSig[sigKey] = sigs[0].signature;
      return;
    }

    const newSigs = sigs.filter(s => s.signature !== lastSig[sigKey] && !s.err);
    if (!newSigs.length) return;

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

        const hasPump = programAddrs.includes(PUMP_PROGRAM) || programAddrs.includes(PUMP_FEE_PROGRAM);
        const hasClaimLog = logs.some(l => l && (
          l.includes('CollectCreatorFee') || l.includes('collectCreatorFee') ||
          l.includes('distributeCreatorFees') || l.includes('distribute_creator_fees')
        ));

        let isClaim = false;
        let receivedSol = 0;

        if (isMint) {
          isClaim = hasClaimLog && hasPump;
        } else {
          const idx = accountKeys.findIndex(acc => acc.pubkey?.toString() === addressStr);
          if (idx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
            receivedSol = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
            if (receivedSol > 0.001 && (hasPump || hasClaimLog)) isClaim = true;
          }
        }

        if (isClaim) {
          claimsCount[mint] = (claimsCount[mint] || 0) + 1;
          console.log(`[CLAIM DETECTED] \( {mint.slice(0,8)}... + \){receivedSol.toFixed(4)} SOL`);
          fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint], receivedSol);
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error(`[Poll Error] ${addressStr.slice(0,12)}`, e.message);
  }
}

// Helper functions
function clean(str) { if (!str) return ''; return str.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]); }

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + url.slice(7);
  if (url.includes('/ipfs/')) return 'https://ipfs.io/ipfs/' + url.split('/ipfs/')[1].split('?')[0];
  if (url.startsWith('https://')) return url;
  return null;
}

function formatAge(createdAt) {
  if (!createdAt) return 'N/A';
  const diff = Math.floor((Date.now() - (createdAt > 1e12 ? createdAt : createdAt*1000)) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  if (diff < 86400) return Math.floor(diff/3600) + 'h';
  return Math.floor(diff/86400) + 'd';
}

function getClaimTier(amt) {
  if (!amt) return '';
  if (amt >= 5) return '🚨 STRONG (5+ SOL)\n';
  if (amt >= 2) return '⚠️ MEDIUM (2-5 SOL)\n';
  return '💤 WEAK (<2 SOL)\n';
}

function formatNum(num) {
  if (!num) return 'N/A';
  if (num >= 1e6) return '$' + (num/1e6).toFixed(1) + 'M';
  if (num >= 1000) return '$' + (num/1000).toFixed(1) + 'K';
  return '$' + num.toFixed(0);
}

function getClaimedAmount(sig) {
  return fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({transactions: [sig]})
  }).then(r => r.json()).then(data => {
    if (!data?.[0]) return null;
    const tx = data[0];
    let total = 0;
    (tx.nativeTransfers || []).forEach(t => { if (t.amount) total += t.amount; });
    if (total > 0) return total / 1e9;

    let max = 0;
    (tx.accountData || []).forEach(a => { if (a.nativeBalanceChange > max) max = a.nativeBalanceChange; });
    return max > 0 ? max / 1e9 : null;
  }).catch(() => null);
}

function getCachedTokenData(ca) {
  if (tokenCache[ca] && Date.now() - tokenCache[ca].timestamp < CACHE_TTL) return Promise.resolve(tokenCache[ca].data);
  return getTokenData(ca).then(data => {
    if (data) tokenCache[ca] = {data, timestamp: Date.now()};
    return data;
  });
}

function getTokenData(ca) {
  return Promise.all([
    fetch('https://frontend-api.pump.fun/coins/' + ca).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('https://frontend-api-v2.pump.fun/coins/' + ca).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca).then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([pump, pumpV2, dex]) => {
    const pair = dex?.pairs?.[0] || null;
    const data = {...(pump||{}), ...(pumpV2||{})};

    return (data.metadata_uri ? fetch(normalizeImageUrl(data.metadata_uri) || data.metadata_uri).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null))
      .then(meta => {
        const ticker = clean(data.symbol || meta?.symbol || pair?.baseToken?.symbol || 'UNKNOWN');
        const name = clean(data.name || meta?.name || pair?.baseToken?.name || ticker);
        const pfp = normalizeImageUrl(meta?.image || data.image_uri || pair?.info?.imageUrl);
        const mc = pair ? formatNum(pair.fdv) : 'N/A';
        const vol = pair ? formatNum(pair.volume?.h24) : 'N/A';
        const feeWallet = data.creator || null;

        const dexPaid = !!pair && (pair.boosts?.active > 0 || pair.profile?.header || pair.labels?.length > 0 ||
          (pair.info?.imageUrl && (pair.info.socials?.length || pair.info.websites?.length)));

        let twitter = data.twitter || meta?.twitter || null;
        let website = data.website || meta?.website || null;
        let telegram = data.telegram || meta?.telegram || null;

        if (pair?.info?.socials) pair.info.socials.forEach(s => {
          if (s.type === 'twitter' && !twitter) twitter = s.url;
          if (s.type === 'telegram' && !telegram) telegram = s.url;
        });
        if (!website && pair?.info?.websites?.[0]) website = pair.info.websites[0].url;

        return {ticker, name, pfp, mc, vol, dexPaid, website, twitter, telegram, createdAt: data.created_timestamp, feeWallet};
      });
  });
}

function buildSocials(data) {
  const parts = [];
  if (data.twitter) parts.push(`<a href="${data.twitter}">X</a>`);
  if (data.website) parts.push(`<a href="${data.website}">Web</a>`);
  if (data.telegram) parts.push(`<a href="${data.telegram}">TG</a>`);
  return parts.length ? parts.join(' | ') : 'None';
}

function buildAlertText(ca, data, solAmount, claimNum) {
  const tier = getClaimTier(solAmount);
  const amt = solAmount ? solAmount.toFixed(4) + ' SOL' : 'Amount unknown';
  return `🚨 <b>FEE CLAIM ALERT</b>\n\n\( {tier}💰 <b> \){amt} claimed</b>\n📍 Claim #${claimNum}\n\n` +
    `<a href="https://pump.fun/coin/${ca}"><b>\[ {data.ticker}</b></a> — ${data.name || ''}\n` +
    `<code>${ca}</code>\n\n` +
    `📊 <b>Stats</b>\n├ MC: ${data.mc}\n├ Vol: ${data.vol}\n├ Age: ${formatAge(data.createdAt)}\n└ Dex: ${data.dexPaid ? '🟢' : '🔴'}\n\n` +
    `🔗 <b>Socials</b>\n└ ${buildSocials(data)}`;
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
  return {inline_keyboard: keyboard};
}

function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;
  const item = messageQueue.shift();
  const promise = item.type === 'photo' 
    ? bot.sendPhoto(item.chatId, item.pfp, {caption: item.text, parse_mode: 'HTML', reply_markup: item.markup})
        .catch(() => bot.sendMessage(item.chatId, item.text, {parse_mode: 'HTML', reply_markup: item.markup, disable_web_page_preview: true}))
    : bot.sendMessage(item.chatId, item.text, {parse_mode: 'HTML', reply_markup: item.markup, disable_web_page_preview: true});

  promise.catch(e => console.log('[Queue Error]', e.message))
         .then(() => { isProcessing = false; setTimeout(processQueue, 150); });
}

function queueCard(chatId, ca, data, text, sig) {
  if (messageQueue.length >= QUEUE_MAX) messageQueue.shift();
  const markup = buildKeyboard(ca, sig);
  messageQueue.push(data.pfp ? {type: 'photo', chatId, pfp: data.pfp, text, markup} : {type: 'text', chatId, text, markup});
  processQueue();
}

// Commands
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
    '<b>PumpFee Alert Bot</b> 🚨\n\n' +
    'Get notified when creator fees are claimed on Pump.fun tokens.\n\n' +
    'How to use:\n' +
    '• Paste token CA\n' +
    '• Or /track <CA>\n' +
    '• /list to manage', {parse_mode: 'HTML'});
});

bot.onText(/\/help/, msg => {
  bot.sendMessage(msg.chat.id,
    '<b>How to use:</b>\n\n' +
    '• Paste any Pump.fun token address\n' +
    '• /track <CA> — track a token\n' +
    '• /list — view & remove tracked tokens\n\n' +
    'You will get alerts when fees are claimed.', {parse_mode: 'HTML'});
});

bot.onText(/\/list/, msg => {
  const uid = String(msg.chat.id);
  const tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked yet.');

  bot.sendMessage(msg.chat.id, `<b>Tracked Tokens (${tokens.length}/10):</b>`, {parse_mode: 'HTML'});
  tokens.forEach(t => {
    const text = `<a href="https://pump.fun/coin/\( {t.mint}"><b> \]{t.ticker}</b></a>\n<code> \){t.mint}</code>`;
    const btns = {inline_keyboard: [[{text: '❌ Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML', reply_markup: btns, disable_web_page_preview: true});
  });
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
  if (users[uid].some(t => t.mint === ca)) return bot.sendMessage(chatId, '⚠️ Already tracking this token.');

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

bot.onText(/\/track (.+)/, (msg, match) => trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id));

bot.on('message', msg => {
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  if (text.length >= 32 && text.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    trackToken(String(msg.chat.id), text, msg.chat.id);
  }
});

function buildText(ca, data, header) {
  const dex = data.dexPaid ? '🟢' : '🔴';
  return header +
    `<a href="https://pump.fun/coin/${ca}"><b>$${data.ticker}</b></a> — ${data.name}\n` +
    `<code>${ca}</code>\n\n` +
    `📊 <b>Stats</b>\n` +
    `├ MC: ${data.mc}\n` +
    `├ Vol: ${data.vol}\n` +
    `├ Age: ${formatAge(data.createdAt)}\n` +
    `└ Dex: ${dex}\n\n` +
    `🔗 <b>Socials</b>\n` +
    `└ ${buildSocials(data)}`;
}

function fireAlert(mint, ticker, sig, claimNum, receivedSol) {
  tokenCache[mint] = null;
  Promise.all([getCachedTokenData(mint), getClaimedAmount(sig)])
    .then(([data, solFromHelius]) => {
      const finalSol = receivedSol || solFromHelius;
      const text = buildAlertText(mint, data || {ticker, name: '', mc: 'N/A', vol: 'N/A', dexPaid: false, createdAt: null}, finalSol, claimNum);
      Object.keys(users).forEach(uid => {
        if (users[uid]?.some(t => t.mint === mint)) {
          queueCard(uid, mint, data || {}, text, sig);
        }
      });
    })
    .catch(e => console.error('[fireAlert]', e.message));
}

console.log('[Bot] Started — Clean version with fixed commands and detection');