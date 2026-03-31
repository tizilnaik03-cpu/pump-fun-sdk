var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;
var CACHE_TTL = 5 * 60 * 1000;
var QUEUE_MAX = 200;
var POLL_INTERVAL = 30000;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};
var watchingMints = {};
var subscriptions = {};
var tokenCache = {};
var recentAlerts = {};
var lastSig = {};
var claimsCount = {};
var messageQueue = [];
var isProcessing = false;
var globalConn = new web3.Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY, 'confirmed');

bot.setMyCommands([
  {command: 'start', description: 'Start the bot'},
  {command: 'track', description: 'Track a token - /track <CA>'},
  {command: 'list', description: 'See your tracked tokens'},
  {command: 'help', description: 'How to use this bot'}
]);

setInterval(function() {
  var now = Date.now();
  Object.keys(tokenCache).forEach(function(k) {
    if (!tokenCache[k] || now - tokenCache[k].timestamp > CACHE_TTL) delete tokenCache[k];
  });
  if (messageQueue.length > QUEUE_MAX) messageQueue = messageQueue.slice(-QUEUE_MAX);
}, 300000);

// Poll all tracked mints every 30s — catches claims that WebSocket misses
setInterval(function() {
  var mints = Object.keys(watchingMints);
  if (mints.length === 0) return;
  console.log('[Poll] checking ' + mints.length + ' mints');
  mints.forEach(function(mint) {
    var ticker = null;
    Object.keys(users).forEach(function(uid) {
      var t = users[uid] && users[uid].find(function(t) { return t.mint === mint; });
      if (t && !ticker) ticker = t.ticker;
    });
    if (!ticker) return;
    pollMint(mint, ticker);
  });
}, POLL_INTERVAL);

function pollMint(mint, ticker) {
  try {
    var pub = new web3.PublicKey(mint);
    globalConn.getSignaturesForAddress(pub, {limit: 10})
      .then(function(sigs) {
        if (!sigs || sigs.length === 0) return;
        sigs.forEach(function(sigInfo) {
          if (sigInfo.err) return;
          if (lastSig[mint] === sigInfo.signature) return;
          // Check this transaction for CollectCreatorFee
          globalConn.getParsedTransaction(sigInfo.signature, {maxSupportedTransactionVersion: 0})
            .then(function(tx) {
              if (!tx || !tx.meta) return;
              var logs = tx.meta.logMessages || [];
              var isClaim = logs.some(function(l) { return l && l.includes('CollectCreatorFee'); });
              if (!isClaim) return;
              if (lastSig[mint] === sigInfo.signature) return;
              lastSig[mint] = sigInfo.signature;
              claimsCount[mint] = (claimsCount[mint] || 0) + 1;
              console.log('[Poll] CLAIM found mint:' + mint + ' sig:' + sigInfo.signature + ' #' + claimsCount[mint]);
              fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint]);
            })
            .catch(function() {});
        });
      })
      .catch(function() {});
  } catch(e) {
    console.log('[Poll] Error for ' + mint + ': ' + e.message);
  }
}

function clean(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, function(c) {
    return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];
  });
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
  var created = createdAt > 1e12 ? createdAt : createdAt * 1000;
  var diff = Math.floor((Date.now() - created) / 1000);
  if (diff < 0 || diff > 31536000) return 'N/A';
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function getClaimTier(solAmount) {
  if (!solAmount) return '';
  var amt = parseFloat(solAmount);
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
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data || !data[0]) return null;
    var tx = data[0];
    var total = 0;
    (tx.nativeTransfers || []).forEach(function(t) { if (t.amount) total += t.amount; });
    if (total > 0) return (total / 1e9).toFixed(4);
    var maxChange = 0;
    (tx.accountData || []).forEach(function(a) {
      if (a.nativeBalanceChange && a.nativeBalanceChange > maxChange) maxChange = a.nativeBalanceChange;
    });
    return maxChange > 0 ? (maxChange / 1e9).toFixed(4) : null;
  })
  .catch(function() { return null; });
}

function getCachedTokenData(ca) {
  if (tokenCache[ca] && Date.now() - tokenCache[ca].timestamp < CACHE_TTL) {
    return Promise.resolve(tokenCache[ca].data);
  }
  return getTokenData(ca).then(function(data) {
    if (data) tokenCache[ca] = {data: data, timestamp: Date.now()};
    return data;
  });
}

