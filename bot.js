var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;
var CACHE_TTL = 5 * 60 * 1000;
var ALERT_COOLDOWN = 60000;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};
var watchingMints = {};
var tokenCache = {};
var recentAlerts = {};
var messageQueue = [];
var isProcessing = false;
var globalConn = new web3.Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY, 'confirmed');

bot.setMyCommands([
  {command: 'start', description: 'Start the bot'},
  {command: 'track', description: 'Track a token - /track <CA>'},
  {command: 'list', description: 'See your tracked tokens'},
  {command: 'help', description: 'How to use this bot'}
]);

function clean(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, function(c) {
    return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];
  });
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
    if (maxChange > 0) return (maxChange / 1e9).toFixed(4);
    return null;
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

// Normalize IPFS/CF-IPFS URLs to a format Telegram accepts
function normalizeImageUrl(url) {
  if (!url) return null;
  // Convert IPFS URIs
  if (url.startsWith('ipfs://')) {
    return 'https://ipfs.io/ipfs/' + url.slice(7);
  }
  // Some pump.fun images use CF-IPFS — keep as-is, they usually work
  // But reject obviously broken URLs
  if (!url.startsWith('http')) return null;
  return url;
}

function getTokenData(ca) {
  var pumpReq = fetch('https://frontend-api.pump.fun/coins/' + ca)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  var dexReq = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  // Also hit DexScreener's token-info endpoint for paid status — more reliable
  var dexInfoReq = fetch('https://api.dexscreener.com/token-boosts/top/v1')
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  return Promise.all([pumpReq, dexReq]).then(function(results) {
    var pump = results[0];
    var dex = results[1];
    var pair = dex && dex.pairs && dex.pairs.length > 0 ? dex.pairs[0] : null;

    // --- TICKER / NAME ---
    // pump.fun is always primary. Check both top-level and metadata fields.
    var rawTicker = (pump && (pump.symbol || (pump.metadata && pump.metadata.symbol))) ||
                    (pair && pair.baseToken && pair.baseToken.symbol) || null;
    var rawName   = (pump && (pump.name   || (pump.metadata && pump.metadata.name)))   ||
                    (pair && pair.baseToken && pair.baseToken.name)   || rawTicker || 'Unknown';

    var ticker = clean(rawTicker || 'UNKNOWN');
    var name   = clean(rawName);

    // --- PFP ---
    // Priority: pump.fun image_uri → pump metadata image → dex imageUrl
    var rawPfp = (pump && (pump.image_uri || (pump.metadata && pump.metadata.image))) ||
                 (pair && pair.info && pair.info.imageUrl) || null;
    var pfp = normalizeImageUrl(rawPfp);

    // --- MARKET DATA ---
    var mc  = pair ? formatNum(pair.fdv)                    : 'N/A';
    var vol = pair ? formatNum(pair.volume && pair.volume.h24) : 'N/A';

    // --- DEX PAID ---
    // Check ANY of: active boosts, profile header, OR paid labels
    // Do NOT require everything at once — that causes false negatives
    var dexPaid = false;
    if (pair) {
      if (pair.boosts && pair.boosts.active > 0)              dexPaid = true;
      if (!dexPaid && pair.profile && pair.profile.header)    dexPaid = true;
      if (!dexPaid && pair.labels && pair.labels.some(function(l) {
        return l === 'ads' || l === 'promoted' || l === 'trending';
      }))                                                      dexPaid = true;
      // If pair.info has both imageUrl AND (socials OR websites) — likely paid
      if (!dexPaid && pair.info && pair.info.imageUrl &&
          ((pair.info.socials && pair.info.socials.length > 0) ||
           (pair.info.websites && pair.info.websites.length > 0))) {
        dexPaid = true;
      }
    }

    // --- SOCIALS ---
    // pump.fun is primary source — always available regardless of dex paid status
    var twitter  = (pump && pump.twitter)  || null;
    var website  = (pump && pump.website)  || null;
    var telegram = (pump && pump.telegram) || null;

    // DexScreener as fallback only
    if (pair && pair.info) {
      if (pair.info.socials) {
        pair.info.socials.forEach(function(s) {
          if (s.type === 'twitter'  && !twitter)  twitter  = s.url;
          if (s.type === 'telegram' && !telegram) telegram = s.url;
        });
      }
      if (!website && pair.info.websites && pair.info.websites[0]) {
        website = pair.info.websites[0].url;
      }
    }

    console.log('[Token]', ticker, '| dexPaid:', dexPaid, '| pfp:', !!pfp, '| twitter:', !!twitter, '| pair:', !!pair);

    return { ticker, name, pfp, mc, vol, dexPaid, website, twitter, telegram };
  });
}

