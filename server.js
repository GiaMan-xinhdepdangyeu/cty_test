const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const API_KEY_SECRET = process.env.API_KEY_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Lưu trữ tạm khách hàng phía Công ty A (In-memory DB)
const customersDb = new Map();

// Middleware kiểm tra API Key khi web_CTV gọi API tạo khách
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== API_KEY_SECRET) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'API Key không hợp lệ' });
  }
  next();
};

// Hàm tạo chữ ký HMAC để bảo mật Webhook gửi tới web_CTV
const generateSignature = (timestamp, payload) => {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(JSON.stringify(payload))
    .digest('hex');
};

// Hàm gửi Webhook sang web_CTV
const sendWebhook = async (targetUrl, payload) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = generateSignature(timestamp, payload);
  console.log(`[COMPANY A] 📤 Đang gửi Webhook tới: ${targetUrl}`);
  console.log(`[COMPANY A] Payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(targetUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
        'X-Company-Id': 'COMPANY_A'
      },
      timeout: 5000
    });
    console.log(`[COMPANY A] ✅ Webhook gửi thành công. Response status: ${response.status}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`[COMPANY A] ❌ Webhook thất bại: ${error.message}`);
    return { success: false, error: error.response?.data || error.message };
  }
};

/* ==========================================================================
   1. API Tiếp nhận Khách hàng từ web_CTV (POST /v1/customers)
   ========================================================================== */
app.post('/v1/customers', authenticateApiKey, (req, res) => {
  const { customerName, customerEmail, customerPhone, service, suggestAmount, note } = req.body;

  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Thiếu tên hoặc số điện thoại' });
  }

  // Tạo refcode ngẫu nhiên
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  const refcode = `REF-${dateStr}-${randomStr}`;

  const customerRecord = {
    refcode,
    customerName,
    customerEmail,
    customerPhone,
    service,
    suggestAmount,
    note,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  customersDb.set(refcode, customerRecord);

  console.log(`[COMPANY A] 👤 Tạo thành công Customer với Refcode: ${refcode}`);

  // Trả kết quả chuẩn về cho web_CTV
  return res.status(201).json({
    success: true,
    message: 'Khách hàng đã được khởi tạo trên hệ thống Công ty A',
    data: {
      refcode: customerRecord.refcode
    }
  });
});

/* ==========================================================================
   2. API Kích hoạt gửi Webhook Khách Chốt (POST /mock/trigger-status)
   ========================================================================== */
app.post('/mock/trigger-status', async (req, res) => {
  const { refcode, status = 'SUCCESS', contractAmount = 10000000, durationMonths = 12 } = req.body;

  if (!refcode) {
    return res.status(400).json({ error: 'Vui lòng cung cấp refcode' });
  }

  const payload = {
    refcode,
    status,
    contractAmount,
    durationMonths
  };

  const result = await sendWebhook(process.env.CTV_WEBHOOK_STATUS_URL, payload);
  return res.json({ result, payloadSent: payload });
});

/* ==========================================================================
   3. API Kích hoạt gửi Webhook Thanh toán (POST /mock/trigger-payment)
   ========================================================================== */
app.post('/mock/trigger-payment', async (req, res) => {
  const {
    refcode,
    paymentId,
    installmentNo = 1,
    paidAmount = 4000000,
    adsAmount = 10000,
    paymentStatus = 'PAID'
  } = req.body;

  if (!refcode) {
    return res.status(400).json({ error: 'Vui lòng cung cấp refcode' });
  }

  // Tạo paymentId ngẫu nhiên nếu không truyền vào
  const finalPaymentId = paymentId || `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const payload = {
    refcode,
    paymentId: finalPaymentId,
    installmentNo,
    paidAmount,
    paidAt: new Date().toISOString(),
    adsAmount,
    paymentStatus
  };

  const result = await sendWebhook(process.env.CTV_WEBHOOK_PAYMENT_URL, payload);
  return res.json({ result, payloadSent: payload });
});

/* ==========================================================================
   4. Trang Dashboard Giả Lập Đơn Giản (UI để test thủ công trên trình duyệt)
   ========================================================================== */
app.get('/', (req, res) => {
  const customersList = Array.from(customersDb.values());
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Company A - Mock Server</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; background: #f4f6f9; }
        .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        button { background: #007bff; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; }
        button.pay { background: #28a745; }
        input { padding: 6px; margin-right: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      </style>
    </head>
    <body>
      <h1>🏢 Công ty A - Webhook & API Mock Server</h1>
      
      <div class="card">
        <h3>📋 Danh sách Refcode đã cấp (${customersList.length})</h3>
        <table>
          <tr><th>Refcode</th><th>Tên KH</th><th>SĐT</th><th>Dịch vụ</th><th>Thời gian</th></tr>
          ${customersList.map(c => `
            <tr>
              <td><b>${c.refcode}</b></td>
              <td>${c.customerName}</td>
              <td>${c.customerPhone}</td>
              <td>${c.service}</td>
              <td>${c.createdAt}</td>
            </tr>
          `).join('')}
        </table>
      </div>

      <div class="card">
        <h3>⚡ Giả lập gửi Webhook Hợp đồng SUCCESS</h3>
        <input type="text" id="statusRefcode" placeholder="Nhập refcode..." />
        <button onclick="triggerStatus()">Gửi Webhook Chốt Hợp Đồng</button>
      </div>

      <div class="card">
        <h3>💳 Giả lập gửi Webhook Thanh Toán (Payment)</h3>
        <input type="text" id="payRefcode" placeholder="Nhập refcode..." />
        <input type="text" id="payId" placeholder="Payment ID (Để trống sẽ tự sinh)..." />
        <button class="pay" onclick="triggerPayment()">Gửi Webhook Thanh Toán</button>
      </div>

      <script>
        async function triggerStatus() {
          const refcode = document.getElementById('statusRefcode').value;
          const res = await fetch('/mock/trigger-status', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ refcode })
          });
          const data = await res.json();
          alert('Kết quả gửi Webhook Status: ' + JSON.stringify(data));
        }

        async function triggerPayment() {
          const refcode = document.getElementById('payRefcode').value;
          const paymentId = document.getElementById('payId').value;
          const res = await fetch('/mock/trigger-payment', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ refcode, paymentId })
          });
          const data = await res.json();
          alert('Kết quả gửi Webhook Payment: ' + JSON.stringify(data));
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Company A Mock Server running at: http://localhost:${PORT}`);
});