function getTokenData(ca) {
  var pumpReq = fetch('https://frontend-api.pump.fun/coins/' + ca)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  var dexReq = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  return Promise.all([pumpReq, dexReq]).then(function(results) {
    var pump = results[0];
    var dex = results[1];
    var pair = dex && dex.pairs && dex.pairs.length > 0 ? dex.pairs[0] : null;

    var ticker = clean((pump && pump.symbol) || (pair && pair.baseToken && pair.baseToken.symbol) || 'UNKNOWN');
    var name = clean((pump && pump.name) || (pair && pair.baseToken && pair.baseToken.name) || ticker);
    var pfp = normalizeImageUrl((pump && pump.image_uri) || (pair && pair.info && pair.info.imageUrl) || null);
    var mc = pair ? formatNum(pair.fdv) : 'N/A';
    var vol = pair ? formatNum(pair.volume && pair.volume.h24) : 'N/A';
    var createdAt = (pump && pump.created_timestamp) || null;

    var dexPaid = false;
    if (pair) {
      if (pair.boosts && pair.boosts.active > 0) dexPaid = true;
      if (!dexPaid && pair.profile && pair.profile.header) dexPaid = true;
      if (!dexPaid && pair.labels && pair.labels.length > 0) dexPaid = true;
      if (!dexPaid && pair.info && pair.info.imageUrl &&
        ((pair.info.socials && pair.info.socials.length > 0) ||
         (pair.info.websites && pair.info.websites.length > 0))) dexPaid = true;
    }

    var twitter = (pump && pump.twitter && pump.twitter.trim() !== '') ? pump.twitter : null;
    var website = (pump && pump.website && pump.website.trim() !== '') ? pump.website : null;
    var telegram = (pump && pump.telegram && pump.telegram.trim() !== '') ? pump.telegram : null;

    if (pair && pair.info) {
      if (pair.info.socials) {
        pair.info.socials.forEach(function(s) {
          if (s.type === 'twitter' && !twitter) twitter = s.url;
          if (s.type === 'telegram' && !telegram) telegram = s.url;
        });
      }
      if (!website && pair.info.websites && pair.info.websites[0]) website = pair.info.websites[0].url;
    }

    console.log('[Token]', ticker, '| pfp:', !!pfp, '| dexPaid:', dexPaid, '| age:', formatAge(createdAt));
    return { ticker, name, pfp, mc, vol, dexPaid, website, twitter, telegram, createdAt };
  });
}

function buildSocials(data) {
  var parts = [];
  if (data.twitter) parts.push('<a href="' + data.twitter + '">X</a>');
  if (data.website) parts.push('<a href="' + data.website + '">Web</a>');
  if (data.telegram) parts.push('<a href="' + data.telegram + '">TG</a>');
  return parts.length > 0 ? parts.join(' | ') : 'None';
}

function buildText(ca, data, header) {
  var dex = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  var age = formatAge(data.createdAt);
  return header +
    '<a href="https://pump.fun/coin/' + ca + '"><b>$' + data.ticker + '</b></a> — ' + data.name + '\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: ' + data.mc + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '├ Age: ' + age + '\n' +
    '└ Dex: ' + dex + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials;
}

function buildAlertText(ca, data, solAmount, claimNum) {
  var dex = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  var age = formatAge(data.createdAt);
  var tier = getClaimTier(solAmount);
  var amtLine = '💰 <b>' + (solAmount ? solAmount + ' SOL claimed' : 'Amount unknown') + '</b>\n';
  var claimLine = claimNum > 1 ? '📍 Claim #' + claimNum + '\n' : '';
  return '🚨 <b>FEE CLAIM ALERT</b>\n\n' +
    tier + amtLine + claimLine + '\n' +
    '<a href="https://pump.fun/coin/' + ca + '"><b>$' + data.ticker + '</b></a> — ' + data.name + '\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: ' + data.mc + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '├ Age: ' + age + '\n' +
    '└ Dex: ' + dex + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials;
}

