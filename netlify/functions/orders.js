const TELEGRAM_BOT_TOKEN = '8750358475:AAHktaxxeCVDro2s3X0O4l7Xhxjia4iAfEw';
const TELEGRAM_CHAT_ID = '7276702024';
const SITE_URL = 'https://diningtoc.netlify.app';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

async function sendTelegram(chatId, text) {
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch(e) {
    console.error('Telegram error:', e.message);
  }
}

function getSGTDateTime() {
  const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const yyyy = nowSGT.getUTCFullYear();
  const mm = String(nowSGT.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nowSGT.getUTCDate()).padStart(2, '0');
  const hh = String(nowSGT.getUTCHours()).padStart(2, '0');
  const min = String(nowSGT.getUTCMinutes()).padStart(2, '0');
  const sec = String(nowSGT.getUTCSeconds()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + min + ':' + sec;
}

function getSGTTime() {
  const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const h = nowSGT.getUTCHours();
  const m = String(nowSGT.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = (h % 12) || 12;
  return h12 + ':' + m + ' ' + ampm;
}

function getTodayKey() {
  const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return nowSGT.toISOString().slice(0, 10);
}

// Use Netlify's built-in key-value store via fetch to a simple external store
// Since we can't use Blobs without config, we'll use a lightweight approach
// storing orders in memory per function instance and using Telegram as the source of truth

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // ── Telegram webhook (bot commands) ──────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch(e) { body = null; }

    // Handle Telegram bot commands
    if (body && body.message && body.message.text && body.message.text.startsWith('/')) {
      const chatId = body.message.chat.id;
      const cmd = body.message.text.split(' ')[0].toLowerCase();

      if (cmd === '/help') {
        await sendTelegram(chatId,
          'The Oyster Cart Bot\n' +
          '========================\n' +
          '/help - Show this message\n\n' +
          'You will receive a Telegram message for every new order automatically.'
        );
      } else {
        await sendTelegram(chatId, 'Send /help for available commands.');
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // Handle new order from menu
    try {
      const order = body;

      if (!order || !order.tableNumber || !order.lines || !order.lines.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid order' }) };
      }

      order.receivedAt = getSGTDateTime();
      order.id = 'TOC-' + Date.now();

      // Send Telegram notification
      const itemsList = order.lines.map(function(l) {
        const name = l.name + (l.modifier ? ' (' + l.modifier.label + ')' : '');
        const amt = (l.unitPrice * l.quantity).toFixed(2);
        return '  - ' + name + ' x' + l.quantity + ' - SGD ' + amt;
      }).join('\n');

      const tipLine = (order.tip && order.tip.percent > 0)
        ? '\nGratuity: SGD ' + order.tip.amount.toFixed(2) + ' (' + order.tip.percent + '%)' : '';

      const specialLine = order.specialRequest
        ? '\n\nSPECIAL REQUEST: ' + order.specialRequest : '';

      const message =
        'NEW ORDER - The Oyster Cart\n' +
        '========================\n' +
        'Table ' + order.tableNumber + ' | ' + order.receivedAt + ' SGT\n' +
        'Order ID: ' + order.id + '\n\n' +
        'ITEMS:\n' + itemsList + '\n' +
        '========================\n' +
        'Subtotal: SGD ' + (order.subtotal ? order.subtotal.toFixed(2) : '0.00') + tipLine + '\n' +
        'TOTAL: SGD ' + (order.total ? order.total.toFixed(2) : '0.00') +
        specialLine + '\n\n' +
        'View KDS: ' + SITE_URL;

      await sendTelegram(TELEGRAM_CHAT_ID, message);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, orderId: order.id, order: order })
      };

    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── GET - return empty orders (KDS uses localStorage) ─
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orders: [], message: 'Orders stored locally in KDS' })
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
