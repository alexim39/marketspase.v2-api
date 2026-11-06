import crypto from 'node:crypto';
import http from 'node:http';

/**
 * Local Paystack stand-in for the commerce smoke test.
 *
 * It implements only the endpoints the store checkout uses:
 * - POST /transaction/initialize
 * - GET  /transaction/verify/:reference
 * - GET  /checkout/:reference      (hosted-checkout stand-in)
 * - POST /checkout/:reference/pay  (marks paid + sends a signed webhook)
 *
 * Point the API at it with:
 *   PAYSTACKTOKEN=sk_test_e2e
 *   PAYSTACK_BASE_URL=http://localhost:4010
 *   PAYSTACK_PUBLIC_KEY=pk_test_e2e
 *
 * No real money or network provider is involved.
 */

const port = Number(process.env.MOCK_PAYSTACK_PORT || 4010);
const publicBase = String(
  process.env.MOCK_PAYSTACK_PUBLIC_URL || `http://localhost:${port}`,
).replace(/\/+$/, '');
const webhookUrl = String(
  process.env.MOCK_PAYSTACK_WEBHOOK_URL || 'http://localhost:3000/v1/stores/payments/webhook',
);
const secret = String(process.env.PAYSTACKTOKEN || 'sk_test_e2e');
const transactions = new Map();

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
  });
  res.end(payload);
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const money = (kobo) => `NGN ${(Number(kobo || 0) / 100).toLocaleString('en-NG')}`;

const checkoutPage = (tx) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mock Paystack checkout</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#0b0916; color:#f4f2ff; display:grid; place-items:center; min-height:100vh; }
    main { width:min(460px, calc(100% - 2rem)); background:#151226; border:1px solid #2a2542; border-radius:20px; padding:1.6rem; box-shadow:0 28px 70px rgba(0,0,0,.55); }
    .eyebrow { color:#aab8ff; font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin:.4rem 0 .2rem; font-size:1.55rem; }
    p { color:#a59fbb; line-height:1.55; }
    dl { display:grid; grid-template-columns:auto 1fr; gap:.5rem 1rem; margin:1.2rem 0; }
    dt { color:#a59fbb; }
    dd { margin:0; text-align:right; font-weight:700; }
    button { width:100%; border:0; border-radius:999px; padding:.95rem 1rem; font:inherit; font-weight:750; background:#667eea; color:#fff; cursor:pointer; }
    button:hover { background:#4c5bd4; }
    small { display:block; margin-top:1rem; color:#8f89a6; text-align:center; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Mock Paystack</p>
    <h1>Confirm test payment</h1>
    <p>This is the local smoke-test checkout. No real charge is made.</p>
    <dl>
      <dt>Reference</dt><dd>${tx.reference}</dd>
      <dt>Email</dt><dd>${tx.email || 'test@example.com'}</dd>
      <dt>Amount</dt><dd>${money(tx.amount)}</dd>
    </dl>
    <form method="post" action="/checkout/${encodeURIComponent(tx.reference)}/pay">
      <button type="submit">Pay ${money(tx.amount)}</button>
    </form>
    <small>Test gateway · MarketSpase local smoke</small>
  </main>
</body>
</html>`;

const sendWebhook = async (tx) => {
  const payload = JSON.stringify({
    event: 'charge.success',
    data: {
      reference: tx.reference,
      amount: tx.amount,
      currency: 'NGN',
      status: 'success',
      fees: tx.fees,
      channel: 'card',
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      customer: { email: tx.email },
      metadata: tx.metadata ?? {},
    },
  });
  const signature = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': signature,
      },
      body: payload,
    });
    console.log(`[mock-paystack] webhook ${tx.reference} -> ${response.status}`);
  } catch (error) {
    console.warn(`[mock-paystack] webhook failed for ${tx.reference}: ${error?.message ?? error}`);
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', publicBase);
  const path = decodeURIComponent(url.pathname);
  console.log(`[mock-paystack] ${req.method} ${path}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { status: true, service: 'mock-paystack' });
  }

  if (req.method === 'POST' && path === '/transaction/initialize') {
    const body = await readBody(req);
    const reference = String(body.reference || `MOCK-${Date.now()}`);
    const tx = {
      reference,
      amount: Number(body.amount || 0),
      email: String(body.email || ''),
      callbackUrl: String(body.callback_url || 'http://localhost:4201/checkout/result'),
      metadata: body.metadata ?? {},
      status: 'pending',
      fees: 0,
    };
    transactions.set(reference, tx);
    return json(res, 200, {
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: `${publicBase}/checkout/${encodeURIComponent(reference)}`,
        access_code: `mock_${reference}`,
        reference,
        status: 'pending',
      },
    });
  }

  if (req.method === 'GET' && path.startsWith('/checkout/')) {
    const reference = path.slice('/checkout/'.length);
    const tx = transactions.get(reference);
    if (!tx) return json(res, 404, { status: false, message: 'Unknown transaction' });
    const html = checkoutPage(tx);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
    });
    return res.end(html);
  }

  if (req.method === 'POST' && path.startsWith('/checkout/') && path.endsWith('/pay')) {
    const reference = path.slice('/checkout/'.length, -'/pay'.length);
    const tx = transactions.get(reference);
    if (!tx) return json(res, 404, { status: false, message: 'Unknown transaction' });
    tx.status = 'success';
    tx.fees = Math.min(Math.round(tx.amount * 0.015) + 10000, 200000);
    await sendWebhook(tx);
    const redirect = new URL(tx.callbackUrl);
    if (!redirect.searchParams.has('reference')) {
      redirect.searchParams.set('reference', reference);
    }
    res.writeHead(303, { location: redirect.toString() });
    return res.end();
  }

  if (req.method === 'GET' && path.startsWith('/transaction/verify/')) {
    const reference = path.slice('/transaction/verify/'.length);
    const tx = transactions.get(reference);
    if (!tx) {
      return json(res, 404, { status: false, message: 'Transaction not found' });
    }
    return json(res, 200, {
      status: true,
      message: 'Verification successful',
      data: {
        reference,
        amount: tx.amount,
        currency: 'NGN',
        status: tx.status === 'success' ? 'success' : 'pending',
        fees: tx.fees,
        channel: 'card',
        gateway_response: tx.status === 'success' ? 'Successful' : 'Pending',
        paid_at: tx.status === 'success' ? new Date().toISOString() : null,
        customer: { email: tx.email },
        metadata: tx.metadata ?? {},
      },
    });
  }

  return json(res, 404, { status: false, message: 'Not found' });
});

server.listen(port, () => {
  console.log(`[mock-paystack] listening on ${publicBase}`);
  console.log(`[mock-paystack] webhook target: ${webhookUrl}`);
});