function buildKeyboard(ca, sig) {
  var keyboard = [
    [
      {text: 'AXI', url: 'https://axiom.trade/t/' + ca},
      {text: 'TRO', url: 'https://t.me/solana_trojanbot?start=' + ca},
      {text: 'BLO', url: 'https://t.me/BloomSolana_bot?start=' + ca},
      {text: 'PHO', url: 'https://photon-sol.tinyastro.io/en/lp/' + ca}
    ],
    [
      {text: 'OKX', url: 'https://www.okx.com/web3/dex-swap#inputChain=501&inputCurrency=SOL&outputChain=501&outputCurrency=' + ca},
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
  var item = messageQueue.shift();
  var promise;

  if (item.type === 'photo') {
    promise = bot.sendPhoto(item.chatId, item.pfp, {
      caption: item.text,
      parse_mode: 'HTML',
      reply_markup: item.markup
    }).catch(function(err) {
      console.log('[Queue] Photo failed: ' + err.message + ' — text fallback');
      return bot.sendMessage(item.chatId, item.text, {
        parse_mode: 'HTML',
        reply_markup: item.markup,
        disable_web_page_preview: true
      });
    });
  } else {
    promise = bot.sendMessage(item.chatId, item.text, {
      parse_mode: 'HTML',
      reply_markup: item.markup,
      disable_web_page_preview: true
    });
  }

  promise
    .catch(function(e) { console.log('[Queue] Error: ' + e.message); })
    .then(function() {
      isProcessing = false;
      setTimeout(processQueue, 150);
    });
}

function queueCard(chatId, ca, data, text, sig) {
  if (messageQueue.length >= QUEUE_MAX) messageQueue.shift();
  var markup = buildKeyboard(ca, sig);
  messageQueue.push(data.pfp
    ? {type: 'photo', chatId: chatId, pfp: data.pfp, text: text, markup: markup}
    : {type: 'text', chatId: chatId, text: text, markup: markup}
  );
  processQueue();
}

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id,
   '<b>VoilaClaimBot</b> 🚨\n\n' +
    'Get instant alerts when fees are claimed on any Pump.fun token.\n\n' +
    '<b>How to use:</b>\n' +
    '1. Paste any Pump.fun token CA\n' +
    '2. Bot tracks it 24/7\n' +
    '3. Get pinged the moment fees are claimed\n\n' +
    '<b>Commands:</b>\n' +
    '/track &lt;CA&gt; — track a token\n' +
    '/list — see tracked tokens\n' +
    '/help — how to use',
    {parse_mode: 'HTML'}
  );
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id,
    '<b>How to use VoilaClaimBot:</b>\n\n' +
    '• Paste any Pump.fun CA directly in chat\n' +
    '• Or use /track &lt;CA&gt;\n' +
    '• Use /list to see what you\'re tracking\n' +
    '• Tap ❌ Remove to stop tracking\n' +
    '• Tap 🔄 Refresh to update stats\n\n' +
    '<b>Claim tiers:</b>\n' +
    '🚨 Strong — 5+ SOL\n' +
    '⚠️ Medium — 2 to 5 SOL\n' +
    '💤 Weak — under 2 SOL\n\n' +
    '<b>Max 10 tokens per user.</b>\n\n' +
    '<i>Tracked tokens reset on bot restart.</i>',
    {parse_mode: 'HTML'}
  );
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) {
    return bot.sendMessage(msg.chat.id, 'You\'re not tracking any tokens yet.\n\nPaste a Pump.fun CA to start.');
  }
  bot.sendMessage(msg.chat.id, '<b>Tracked tokens (' + tokens.length + '/10):</b>', {parse_mode: 'HTML'});
  tokens.forEach(function(t) {
    var claims = claimsCount[t.mint] ? ' · ' + claimsCount[t.mint] + ' claim(s)' : '';
    var text = '<a href="https://pump.fun/coin/' + t.mint + '"><b>$' + t.ticker + '</b></a>' +
      claims + '\n<code>' + t.mint + '</code>';
    var btns = {inline_keyboard: [[{text: '❌ Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML', reply_markup: btns, disable_web_page_preview: true});
  });
});

