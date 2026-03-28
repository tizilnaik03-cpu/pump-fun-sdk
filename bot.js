
```javascript
var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');
var Connection = web3.Connection;
var PublicKey = web3.PublicKey;

var BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
var RPC = 'https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY;
var MAX = 10;

var bot = new TelegramBot(BOT_TOKEN, {polling: true});
var connection = new Connection(RPC, 'confirmed');
var users = {};
var subs = {};

bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id, 'PumpFee Alert Bot is live!\n\nCommands:\n/track CA - track a token\n/list - see tracked tokens\n/untrack CA - stop tracking\n/help - help');
});

bot.onText(/\/help/, function(msg) {
  bot.sendMessage(msg.chat.id, 'Paste a Pump.fun token CA after /track to start getting fee claim alerts.');
});

bot.onText(/\/list/, function(msg) {
  var uid = String(msg.chat.id);
  var tokens = users[uid] || [];
  if (tokens.length === 0) return bot.sendMessage(msg.chat.id, 'No tokens tracked yet. Use /track CA');
  var text = 'Tracked tokens ' + tokens.length + '/10:\n\n';
  tokens.forEach(function(t, i) { text += (i+1) + '. $' + t.ticker + '\n' + t.mint + '\n\n'; });
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
  if (users[uid].length >= MAX) return bot.sendMessage(msg.chat.id, 'You hit the 10 token limit. Use /untrack CA to remove one.');
  if (users[uid].find(function(t) { return t.mint === ca; })) return bot.sendMessage(msg.chat.id, 'Already tracking this token.');

  bot.sendMessage(msg.chat.id, 'Adding token...');

  fetch('https://api.helius.xyz/v0/token-metadata?api-key=' + HELIUS_KEY, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({mintAccounts: [ca]})
  }).then(function(res) {
    return res.json();
  }).then(function(data) {
    var ticker = 'UNKNOWN';
    if (data && data[0] && data[0].onChainMetadata && data[0].onChainMetadata.metadata) {
      ticker = data[0].onChainMetadata.metadata.data.symbol || 'UNKNOWN';
    }
    users[uid].push({mint: ca, ticker: ticker});
    subscribeToken(ca, ticker);
    bot.sendMessage(msg.chat.id, 'Now tracking $' + ticker + '\nTracking: ' + users[uid].length + '/10');
  }).catch(function() {
    bot.sendMessage(msg.chat.id, 'Could not find token. Check CA and try again.');
  });
});

function subscribeToken(mint, ticker) {
  if (subs[mint]) return;
  try {
    var pubkey = new PublicKey(mint);
    subs[mint] = connection.onLogs(pubkey, function(logs) {
      if (logs.err) return;
      var isClaim = logs.logs.some(function(log) {
        return log.includes('collectCreatorFee') || log.includes('claim') || log.includes('withdraw');
      });
      if (isClaim) sendAlerts(mint, ticker, logs.signature);
    }, 'confirmed');
  } catch(e) {
    console.log('Subscribe error: ' + e.message);
  }
}

function sendAlerts(mint, ticker, sig) {
  var text = 'FEE CLAIM ALERT\n\n$' + ticker + ' fees just claimed!\n\n' + mint;
  var buttons = {inline_keyboard: [
    [{text: 'BullX', url: 'https://bullx.io/terminal?chainId=1399811149&address=' + mint}, {text: 'GMGN', url: 'https://gmgn.ai/sol/token/' + mint}],
    [{text: 'Axiom', url: 'https://axiom.trade/t/' + mint}, {text: 'DexScreener', url: 'https://dexscreener.com/solana/' + mint}],
    [{text: 'Pump.fun', url: 'https://pump.fun/' + mint}, {text: 'Solscan', url: 'https://solscan.io/tx/' + sig}]
  ]};
  Object.keys(users).forEach(function(uid) {
    if (users[uid].find(function(t) { return t.mint === mint; })) {
      bot.sendMessage(uid, text, {reply_markup: buttons});
    }
  });
}

console.log('Bot started');
```