function formatNum(num) {
  if (!num) return 'N/A';
  if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000)    return '$' + (num / 1000).toFixed(1)    + 'K';
  return '$' + num.toFixed(0);
}

function buildSocials(data) {
  var parts = [];
  if (data.twitter)  parts.push('<a href="' + data.twitter  + '">X</a>');
  if (data.website)  parts.push('<a href="' + data.website  + '">Web</a>');
  if (data.telegram) parts.push('<a href="' + data.telegram + '">TG</a>');
  return parts.length > 0 ? parts.join(' | ') : 'None';
}

function buildText(ca, data, header) {
  var dex     = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  return header +
    '<a href="https://pump.fun/coin/' + ca + '"><b>$' + data.ticker + '</b></a> — ' + data.name + '\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: '  + data.mc  + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '└ Dex: ' + dex      + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials;
}

function buildAlertText(ca, data, solAmount) {
  var dex     = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  var amountLine = solAmount ? '💰 <b>' + solAmount + ' SOL claimed</b>\n\n' : '';
  return '🚨 <b>FEE CLAIM ALERT</b>\n\n' +
    amountLine +
    '<a href="https://pump.fun/coin/' + ca + '"><b>$' + data.ticker + '</b></a> — ' + data.name + '\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: '  + data.mc  + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '└ Dex: ' + dex      + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials;
}

function buildKeyboard(ca, sig) {
  var keyboard = [
    [
      {text: 'AXI', url: 'https://axiom.trade/t/'      + ca},
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
      // Photo failed (bad URL, Telegram can't fetch it) — fall back to text
      console.log('Photo send failed, falling back to text. URL:', item.pfp, '| Error:', err.message);
      return bot.sendMessage(item.chatId, item.text, {
        parse_mode: 'HTML',
        reply_markup: item.markup,
        disable_web_page_preview: false  // allow link preview to show PFP via pump.fun link
      });
    });
  } else {
    promise = bot.sendMessage(item.chatId, item.text, {
      parse_mode: 'HTML',
      reply_markup: item.markup,
      disable_web_page_preview: false
    });
  }
  promise.catch(function(e) { console.log('Queue error: ' + e.message); })
    .then(function() {
      isProcessing = false;
      setTimeout(processQueue, 150);
    });
}

function queueCard(chatId, ca, data, text, sig) {
  var markup = buildKeyboard(ca, sig);
  if (data.pfp) {
    messageQueue.push({type: 'photo', chatId: chatId, pfp: data.pfp, text: text, markup: markup});
  } else {
    messageQueue.push({type: 'text', chatId: chatId, text: text, markup: markup});
  }
  processQueue();
}

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id,
    '<b>PumpFee Alert Bot</b> 🚨\n\n' +
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
    '<b>How to use PumpFee Bot:</b>\n\n' +
    '• Paste any Pump.fun CA directly in chat\n' +
    '• Or type /track followed by the CA\n' +
    '• Use /list to see what you\'re tracking\n' +
    '• Tap ❌ Remove to untrack a token\n' +
    '• Tap 🔄 Refresh to update MC and Dex status\n\n' +
    '<b>Max 10 tokens per user.</b>\n\n' +
    '<i>Note: Tracked tokens reset on bot restart. Re-add after any downtime.</i>',
    {parse_mode: 'HTML'}
  );
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) {
    return bot.sendMessage(msg.chat.id, 'You\'re not tracking any tokens yet.\n\nPaste a Pump.fun CA to start tracking.');
  }
  bot.sendMessage(msg.chat.id, '<b>Tracked tokens (' + tokens.length + '/10):</b>', {parse_mode: 'HTML'});
  tokens.forEach(function(t) {
    var text = '<a href="https://pump.fun/coin/' + t.mint + '"><b>$' + t.ticker + '</b></a>\n<code>' + t.mint + '</code>';
    var btns = {inline_keyboard: [[{text: '❌ Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML', reply_markup: btns, disable_web_page_preview: true});
  });
});

