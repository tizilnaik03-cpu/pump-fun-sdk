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

function clean(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, function(c) {
    return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];
  });
}

function getCachedTokenData(ca) {
  if (tokenCache[ca] && Date.now() - tokenCache[ca].timestamp < CACHE_TTL) {
    console.log('Cache hit for ' + ca);
    return Promise.resolve(tokenCache[ca].data);
  }
  return getTokenData(ca).then(function(data) {
    if (data) tokenCache[ca] = {data: data, timestamp: Date.now()};
    return data;
  });
}

function getTokenData(ca) {
  var dexReq = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });

  var pumpReq = fetch('https://frontend-api.pump.fun/coins/' + ca)
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });

  return Promise.all([dexReq, pumpReq]).then(function(results) {
    var dex = results[0];
    var pump = results[1];
    var pair = dex && dex.pairs && dex.pairs[0] ? dex.pairs[0] : null;

    if (pair) {
      console.log('FULL PAIR:', JSON.stringify({
        boosts: pair.boosts,
        profile: pair.profile,
        labels: pair.labels,
        info: pair.info ? {imageUrl: pair.info.imageUrl} : null
      }));
    }

    var ticker = clean((pump && pump.symbol) || (pair && pair.baseToken && pair.baseToken.symbol) || 'UNKNOWN');
    var name = clean((pump && pump.name) || (pair && pair.baseToken && pair.baseToken.name) || ticker);

    var pfp = null;
    if (pump && pump.image_uri) pfp = pump.image_uri;
    else if (pair && pair.info && pair.info.imageUrl) pfp = pair.info.imageUrl;

    var mc = pair ? formatNum(pair.fdv) : 'N/A';
    var vol = pair ? formatNum(pair.volume && pair.volume.h24) : 'N/A';

    var dexPaid = false;
    if (pair) {
      if (pair.boosts && pair.boosts.active && pair.boosts.active > 0) { dexPaid = true; console.log('DEX PAID via boosts'); }
      else if (pair.profile && pair.profile.header) { dexPaid = true; console.log('DEX PAID via profile'); }
      else if (pair.labels && pair.labels.length > 0) { dexPaid = true; console.log('DEX PAID via labels:', pair.labels); }
    }
    console.log('dexPaid result:', dexPaid);

    var twitter = (pump && pump.twitter) || null;
    var website = (pump && pump.website) || null;
    var telegram = (pump && pump.telegram) || null;

    if (pair && pair.info && pair.info.socials) {
      pair.info.socials.forEach(function(s) {
        if (s.type === 'twitter' && !twitter) twitter = s.url;
        if (s.type === 'telegram' && !telegram) telegram = s.url;
      });
    }
    if (!website && pair && pair.info && pair.info.websites && pair.info.websites[0]) {
      website = pair.info.websites[0].url;
    }

    return { ticker, name, pfp, mc, vol, dexPaid, website, twitter, telegram };
  });
}

function formatNum(num) {
  if (!num) return 'N/A';
  if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
  return '$' + num.toFixed(0);
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
  return header +
    '<b>' + data.name + '</b> ($' + data.ticker + ')\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: ' + data.mc + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '└ Dex: ' + dex + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials;
}

