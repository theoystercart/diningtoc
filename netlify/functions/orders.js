// Netlify Function — Order storage and email notifications
// Uses Netlify Blobs for storage and Resend for email

const TELEGRAM_BOT_TOKEN = '8750358475:AAHktaxxeCVDro2s3X0O4l7Xhxjia4iAfEw';
const TELEGRAM_CHAT_ID = '7276702024';
const SITE_URL = 'https://diningtoc.netlify.app';

// ── Send Telegram message helper ───────────────────────
async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { getStore } = require('@netlify/blobs');
  const store = getStore('orders');

  // ── POST from Telegram webhook (bot commands) ─────────
  if (event.httpMethod === 'POST' && event.headers['content-type']?.includes('application/json')) {
    try {
      const body = JSON.parse(event.body);
      // Check if it's a Telegram webhook update (has message.text starting with /)
      if (body.message?.text?.startsWith('/')) {
        const chatId = body.message.chat.id;
        const cmd = body.message.text.split(' ')[0].toLowerCase();

        if (cmd === '/total' || cmd === '/sales') {
          // Calculate today's grand total from stored orders
          const { getStore } = require('@netlify/blobs');
          const store = getStore('orders');
          const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
          const todayKey = nowSGT.toISOString().slice(0, 10);

          let orders = [];
          try {
            const raw = await store.get(`orders_${todayKey}`);
            if (raw) orders = JSON.parse(raw);
          } catch(e) { orders = []; }

          const grandTotal = orders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
          const orderCount = orders.length;

          // Break down by table
          const byTable = {};
          orders.forEach(o => {
            const t = o.tableNumber || '?';
            if (!byTable[t]) byTable[t] = 0;
            byTable[t] += parseFloat(o.total) || 0;
          });

          const tableBreakdown = Object.entries(byTable)
            .sort((a,b) => b[1]-a[1])
            .map(([t, amt]) => `  Table ${t}: SGD ${amt.toFixed(2)}`)
            .join('
');

          const now = nowSGT;
          let h = now.getUTCHours(), mm = String(now.getUTCMinutes()).padStart(2,'0');
          const ap = h>=12?'pm':'am'; h=h%12||12;

          await sendTelegram(chatId, `🦪 *The Oyster Cart — Daily Sales*
━━━━━━━━━━━━━━━━━━━━━━
📅 ${todayKey} | 🕐 ${h}:${mm} ${ap} SGT

📊 *${orderCount} order${orderCount!==1?'s':''} today*

${tableBreakdown || '  No orders yet'}

━━━━━━━━━━━━━━━━━━━━━━
💰 *GRAND TOTAL: SGD ${grandTotal.toFixed(2)}*`);

        } else if (cmd === '/orders') {
          // Show today's order count and list
          const { getStore } = require('@netlify/blobs');
          const store = getStore('orders');
          const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
          const todayKey = nowSGT.toISOString().slice(0, 10);

          let orders = [];
          try {
            const raw = await store.get(`orders_${todayKey}`);
            if (raw) orders = JSON.parse(raw);
          } catch(e) { orders = []; }

          if (!orders.length) {
            await sendTelegram(chatId, '🦪 No orders yet today.');
          } else {
            const list = orders.map((o, i) =>
              `${i+1}. Table ${o.tableNumber} — SGD ${parseFloat(o.total).toFixed(2)} (${o.receivedAt?.slice(11,16) || '—'})`
            ).join('
');
            await sendTelegram(chatId, `🦪 *Today's Orders*
━━━━━━━━━━━━━━━━━━━━━━
${list}`);
          }

        } else if (cmd === '/help') {
          await sendTelegram(chatId, `🦪 *The Oyster Cart Bot*
━━━━━━━━━━━━━━━━━━━━━━
Available commands:

/total — Grand total sales for today
/orders — List all orders today
/help — Show this message`);

        } else {
          await sendTelegram(chatId, '🦪 Unknown command. Send /help for available commands.');
        }

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }
    } catch(e) {
      console.error('Webhook error:', e.message);
    }
  }

  // ── GET — fetch today's orders ──────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      // Get today's date in SGT (UTC+8)
      const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const todayKey = nowSGT.toISOString().slice(0, 10); // "2026-05-08"

      let orders = [];
      try {
        const raw = await store.get(`orders_${todayKey}`);
        if (raw) orders = JSON.parse(raw);
      } catch (e) {
        orders = [];
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ orders })
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  // ── POST — save new order + send email ─────────────────
  if (event.httpMethod === 'POST') {
    try {
      const order = JSON.parse(event.body);

      // Validate
      if (!order.tableNumber || !order.lines || !order.lines.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid order' }) };
      }

      // Add server timestamp in SGT
      const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const todayKey = nowSGT.toISOString().slice(0, 10);
      order.receivedAt = nowSGT.toISOString().replace('T', ' ').slice(0, 19);
      order.id = `TOC-${Date.now()}`;

      // Save to Blobs
      let orders = [];
      try {
        const raw = await store.get(`orders_${todayKey}`);
        if (raw) orders = JSON.parse(raw);
      } catch (e) { orders = []; }

      orders.push(order);
      await store.set(`orders_${todayKey}`, JSON.stringify(orders));

      // ── Send Telegram notification ───────────────────────
      try {
        const itemsList = order.lines.map(l =>
          `  • ${l.name}${l.modifier ? ` (${l.modifier.label})` : ''} ×${l.quantity} — SGD ${(l.unitPrice * l.quantity).toFixed(2)}`
        ).join('\n');

        const tipLine = order.tip?.percent > 0
          ? `\nGratuity  : SGD ${order.tip.amount.toFixed(2)} (${order.tip.percent}%)` : '';

        const specialLine = order.specialRequest
          ? `\n\n⚠️ Special Request: ${order.specialRequest}` : '';

        const message = `🦪 *NEW ORDER — The Oyster Cart*
━━━━━━━━━━━━━━━━━━━━━━
🪑 *Table ${order.tableNumber}*  |  🕐 ${order.receivedAt} SGT
📋 ${order.id}

*ITEMS*
${itemsList}
━━━━━━━━━━━━━━━━━━━━━━
Subtotal  : SGD ${order.subtotal?.toFixed(2) || '0.00'}${tipLine}
*Total     : SGD ${order.total?.toFixed(2) || '0.00'}*${specialLine}

[View KDS](${SITE_URL})`;

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          })
        });
      } catch (telegramErr) {
        console.error('Telegram error:', telegramErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, orderId: order.id })
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
