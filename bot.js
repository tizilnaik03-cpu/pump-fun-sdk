var TelegramBot = require('node-telegram-bot-api');
var web3 = require('@solana/web3.js');
var fetch = require('node-fetch'); // ✅ FIXED

var BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
var HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

var MAX = 10;
var CACHE_TTL = 5 * 60 * 1000;
var QUEUE_MAX = 200;
var POLL_INTERVAL = 20000;

var PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
var PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

var bot = new TelegramBot(BOT_TOKEN, { polling: true });

var users = {};
var watchingMints = {};
var tokenCache = {};
var lastSig = {};
var lastSigInit = {};
var claimsCount = {};
var messageQueue = [];
var isProcessing = false;
var messageTypes = {};

var globalConn = new web3.Connection(
  'https://mainnet.helius-rpc.com/?api-key=' + HELIUS_KEY,
  'confirmed'
);

// ✅ Prevent Railway crash
process.on('uncaughtException', function(err) {
  console.log('[CRASH]', err.message);
});
process.on('unhandledRejection', function(err) {
  console.log('[PROMISE ERROR]', err);
});

// ================= CLEAN =================
setInterval(function() {
  var now = Date.now();

  Object.keys(tokenCache).forEach(function(k) {
    if (!tokenCache[k] || now - tokenCache[k].timestamp > CACHE_TTL) {
      delete tokenCache[k];
    }
  });

  if (messageQueue.length > QUEUE_MAX) {
    messageQueue = messageQueue.slice(-QUEUE_MAX);
  }

}, 300000);

// ================= POLL =================
setInterval(function() {
  var mints = Object.keys(watchingMints);
  if (mints.length === 0) return;

  mints.forEach(function(mint) {
    var info = watchingMints[mint];
    if (!info) return;

    pollAddress(mint, mint, info.ticker, true);

    if (info.feeWallet && info.feeWallet !== mint) {
      pollAddress(info.feeWallet, mint, info.ticker, false);
    }
  });
}, POLL_INTERVAL);

// ================= CORE =================
function pollAddress(addressStr, mint, ticker, isMint) {
  var pub;
  try {
    pub = new web3.PublicKey(addressStr);
  } catch(e) {
    return;
  }

  globalConn.getSignaturesForAddress(pub, { limit: 10 })
    .then(function(sigs) {
      if (!sigs || sigs.length === 0) return;

      if (!lastSigInit[addressStr]) {
        lastSigInit[addressStr] = true;
        lastSig[addressStr] = sigs[0].signature;
        return;
      }

      var newSigs = [];

      for (var i = 0; i < sigs.length; i++) {
        if (sigs[i].signature === lastSig[addressStr]) break;
        if (!sigs[i].err) newSigs.push(sigs[i]);
      }

      if (newSigs.length === 0) return;

      lastSig[addressStr] = sigs[0].signature;

      newSigs.forEach(function(sigInfo) {
        globalConn.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0
        })
        .then(function(tx) {
          if (!tx || !tx.meta) return;

          var logs = tx.meta.logMessages || [];
          var accountKeys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];

          var programAddrs = accountKeys.map(function(a) {
            return a.pubkey ? a.pubkey.toString() : '';
          });

          var hasPumpProgram =
            programAddrs.indexOf(PUMP_PROGRAM) !== -1 ||
            programAddrs.indexOf(PUMP_FEE_PROGRAM) !== -1;

          var hasClaimLog = logs.some(function(l) {
            return l && (
              l.includes('CollectCreatorFee') ||
              l.includes('distributeCreatorFees') ||
              l.includes('distribute_creator_fees')
            );
          });

          var isClaim = false;

          if (isMint) {
            isClaim = hasClaimLog;
          } else {
            var walletIdx = -1;

            for (var i = 0; i < accountKeys.length; i++) {
              if ((accountKeys[i].pubkey ? accountKeys[i].pubkey.toString() : '') === addressStr) {
                walletIdx = i;
                break;
              }
            }

            if (walletIdx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
              var solChange =
                (tx.meta.postBalances[walletIdx] -
                 tx.meta.preBalances[walletIdx]) / 1e9;

              if (solChange > 0.001 && (hasPumpProgram || hasClaimLog)) {
                isClaim = true;
              }
            }
          }

          if (!isClaim) return;

          claimsCount[mint] = (claimsCount[mint] || 0) + 1;

          fireAlert(mint, ticker, sigInfo.signature, claimsCount[mint]);
        })
        .catch(function(e) {
          console.log('[TX Error]', e.message);
        });
      });
    })
    .catch(function(e) {
      console.log('[Poll Error]', e.message);
    });
}

// ================= FIXED REGEX =================
bot.onText(/\/track (.+)/, function(msg, match) {
  trackToken(String(msg.chat.id), match[1].trim(), msg.chat.id);
});

// ================= MESSAGE =================
bot.on('message', function(msg) {
  var text = msg.text || '';
  if (text.startsWith('/')) return;

  var ca = text.trim();

  if (ca.length >= 32 && ca.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(ca)) {
    trackToken(String(msg.chat.id), ca, msg.chat.id);
  }
});

// ================= CLAIM =================
function getClaimedAmount(sig) {
  return fetch('https://api.helius.xyz/v0/transactions/?api-key=' + HELIUS_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: [sig] })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data || !data[0]) return null;

    var tx = data[0];
    var total = 0;

    (tx.nativeTransfers || []).forEach(function(t) {
      if (t && t.amount) total += t.amount;
    });

    if (total > 0) return (total / 1e9).toFixed(4);

    var maxChange = 0;

    (tx.accountData || []).forEach(function(a) {
      if (a && a.nativeBalanceChange && a.nativeBalanceChange > maxChange) {
        maxChange = a.nativeBalanceChange;
      }
    });

    return maxChange > 0 ? (maxChange / 1e9).toFixed(4) : null;
  })
  .catch(function() { return null; });
}

console.log('[Bot] Started');