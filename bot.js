var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};

function getTokenData(ca) {
  var pumpData = fetch('https://frontend-api.pump.fun/coins/' + ca)
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });

  var dexData = fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });

  return Promise.all([pumpData, dexData]).then(function(results) {
    var pump = results[0];
    var dex = results[1];
    var pair = dex && dex.pairs && dex.pairs[0] ? dex.pairs[0] : null;

    var ticker = (pump && pump.symbol) ? pump.symbol : (pair ? pair.baseToken.symbol : 'UNKNOWN');
    var pfp = (pump && pump.image_uri) ? pump.image_uri : null;
    var mc = pair ? formatNum(pair.fdv) : 'N/A';
    var vol = pair ? formatNum(pair.volume && pair.volume.h24) : 'N/A';
    var dexPaid = pair && pair.boosts ? true : false;
    var website = (pump && pump.website) ? pump.website : null;
    var twitter = (pump && pump.twitter) ? pump.twitter : null;
    var telegram = (pump && pump.telegram) ? pump.telegram : null;

    return { ticker, pfp, mc, vol, dexPaid, website, twitter, telegram };
  });
}

function formatNum(num) {
  if (!num) return 'N/A';
  if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
  return '$' + num.toFixed(0);
}

function buildLinks(ca, sig) {
  var row1 = '[GM](https://gmgn.ai/sol/token/' + ca + ')' +
    ' • [AXI](https://axiom.trade/t/' + ca + ')' +
    ' • [TRO](https://t.me/solana_trojanbot?start=' + ca + ')' +
    ' • [BLO](https://t.me/BloomSolana_bot?start=' + ca + ')';
  var row2 = '[OKX](https://www.okx.com/web3/dex-swap#inputChain=501&inputCurrency=SOL&outputChain=501&outputCurrency=' + ca + ')' +
    ' • [NEO](https://bullx.io/terminal?chainId=1399811149&address=' + ca + ')' +
    ' • [PHO](https://photon-sol.tinyastro.io/en/lp/' + ca + ')' +
    ' • [TRM](https://padre.trade/token/' + ca + ')';
  var row3 = '[Solscan](https://solscan.io/tx/' + (sig || '') + ')';
  return row1 + '\n' + row2 + (sig ? '\n' + row3 : '');
}

function buildSocials(data) {
  var parts = [];
  if (data.twitter) parts.push('[X](' + data.twitter + ')');
  if (data.website) parts.push('[Web](' + data.website + ')');
  if (data.telegram) parts.push('[TG](' + data.telegram + ')');
  return parts.length > 0 ? parts.join(' • ') : 'None';
}

function buildText(ca, data, isAlert, sig) {
  var dex = data.dexPaid ? '🟢' : '🔴';
  var socials = buildSocials(data);
  var links = buildLinks(ca, sig);
  var header = isAlert ? '🚨 *FEE CLAIM ALERT*\n\n' : '✅ *Now tracking*\n\n';

  return header +
    '[$' + data.ticker + '](https://pump.fun/' + ca + ')\n' +
    '`' + ca + '`\n\n' +
    '├ MC: ' + data.mc + '\n' +
    '├ Vol: ' + data.vol + '\n' +
    '├ Dex: ' + dex + '\n' +
    '└ 🔗 ' + socials + '\n\n' +
    links;
}

function sendCard(chatId, ca, data, isAlert, sig) {
  var text = buildText(ca, data, isAlert, sig);
  var refreshBtn = {inline_keyboard: [[{text: '🔄 Refresh MC', callback_data: 'refresh:' + ca}]]};

  if (data.pfp) {
    bot.sendPhoto(chatId, data.pfp, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: refreshBtn,
      disable_web_page_preview: true
    });
  } else {
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: refreshBtn,
      disable_web_page_preview: true
    });
  }
}

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id, 'PumpFee Bot is live!\n\nPaste any Pump.fun CA to track it.\n\nCommands:\n/track CA\n/list\n/help');
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Paste any Pump.fun CA to track fee claims.\n\nMax 10 tokens per user.\n\n/list - see tracked tokens');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked. Paste a CA to start.');
  tokens.forEach(function(t) {
    var text = '$' + t.ticker + '\n`' + t.mint + '`';
    var btns = {inline_keyboard: [[{text: 'Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'Markdown', reply_markup: btns});
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
      var text = '🔄 *Refreshed*\n\n' +
        '[$' + tokenData.ticker + '](https://pump.fun/' + ca + ')\n' +
        '`' + ca + '`\n\n' +
        '├ MC: ' + tokenData.mc + '\n' +
        '├ Vol: ' + tokenData.vol + '\n' +
        '├ Dex: ' + (tokenData.dexPaid ? '🟢' : '🔴') + '\n' +
        '└ 🔗 ' + buildSocials(tokenData) + '\n\n' +
        buildLinks(ca, null);
      var refreshBtn = {inline_keyboard: [[{text: '🔄 Refresh MC', callback_data: 'refresh:' + ca}]]};
      bot.sendMessage(query.message.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: refreshBtn,
        disable_web_page_preview: true
      });
    });
  }
});

function trackToken(uid, ca, chatId) {
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(chatId, 'Hit 10 token limit. Remove one first.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(chatId, 'Already tracking.');

  bot.sendMessage(chatId, 'Looking up token...');

  getTokenData(ca).then(function(data) {
    users[uid].push({mint: ca, ticker: data.ticker});
    startWatching(ca, data.ticker);
    sendCard(chatId, ca, data, false, null);
  }).catch(function() {
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
    Object.keys(users).forEach(function(uid) {
      if (users[uid].find(function(t) { return t.mint === mint; })) {
        sendCard(uid, mint, data, true, sig);
      }
    });
  });
}

console.log('Bot started');