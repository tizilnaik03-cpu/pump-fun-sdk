var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var MAX = 10;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var users = {};

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id, 'PumpFee Bot is live! Use /track CA to track a token.');
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Type /track followed by a token CA to get fee claim alerts.');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked. Use /track CA');
  var text = 'Tracking ' + tokens.length + '/10 tokens:\n\n';
  tokens.forEach(function(t, i) {
    text += (i+1) + '. $' + t.ticker + '\n' + t.mint + '\n\n';
  });
  bot.sendMessage(msg.chat.id, text);
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
  if (users[uid].length >= MAX) return bot.sendMessage(msg.chat.id, 'Hit 10 token limit. Use /untrack CA first.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(msg.chat.id, 'Already tracking.');

  bot.sendMessage(msg.chat.id, 'Looking up token...');

  fetch('https://api.helius.xyz/v0/token-metadata?api-key=' + HELIUS_KEY, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({mintAccounts: [ca]})
  }).then(function(r) { return r.json(); }).then(function(d) {
    var ticker = (d && d[0] && d[0].onChainMetadata && d[0].onChainMetadata.metadata && d[0].onChainMetadata.metadata.data) ? d[0].onChainMetadata.metadata.data.symbol : 'UNKNOWN';
    users[uid].push({mint: ca, ticker: ticker});
    startWatching(ca, ticker);
    bot.sendMessage(msg.chat.id, 'Now tracking $' + ticker + ' (' + users[uid].length + '/10)');
  }).catch(function() {
    bot.sendMessage(msg.chat.id, 'Could not find token. Check CA and try again.');
  });
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
  var msg = 'FEE CLAIM ALERT\n\n$' + ticker + ' fees just claimed!\n\n' + mint;
  var btns = {inline_keyboard: [
    [{text: 'BullX', url: 'https://bullx.io/terminal?chainId=1399811149&address=' + mint}, {text: 'GMGN', url: 'https://gmgn.ai/sol/token/' + mint}],
    [{text: 'Axiom', url: 'https://axiom.trade/t/' + mint}, {text: 'DexScreener', url: 'https://dexscreener.com/solana/' + mint}],
    [{text: 'Pump.fun', url: 'https://pump.fun/' + mint}, {text: 'Solscan', url: 'https://solscan.io/tx/' + sig}]
  ]};
  Object.keys(users).forEach(function(uid) {
    if (users[uid].find(function(t) { return t.mint === mint; })) bot.sendMessage(uid, msg, {reply_markup: btns});
  });
}

console.log('Bot started');
