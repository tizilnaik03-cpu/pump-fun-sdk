const TelegramBot = require('node-telegram-bot-api');
const web3 = require('@solana/web3.js');

const BOT_TOKEN = '8669635112:AAHb4lEJhUtUnm9wLAg4w8opND21La9op3E';
const HELIUS_KEY = 'f783be12-4da4-4170-b5e9-c7a1fd1c03bb';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('[Bot] Telegram polling started...');

// === ALL COMMAND HANDLERS FIRST (this is critical) ===
bot.onText(/\/start/, (msg) => {
  console.log('[Command] /start received from', msg.chat.id);
  bot.sendMessage(msg.chat.id, 
    '<b>PumpFee Alert Bot</b> 🚨\n\n' +
    'Get notified when creator fees are claimed.\n\n' +
    'How to use:\n' +
    '• Paste any Pump.fun token CA\n' +
    '• Or use /track <CA>\n' +
    '• /list to manage tracked tokens', 
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/help/, (msg) => {
  console.log('[Command] /help received from', msg.chat.id);
  bot.sendMessage(msg.chat.id,
    '<b>How to use PumpFee Bot:</b>\n\n' +
    '1. Paste a Pump.fun token address directly\n' +
    '2. Or type /track <CA>\n' +
    '3. Use /list to see and remove tracked tokens\n\n' +
    'You will receive alerts when fees are claimed.', 
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/list/, (msg) => {
  console.log('[Command] /list received from', msg.chat.id);
  // We'll implement full list later - for now just confirm it works
  bot.sendMessage(msg.chat.id, 'List command received. Working on full implementation...');
});

// Temporary simple track for testing
bot.onText(/\/track (.+)/, (msg, match) => {
  console.log('[Command] /track received:', match[1]);
  bot.sendMessage(msg.chat.id, `Tracking requested for: ${match[1]}`);
});

// Catch any message that looks like a Solana address
bot.on('message', (msg) => {
  const text = (msg.text || '').trim();
  console.log('[Message] Received:', text.substring(0, 20) + '...');

  if (text.startsWith('/')) return;

  if (text.length >= 32 && text.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
    console.log('[Address Detected] Trying to track:', text);
    bot.sendMessage(msg.chat.id, `Detected token address. Tracking ${text}...`);
    // We'll connect full trackToken here later
  }
});

console.log('[Bot] All command handlers registered.');

// === POLLING & CORE LOGIC (kept minimal for now) ===
const globalConn = new web3.Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, 'confirmed');

// Add your watchingMints, pollAddress, fireAlert etc. here later

console.log('[Bot] Full bot initialized. Test /start, /help, /list now.');