bot.on('callback_query', function(query) {
  var uid = String(query.message.chat.id);
  var data = query.data;
  var chatId = query.message.chat.id;
  var msgId = query.message.message_id;

  if (data.startsWith('remove:')) {
    var ca = data.replace('remove:', '');
    if (users[uid]) users[uid] = users[uid].filter(function(t) { return t.mint !== ca; });
    var stillTracked = Object.keys(users).some(function(u) {
      return users[u] && users[u].find(function(t) { return t.mint === ca; });
    });
    if (!stillTracked) {
      if (subscriptions[ca] !== undefined) {
        globalConn.removeOnLogsListener(subscriptions[ca]).catch(function() {});
        delete subscriptions[ca];
      }
      delete watchingMints[ca];
      delete claimsCount[ca];
      delete lastSig[ca];
      delete recentAlerts[ca];
      delete tokenCache[ca];
    }
    bot.answerCallbackQuery(query.id, {text: '✅ Removed!'});
    bot.editMessageReplyMarkup({inline_keyboard: []}, {chat_id: chatId, message_id: msgId}).catch(function() {});
    return;
  }

  if (data.startsWith('refresh:')) {
    var ca = data.replace('refresh:', '');
    bot.answerCallbackQuery(query.id, {text: '🔄 Refreshing...'});
    tokenCache[ca] = null;

    getCachedTokenData(ca).then(function(tokenData) {
      if (!tokenData) return;
      var text = buildText(ca, tokenData, '🔄 <b>Refreshed</b>\n\n');
      var markup = buildKeyboard(ca, null);

      bot.editMessageCaption(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        reply_markup: markup
      }).catch(function() {
        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          reply_markup: markup,
          disable_web_page_preview: true
        });
      }).catch(function(err) {
        console.log('[Refresh] Edit failed: ' + err.message);
        queueCard(chatId, ca, tokenData, text, null);
      });
    }).catch(function(e) { console.log('[Refresh] Error: ' + e.message); });
  }
});

function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) {
    return bot.sendMessage(chatId, '⚠️ You\'ve hit the 10 token limit.\n\nUse /list and tap ❌ Remove to free up a slot.');
  }
  if (users[uid].find(function(t) { return t.mint === ca; })) {
    return bot.sendMessage(chatId, '⚠️ Already tracking this token.');
  }
  bot.sendMessage(chatId, '🔍 Looking up token...');
  getCachedTokenData(ca).then(function(data) {
    if (!data) return bot.sendMessage(chatId, '❌ Could not find token. Check the CA and try again.');
    users[uid].push({mint: ca, ticker: data.ticker});
    startWatching(ca, data.ticker);
    var text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
  }).catch(function(e) {
    console.log('[Track] Error: ' + e.message);
    bot.sendMessage(chatId, '❌ Could not find token. Check the CA and try again.');
  });
}

bot.onText(/\/track (.+)/, function(msg, match) {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

bot.on('message', function(msg) {
  var text = msg.text || '';
  if (text.startsWith('/')) return;
  var ca = text.trim();
  if (ca.length >= 32 && ca.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(ca)) {
    trackToken(String(msg.chat.id), ca, msg.chat.id);
  }
});

function startWatching(mint, ticker) {
  if (watchingMints[mint]) return;
  watchingMints[mint] = true;

  // WebSocket subscription
  try {
    var pub = new web3.PublicKey(mint);
    var subId = globalConn.onLogs(pub, function(logs) {
      if (logs.err) return;
      var isClaim = logs.logs.some(function(l) { return l && l.includes('CollectCreatorFee'); });
      if (!isClaim) return;
      if (lastSig[mint] === logs.signature) return;
      lastSig[mint] = logs.signature;
      claimsCount[mint] = (claimsCount[mint] || 0) + 1;
      console.log('[WS Claim] mint:' + mint + ' #' + claimsCount[mint]);
      fireAlert(mint, ticker, logs.signature, claimsCount[mint]);
    }, 'confirmed');
    subscriptions[mint] = subId;
  } catch(e) {
    console.log('[Watch] WS error: ' + e.message);
  }

  // Immediate first poll to initialize lastSig
  pollMint(mint, ticker);
}

function fireAlert(mint, ticker, sig, claimNum) {
  if (recentAlerts[mint] === sig) return;
  recentAlerts[mint] = sig;
  tokenCache[mint] = null;
  Promise.all([getCachedTokenData(mint), getClaimedAmount(sig)])
    .then(function(results) {
      var data = results[0];
      var solAmount = results[1];
      if (!data) return;
      var text = buildAlertText(mint, data, solAmount, claimNum);
      Object.keys(users).forEach(function(uid) {
        if (users[uid] && users[uid].find(function(t) { return t.mint === mint; })) {
          queueCard(uid, mint, data, text, sig);
        }
      });
    })
    .catch(function(e) { console.log('[Alert] Error: ' + e.message); });
}

console.log('[Bot] Started');