function buildKeyboard(ca, sig) {
  var keyboard = [
    [
      {text: 'GM', url: 'https://gmgn.ai/sol/token/' + ca},
      {text: 'AXI', url: 'https://axiom.trade/t/' + ca},
      {text: 'TRO', url: 'https://t.me/solana_trojanbot?start=' + ca},
      {text: 'BLO', url: 'https://t.me/BloomSolana_bot?start=' + ca}
    ],
    [
      {text: 'OKX', url: 'https://www.okx.com/web3/dex-swap#inputChain=501&inputCurrency=SOL&outputChain=501&outputCurrency=' + ca},
      {text: 'NEO', url: 'https://bullx.io/terminal?chainId=1399811149&address=' + ca},
      {text: 'PHO', url: 'https://photon-sol.tinyastro.io/en/lp/' + ca},
      {text: 'TRM', url: 'https://padre.trade/token/' + ca}
    ],
    [{text: '🔄 Refresh', callback_data: 'refresh:' + ca}]
  ];
  if (sig) keyboard[1].push({text: 'Solscan', url: 'https://solscan.io/tx/' + sig});
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
    }).catch(function() {
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
  promise.catch(function(e) { console.log('Queue error: ' + e.message); })
    .then(function() {
      isProcessing = false;
      setTimeout(processQueue, 100);
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
  bot.sendMessage(msg.chat.id, '<b>PumpFee Alert Bot</b>\n\nPaste any Pump.fun CA to track fee claims.\n\nCommands:\n/track CA\n/list\n/help', {parse_mode: 'HTML'});
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Paste any Pump.fun CA to track fee claims.\n\nMax 10 tokens per user.\n\n/list - see tracked tokens');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  console.log('LIST - uid: ' + uid + ' tokens: ' + JSON.stringify(tokens));
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked. Paste a CA to start.\n\n(Note: tracked tokens reset on bot restart. Re-add your tokens.)');
  tokens.forEach(function(t) {
    var text = '<b>$' + t.ticker + '</b>\n<code>' + t.mint + '</code>';
    var btns = {inline_keyboard: [[{text: '❌ Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML', reply_markup: btns});
  });
});

bot.on('callback_query', function(query) {
  var uid = String(query.message.chat.id);
  var data = query.data;

  if (data.startsWith('remove:')) {
    var ca = data.replace('remove:', '');
    if (users[uid]) users[uid] = users[uid].filter(function(t) { return t.mint !== ca; });
    bot.answerCallbackQuery(query.id, {text: 'Removed!'});
    bot.editMessageReplyMarkup({inline_keyboard: []}, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
  }

  if (data.startsWith('refresh:')) {
    var ca = data.replace('refresh:', '');
    bot.answerCallbackQuery(query.id, {text: 'Refreshing...'});
    tokenCache[ca] = null;
    getCachedTokenData(ca).then(function(tokenData) {
      if (!tokenData) return;
      var text = buildText(ca, tokenData, '🔄 <b>Refreshed</b>\n\n');
      var markup = buildKeyboard(ca, null);
      if (query.message.photo) {
        bot.editMessageCaption(text, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: markup
        }).catch(function() {
          queueCard(query.message.chat.id, ca, tokenData, text, null);
        });
      } else {
        bot.editMessageText(text, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: markup,
          disable_web_page_preview: true
        }).catch(function() {
          queueCard(query.message.chat.id, ca, tokenData, text, null);
        });
      }
    }).catch(function(e) { console.log('Refresh error: ' + e.message); });
  }
});

function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(chatId, 'Hit 10 token limit. Remove one first.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(chatId, 'Already tracking.');
  bot.sendMessage(chatId, 'Looking up token...');
  getCachedTokenData(ca).then(function(data) {
    if (!data) return bot.sendMessage(chatId, 'Could not find token. Check CA and try again.');
    users[uid].push({mint: ca, ticker: data.ticker});
    console.log('Tracking added - uid: ' + uid + ' total: ' + users[uid].length);
    startWatching(ca, data.ticker);
    var text = buildText(ca, data, '✅ <b>Now Tracking</b>\n\n');
    queueCard(chatId, ca, data, text, null);
  }).catch(function(e) {
    console.log('Track error: ' + e.message);
    bot.sendMessage(chatId, 'Could not find token. Check CA and try again.');
  });
}

bot.onText(/\/track (.+)/, function(msg, match) {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

bot.on('message', function(msg) {
  var text = msg.text || '';
  if (text.startsWith('/')) return;
  var ca = text.trim();
  if (ca.length > 30 && !ca.includes(' ')) {
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
        console.log('REAL CLAIM for ' + mint + ' sig: ' + logs.signature);
        fireAlert(mint, ticker, logs.signature);
      }
    }, 'confirmed');
  } catch(e) { console.log('Watch error: ' + e.message); }
}

function fireAlert(mint, ticker, sig) {
  if (recentAlerts[mint] && Date.now() - recentAlerts[mint] < ALERT_COOLDOWN) {
    console.log('Alert cooldown for ' + mint);
    return;
  }
  recentAlerts[mint] = Date.now();
  tokenCache[mint] = null;
  getCachedTokenData(mint).then(function(data) {
    if (!data) return;
    var text = buildText(mint, data, '🚨 <b>FEE CLAIM ALERT</b>\n\n');
    Object.keys(users).forEach(function(uid) {
      if (users[uid].find(function(t) { return t.mint === mint; })) {
        queueCard(uid, mint, data, text, sig);
      }
    });
  });
}

console.log('Bot started');