bot.on('callback_query', function(query) {
  var uid = String(query.message.chat.id);
  var data = query.data;

  if (data.startsWith('remove:')) {
    var ca = data.replace('remove:', '');
    if (users[uid]) users[uid] = users[uid].filter(function(t) { return t.mint !== ca; });
    bot.answerCallbackQuery(query.id, {text: '✅ Removed!'});
    bot.editMessageReplyMarkup({inline_keyboard: []}, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
    return;
  }

  if (data.startsWith('refresh:')) {
    var ca = data.replace('refresh:', '');
    bot.answerCallbackQuery(query.id, {text: '🔄 Refreshing...'});
    // Clear cache so we fetch fresh data
    tokenCache[ca] = null;
    // Edit the existing message to show "refreshing" instead of sending a new one
    bot.editMessageCaption
      ? bot.editMessageCaption('⏳ Refreshing...', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML'
        }).catch(function() {
          // Message might be text (no caption) — try editMessageText
          bot.editMessageText('⏳ Refreshing...', {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'HTML'
          }).catch(function() {});
        })
      : null;

    getCachedTokenData(ca).then(function(tokenData) {
      if (!tokenData) return;
      var text = buildText(ca, tokenData, '🔄 <b>Refreshed</b>\n\n');
      var markup = buildKeyboard(ca, null);

      if (tokenData.pfp) {
        // Has photo — delete old and send new photo card
        bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(function() {});
        bot.sendPhoto(query.message.chat.id, tokenData.pfp, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: markup
        }).catch(function() {
          bot.sendMessage(query.message.chat.id, text, {
            parse_mode: 'HTML',
            reply_markup: markup,
            disable_web_page_preview: false
          });
        });
      } else {
        // No photo — try to edit in place, fall back to delete+send
        bot.editMessageText(text, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: markup,
          disable_web_page_preview: false
        }).catch(function() {
          bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(function() {});
          bot.sendMessage(query.message.chat.id, text, {
            parse_mode: 'HTML',
            reply_markup: markup,
            disable_web_page_preview: false
          });
        });
      }
    }).catch(function(e) { console.log('Refresh error: ' + e.message); });
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
    console.log('Track error: ' + e.message);
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
  // Solana addresses are base58, 32-44 chars, no spaces
  if (ca.length >= 32 && ca.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(ca)) {
    trackToken(String(msg.chat.id), ca, msg.chat.id);
  }
});

function startWatching(mint, ticker) {
  if (watchingMints[mint]) return;
  watchingMints[mint] = true;
  try {
    var pub = new web3.PublicKey(mint);
    globalConn.onLogs(pub, function(logs) {
      if (logs.err) return;
      var isRealClaim = logs.logs.some(function(l) {
        return l && l.includes('CollectCreatorFee');
      });
      if (isRealClaim) {
        console.log('CLAIM DETECTED mint:' + mint + ' sig:' + logs.signature);
        fireAlert(mint, ticker, logs.signature);
      }
    }, 'confirmed');
  } catch(e) { console.log('Watch error: ' + e.message); }
}

function fireAlert(mint, ticker, sig) {
  if (recentAlerts[mint] && Date.now() - recentAlerts[mint] < ALERT_COOLDOWN) {
    console.log('Cooldown active for ' + mint);
    return;
  }
  recentAlerts[mint] = Date.now();
  tokenCache[mint] = null;
  Promise.all([getCachedTokenData(mint), getClaimedAmount(sig)])
    .then(function(results) {
      var data = results[0];
      var solAmount = results[1];
      if (!data) return;
      var text = buildAlertText(mint, data, solAmount);
      Object.keys(users).forEach(function(uid) {
        if (users[uid].find(function(t) { return t.mint === mint; })) {
          queueCard(uid, mint, data, text, sig);
        }
      });
    });
}

console.log('Bot started');