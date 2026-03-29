var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};

function getTicker(ca) {
  return fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.pairs && d.pairs[0]) return d.pairs[0].baseToken.symbol;
      return 'UNKNOWN';
    })
    .catch(function() { return 'UNKNOWN'; });
}

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id, 'PumpFee Bot is live!\n\nCommands:\n/track CA - track a token\n/list - see tracked tokens\n/help - help');
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Type /track followed by a Pump.fun token CA to get fee claim alerts.\n\nMax 10 tokens per user.');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked. Use /track CA');
  tokens.forEach(function(t, i) {
    var text = (i+1) + '. $' + t.ticker + '\n' + '`' + t.mint + '`';
    var btns = {inline_keyboard: [[{text: 'Remove', callback_data: 'remove:' + t.mint}]]};
    bot.sendMessage(msg.chat.id, text, {parse_mode: 'Markdown', reply_markup: btns});
  });
});

bot.onText(/\/untrack (.+)/, function(msg, match) {
  var uid = String(msg.chat.id);
  var ca = match[1].trim();
  if (!users[uid]) return bot.sendMessage(msg.chat.id, 'Not tracking that token.');
  var before = users[uid].length;
  users[uid] = users[uid].filter(function(t) { return t.mint !== ca; });
  if (users[uid].length < before) bot.sendMessage(msg.chat.id, 'Stopped tracking ' + ca);
  else bot.sendMessage(msg.chat.id, 'Token not found.');
});

bot.onText(/\/track (.+)/, function(msg, match) {
  var uid = String(msg.chat.id);
  var ca = match[1].trim();
  if (!users[uid]) users[uid] = [];
  if (users[uid].length >= MAX) return bot.sendMessage(msg.chat.id, 'Hit 10 token limit. Remove one first.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(msg.chat.id, 'Already tracking.');
  bot.sendMessage(msg.chat.id, 'Looking up token...');
  getTicker(ca).then(function(ticker) {
    users[uid].push({mint: ca, ticker: ticker});
    startWatching(ca, ticker);
    bot.sendMessage(msg.chat.id, 'Now tracking $' + ticker + ' (' + users[uid].length + '/10)');
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
    bot.editMessageReplyMarkup({inline_keyboard: []}, {chat_id: query.message.chat.id, message_id: query.message.message_id});
  }
});

bot.on('message', function(msg) {
  var text = msg.text || '';
  if (text.startsWith('/')) return;
  var ca = text.trim();
  if (ca.length > 30 && !ca.includes(' ')) {
    var uid = String(msg.chat.id);
    if (!users[uid]) users[uid] = [];
    if (users[uid].length >= MAX) return bot.sendMessage(msg.chat.id, 'Hit 10 token limit. Remove one first.');
    if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(msg.chat.id, 'Already tracking.');
    bot.sendMessage(msg.chat.id, 'Looking up token...');
    getTicker(ca).then(function(ticker) {
      users[uid].push({mint: ca, ticker: ticker});
      startWatching(ca, ticker);
      bot.sendMessage(msg.chat.id, 'Now tracking $' + ticker + ' (' + users[uid].length + '/10)');
    });
  }
});

function startWatching(mint, ticker) {
  try {
    var pub = new web3.PublicKey(mint);
    var conn = new web3.Connection('https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY, 'confirmed');
    conn.onLogs(pub, function(logs) {
      if (logs.err) return;
      var claim = logs.logs.some(function(l) { return l.includes('collectCreatorFee') || l.includes('claim'); });
      if (claim) fireAlert(mint, ticker, logs.signature);
    }, 'confirmed');
  } catch(e) { console.log('Watch error: ' + e.message); }
}

function fireAlert(mint, ticker, sig) {
  var msg = 'FEE CLAIM ALERT\n\n$' + ticker + ' fees just claimed!\n\n`' + mint + '`';
  var btns = {inline_keyboard: [
    [{text: 'BullX', url: 'https://bullx.io/terminal?chainId=1399811149&address=' + mint}, {text: 'GMGN', url: 'https://gmgn.ai/sol/token/' + mint}],
    [{text: 'Axiom', url: 'https://axiom.trade/t/' + mint}, {text: 'Photon', url: 'https://photon-sol.tinyastro.io/en/lp/' + mint}],
    [{text: 'DexScreener', url: 'https://dexscreener.com/solana/' + mint}, {text: 'Pump.fun', url: 'https://pump.fun/' + mint}],
    [{text: 'Solscan', url: 'https://solscan.io/tx/' + sig}]
  ]};
  Object.keys(users).forEach(function(uid) {
    if (users[uid].find(function(t) { return t.mint === mint; })) bot.sendMessage(uid, msg, {parse_mode: 'Markdown', reply_markup: btns});
  });
}

console.log('Bot started');