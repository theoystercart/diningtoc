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

async function getOrders(store, todayKey) {
  try {
    const raw = await store.get('orders_' + todayKey);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return [];
}

async function saveOrders(store, todayKey, orders) {
  await store.set('orders_' + todayKey, JSON.stringify(orders));
}

function getTodayKey() {
  const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return nowSGT.toISOString().slice(0, 10);
}

function getSGTTime() {
  const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const h = nowSGT.getUTCHours();
  const m = String(nowSGT.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = (h % 12) || 12;
  return h12 + ':' + m + ' ' + ampm;
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

exports.handler = async function(event) {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { getStore } = require('@netlify/blobs');
  const store = getStore('orders');
  const todayKey = getTodayKey();

  // ── Telegram webhook (bot commands) ──────────────────
  if (event.httpMethod === 'POST' && event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
    let body;
    try { body = JSON.parse(event.body); } catch(e) { body = null; }

    if (body && body.message && body.message.text && body.message.text.startsWith('/')) {
      const chatId = body.message.chat.id;
      const cmd = body.message.text.split(' ')[0].toLowerCase();

      if (cmd === '/total' || cmd === '/sales') {
        const orders = await getOrders(store, todayKey);
        const grandTotal = orders.reduce(function(sum, o) { return sum + (parseFloat(o.total) || 0); }, 0);
        const orderCount = orders.length;

        const byTable = {};
        orders.forEach(function(o) {
          const t = o.tableNumber || '?';
          if (!byTable[t]) byTable[t] = 0;
          byTable[t] += parseFloat(o.total) || 0;
        });

        const tableLines = Object.entries(byTable)
          .sort(function(a, b) { return b[1] - a[1]; })
          .map(function(entry) { return '  Table ' + entry[0] + ': SGD ' + entry[1].toFixed(2); })
          .join('\n');

        await sendTelegram(chatId,
          'The Oyster Cart - Daily Sales\n' +
          '========================\n' +
          'Date: ' + todayKey + ' | ' + getSGTTime() + ' SGT\n\n' +
          orderCount + ' order(s) today\n\n' +
          (tableLines || '  No orders yet') + '\n\n' +
          'GRAND TOTAL: SGD ' + grandTotal.toFixed(2)
        );

      } else if (cmd === '/orders') {
        const orders = await getOrders(store, todayKey);
        if (!orders.length) {
          await sendTelegram(chatId, 'No orders yet today.');
        } else {
          const list = orders.map(function(o, i) {
            return (i + 1) + '. Table ' + o.tableNumber + ' - SGD ' + parseFloat(o.total).toFixed(2) + ' (' + (o.receivedAt ? o.receivedAt.slice(11, 16) : '--') + ')';
          }).join('\n');
          await sendTelegram(chatId, "Today's Orders\n========================\n" + list);
        }

      } else if (cmd === '/help') {
        await sendTelegram(chatId,
          'The Oyster Cart Bot\n' +
          '========================\n' +
          '/total - Grand total sales today\n' +
          '/orders - List all orders today\n' +
          '/help - Show this message'
        );
      } else {
        await sendTelegram(chatId, 'Unknown command. Send /help for available commands.');
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
  }

  // ── GET - fetch today's orders ────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const orders = await getOrders(store, todayKey);
      return { statusCode: 200, headers, body: JSON.stringify({ orders: orders }) };
    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST - save new order + send Telegram ─────────────
  if (event.httpMethod === 'POST') {
    try {
      const order = JSON.parse(event.body);

      if (!order.tableNumber || !order.lines || !order.lines.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid order' }) };
      }

      order.receivedAt = getSGTDateTime();
      order.id = 'TOC-' + Date.now();

      const orders = await getOrders(store, todayKey);
      orders.push(order);
      await saveOrders(store, todayKey, orders);

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
        order.id + '\n\n' +
        'ITEMS:\n' + itemsList + '\n' +
        '========================\n' +
        'Subtotal: SGD ' + (order.subtotal ? order.subtotal.toFixed(2) : '0.00') + tipLine + '\n' +
        'TOTAL: SGD ' + (order.total ? order.total.toFixed(2) : '0.00') +
        specialLine + '\n\n' +
        'View KDS: ' + SITE_URL;

      await sendTelegram(TELEGRAM_CHAT_ID, message);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, orderId: order.id }) };

    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
