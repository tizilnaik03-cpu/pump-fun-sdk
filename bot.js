var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};

function clean(str) {
  if (!str) return '';
  return str.replace(/[<>&"]/g, function(c) {
    return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];
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

    var ticker = clean((pump && pump.symbol) || (pair && pair.baseToken.symbol) || 'UNKNOWN');
    var name = clean((pump && pump.name) || (pair && pair.baseToken.name) || ticker);

    // pump.fun is primary for PFP
    var pfp = null;
    if (pump && pump.image_uri) {
      pfp = pump.image_uri;
    } else if (pair && pair.info && pair.info.imageUrl) {
      pfp = pair.info.imageUrl;
    }

    var mc = pair ? formatNum(pair.fdv) : 'N/A';
    var vol = pair ? formatNum(pair.volume && pair.volume.h24) : 'N/A';
    var dexPaid = pair && pair.boosts && pair.boosts.active ? true : false;

    // pump.fun is primary for socials
    var twitter = (pump && pump.twitter) || null;
    var website = (pump && pump.website) || null;
    var telegram = (pump && pump.telegram) || null;

    // DexScreener as fallback for socials
    if (!twitter && pair && pair.info && pair.info.socials) {
      pair.info.socials.forEach(function(s) {
        if (s.type === 'twitter') twitter = s.url;
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

function buildLinks(ca, sig) {
  var row1 = '<a href="https://gmgn.ai/sol/token/' + ca + '">GM</a>' +
    ' | <a href="https://axiom.trade/t/' + ca + '">AXI</a>' +
    ' | <a href="https://t.me/solana_trojanbot?start=' + ca + '">TRO</a>' +
    ' | <a href="https://t.me/BloomSolana_bot?start=' + ca + '">BLO</a>';
  var row2 = '<a href="https://www.okx.com/web3/dex-swap#inputChain=501&inputCurrency=SOL&outputChain=501&outputCurrency=' + ca + '">OKX</a>' +
    ' | <a href="https://bullx.io/terminal?chainId=1399811149&address=' + ca + '">NEO</a>' +
    ' | <a href="https://photon-sol.tinyastro.io/en/lp/' + ca + '">PHO</a>' +
    ' | <a href="https://padre.trade/token/' + ca + '">TRM</a>';
  if (sig) return row1 + '\n' + row2 + '\n<a href="https://solscan.io/tx/' + sig + '">Solscan</a>';
  return row1 + '\n' + row2;
}

function buildSocials(data) {
  var parts = [];
  if (data.twitter) parts.push('<a href="' + data.twitter + '">X</a>');
  if (data.website) parts.push('<a href="' + data.website + '">Web</a>');
  if (data.telegram) parts.push('<a href="' + data.telegram + '">TG</a>');
  return parts.length > 0 ? parts.join(' | ') : 'None';
}

function buildText(ca, data, isAlert, sig) {
  var dex = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  var links = buildLinks(ca, sig);
  var header = isAlert ? '🚨 <b>FEE CLAIM ALERT</b>\n\n' : '✅ <b>Now Tracking</b>\n\n';

  return header +
    '<b>' + data.name + '</b> ($' + data.ticker + ')\n' +
    '<code>' + ca + '</code>\n\n' +
    '📊 <b>Stats</b>\n' +
    '├ MC: ' + data.mc + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '└ Dex: ' + dex + '\n\n' +
    '🔗 <b>Socials</b>\n' +
    '└ ' + socials + '\n\n' +
    links;
}

function getRefreshMarkup(ca) {
  return {inline_keyboard: [[{text: '🔄', callback_data: 'refresh:' + ca}]]};
}

function sendCard(chatId, ca, data, isAlert, sig) {
  var text = buildText(ca, data, isAlert, sig);
  var markup = getRefreshMarkup(ca);

  if (data.pfp) {
    // Send image first, then text card below
    bot.sendPhoto(chatId, data.pfp, {disable_notification: true})
      .then(function() {
        bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: markup,
          disable_web_page_preview: true
        });
      })
      .catch(function() {
        bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: markup,
          disable_web_page_preview: true
        });
      });
  } else {
    bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: markup,
      disable_web_page_preview: true
    });
  }
}

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id, '<b>PumpFee Bot is live!</b>\n\nPaste any Pump.fun CA to track it.\n\nCommands:\n/track CA\n/list\n/help', {parse_mode: 'HTML'});
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Paste any Pump.fun CA to track fee claims.\n\nMax 10 tokens per user.');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked. Paste a CA to start.');
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
    if (users[uid]) {
      users[uid] = users[uid].filter(function(t) { return t.mint !== ca; });
    }
    bot.answerCallbackQuery(query.id, {text: 'Removed!'});
    bot.editMessageReplyMarkup({inline_keyboard: []}, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
  }

  if (data.startsWith('refresh:')) {
    var ca = data.replace('refresh:', '');
    bot.answerCallbackQuery(query.id, {text: 'Refreshing...'});
    getTokenData(ca).then(function(tokenData) {
      if (!tokenData) return;
      var dex = tokenData.dexPaid ? '🟢' : '🔴';
      var oldText = query.message.text || '';
      var newText = oldText
        .replace(/MC: [^\n]+/, 'MC: ' + tokenData.mc)
        .replace(/Vol: [^\n]+/, 'Vol: ' + tokenData.vol)
        .replace(/Dex: [🟢🔴]/, 'Dex: ' + dex);
      bot.editMessageText(newText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getRefreshMarkup(ca),
        disable_web_page_preview: true
      }).catch(function(e) { console.log('Refresh error: ' + e.message); });
    });
  }
});

function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(chatId, 'Hit 10 token limit. Remove one first.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(chatId, 'Already tracking.');

  bot.sendMessage(chatId, 'Looking up token...');

  getTokenData(ca).then(function(data) {
    if (!data) return bot.sendMessage(chatId, 'Could not find token. Check CA and try again.');
    users[uid].push({mint: ca, ticker: data.ticker});
    startWatching(ca, data.ticker);
    sendCard(chatId, ca, data, false, null);
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
  try {
    var pub = new web3.PublicKey(mint);
    var conn = new web3.Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY, 'confirmed');
    conn.onLogs(pub, function(logs) {
      if (logs.err) return;
      var claim = logs.logs.some(function(l) {
        return l.includes('collectCreatorFee') || l.includes('claim');
      });
      if (claim) fireAlert(mint, ticker, logs.signature);
    }, 'confirmed');
  } catch(e) { console.log('Watch error: ' + e.message); }
}

function fireAlert(mint, ticker, sig) {
  getTokenData(mint).then(function(data) {
    if (!data) return;
    Object.keys(users).forEach(function(uid) {
      if (users[uid].find(function(t) { return t.mint === mint; })) {
        sendCard(uid, mint, data, true, sig);
      }
    });
  });
}

console.log('Bot started');