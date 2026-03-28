

```javascript
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey } = require('@solana/web3.js');

const BOT_TOKEN = '8732323530:AAHW-EBvR5PrB6Ma1e71_8fW9aAX_H9ujDo';
const HELIUS_API_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const MAX_TOKENS_PER_USER = 10;

const connection = new Connection(RPC_URL, 'confirmed');
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Storage: { userId: [{ mint, ticker, feeWallet }] }
const userTracking = {};
const activeSubscriptions = {};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    `👋 *PumpFee Alert Bot*\n\nGet instant alerts when fees are claimed on any Pump.fun token.\n\n` +
    `*Commands:*\n/track <CA> — Track a token\n/list — See your tracked tokens\n/untrack <CA> — Stop tracking\n/help — Help`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*How to use:*\n\n1. Copy any Pump.fun token CA\n2. Type /track <CA>\n3. Get pinged every time fees are claimed\n\nMax 10 tokens per user.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/list/, (msg) => {
  const userId = msg.chat.id.toString();
  const tokens = userTracking[userId] || [];
  if (tokens.length === 0) {
    return bot.sendMessage(msg.chat.id, `You're not tracking any tokens yet.\n\nUse /track <CA> to add one.`);
  }
  const list = tokens.map((t, i) => `${i+1}. *${t.ticker}*\n\`${t.mint}\``).join('\n\n');
  bot.sendMessage(msg.chat.id, `*Your tracked tokens (${tokens.length}/10):*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/untrack (.+)/, (msg, match) => {
  const userId = msg.chat.id.toString();
  const ca = match[1].trim();
  if (!userTracking[userId]) return bot.sendMessage(msg.chat.id, `You're not tracking that token.`);
  const before = userTracking[userId].length;
  userTracking[userId] = userTracking[userId].filter(t => t.mint !== ca);
  if (userTracking[userId].length < before) {
    bot.sendMessage(msg.chat.id, `✅ Stopped tracking \`${ca}\``, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(msg.chat.id, `Token not found in your list.`);
  }
});

bot.onText(/\/track (.+)/, async (msg, match) => {
  const userId = msg.chat.id.toString();
  const ca = match[1].trim();

  if (!userTracking[userId]) userTracking[userId] = [];
  if (userTracking[userId].length >= MAX_TOKENS_PER_USER) {
    return bot.sendMessage(msg.chat.id, `⚠️ You've hit the 10 token limit.\n\nUse /untrack <CA> to remove one first.`);
  }
  if (userTracking[userId].find(t => t.mint === ca)) {
    return bot.sendMessage(msg.chat.id, `Already tracking this token.`);
  }

  bot.sendMessage(msg.chat.id, `🔍 Looking up token info...`);

  try {
    const res = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintAccounts: [ca] })
    });
    const data = await res.json();
    const ticker = data?.[0]?.onChainMetadata?.metadata?.data?.symbol || 'UNKNOWN';

    userTracking[userId].push({ mint: ca, ticker, feeWallet: ca });
    subscribeToToken(ca, ticker);

    bot.sendMessage(msg.chat.id, 
      `✅ Now tracking *$${ticker}*\n\nYou'll get pinged the moment fees are claimed.\n\nTracking: ${userTracking[userId].length}/10`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Couldn't find that token. Check the CA and try again.`);
  }
});

function subscribeToToken(mint, ticker) {
  if (activeSubscriptions[mint]) return;

  try {
    const pubkey = new PublicKey(mint);
    const subId = connection.onLogs(pubkey, (logs) => {
      const isClaim = logs.logs.some(log => 
        log.includes('collectCreatorFee') || 
        log.includes('claim') ||
        log.includes('fee_claim') ||
        log.includes('withdraw')
      );

      if (isClaim && !logs.err) {
        const sig = logs.signature;
        alertAllTrackers(mint, ticker, sig);
      }
    }, 'confirmed');

    activeSubscriptions[mint] = subId;
  } catch(e) {
    console.log(`Error subscribing to ${mint}:`, e.message);
  }
}

function alertAllTrackers(mint, ticker, sig) {
  const message = `🚨 *FEE CLAIM ALERT*\n\n*$${ticker}* — fees just claimed!\n\n\`${mint}\``;
  
  const buttons = {
    inline_keyboard: [
      [
        { text: '⭐ BullX', url: `https://bullx.io/terminal?chainId=1399811149&address=${mint}` },
        { text: '🦎 GMGN', url: `https://gmgn.ai/sol/token/${mint}` }
      ],
      [
        { text: '⚡ Axiom', url: `https://axiom.trade/t/${mint}` },
        { text: '📊 DexScreener', url: `https://dexscreener.com/solana/${mint}` }
      ],
      [
        { text: '🌐 Pump.fun', url: `https://pump.fun/${mint}` },
        { text: '🔍 Solscan Tx', url: `https://solscan.io/tx/${sig}` }
      ]
    ]
  };

  Object.entries(userTracking).forEach(([userId, tokens]) => {
    if (tokens.find(t => t.mint === mint)) {
      bot.sendMessage(userId, message, { 
        parse_mode: 'Markdown',
        reply_markup: buttons
      });
    }
  });
}

console.log('PumpFee Bot is running...');
```

Then also replace the `package.json` file with this:

```json
{
  "name": "pumpfee-bot",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "node-telegram-bot-api": "^0.64.0",
    "@solana/web3.js": "^1.87.6"
  }
}
```

