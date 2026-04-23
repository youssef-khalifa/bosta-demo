import 'dotenv/config';
import express from 'express';
import {
  createDelivery,
  getDelivery,
  cancelDelivery,
  updateDelivery,
  listDeliveries,
  trackDelivery,
  getCities,
  getDistricts,
} from './bosta.client.js';

const app  = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());

// ─── Utility ──────────────────────────────────────────────────────────────────

const ok  = (res, data)         => res.json({ ok: true,  data });
const err = (res, e, status)    => res.status(status || e.status || 500).json({
  ok: false,
  message: e.message,
  bostaCode: e.bostaCode,
  raw: e.raw,
});

// ─── GEO ──────────────────────────────────────────────────────────────────────

// GET /geo/cities
// Returns the list of Egyptian cities with their cityIds (needed for addresses)
app.get('/geo/cities', async (req, res) => {
  try {
    const data = await getCities();
    ok(res, data);
  } catch (e) { err(res, e); }
});

// GET /geo/districts/:cityId
app.get('/geo/districts/:cityId', async (req, res) => {
  try {
    const data = await getDistricts(req.params.cityId);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// ─── DELIVERIES ───────────────────────────────────────────────────────────────

// GET /deliveries
// List all deliveries (paginated: ?page=1&limit=20)
app.get('/deliveries', async (req, res) => {
  try {
    const data = await listDeliveries(req.query.page, req.query.limit);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// GET /deliveries/:id
app.get('/deliveries/:id', async (req, res) => {
  try {
    const data = await getDelivery(req.params.id);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// GET /deliveries/track/:trackingNumber
app.get('/deliveries/track/:trackingNumber', async (req, res) => {
  try {
    const data = await trackDelivery(req.params.trackingNumber);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// POST /deliveries
// Body: the full order payload (see bosta.client.js createDelivery docs)
// Example body is in README.md
app.post('/deliveries', async (req, res) => {
  try {
    const webhookUrl = req.body.webhookUrl
      || `${req.protocol}://${req.get('host')}/webhooks/bosta?secret=${process.env.WEBHOOK_SECRET}`;

    const data = await createDelivery({ ...req.body, webhookUrl });
    ok(res, data);
  } catch (e) { err(res, e); }
});

// DELETE /deliveries/:id
// Cancel a delivery — only possible before it is confirmed/dispatched
app.delete('/deliveries/:id', async (req, res) => {
  try {
    const data = await cancelDelivery(req.params.id);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// PATCH /deliveries/:id
// Update allowed fields: dropOffAddress, cod, receiver.phone
app.patch('/deliveries/:id', async (req, res) => {
  try {
    const data = await updateDelivery(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e); }
});

// ─── WEBHOOK RECEIVER ─────────────────────────────────────────────────────────

// POST /webhooks/bosta?secret=xxx
// Bosta posts state-change events here.
// Validate the secret query param, then handle the event.
app.post('/webhooks/bosta', (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const event = req.body;
  console.log('[webhook] Bosta event received:');
  console.log(JSON.stringify(event, null, 2));

  // event shape (approximate):
  // {
  //   _id: "bosta-delivery-id",
  //   trackingNumber: "3xxxxxx",
  //   state: { code: 24, value: "Out for delivery" },
  //   receiver: { ... },
  //   dropOffAddress: { ... },
  //   updatedAt: "2024-..."
  // }

  // TODO: in magnum integration —
  //   1. Find the Order by event._id (stored as bostaDeliveryId)
  //   2. Update order.bostaStatus = event.state.value
  //   3. If state.code === 45 (delivered): mark order as fulfilled
  //   4. If state.code === 46 (returned/failed): notify CS

  res.sendStatus(200);
});

// ─── DEMO: simulate a kit order ───────────────────────────────────────────────

// POST /demo/kit-order
// Simulates what magnum will do when a kit is purchased:
// creates a Bosta delivery with the customer's checkout address.
//
// Body example:
// {
//   "customer": { "firstName": "Youssef", "lastName": "Khalifa", "phone": "+201001234567" },
//   "address":  { "firstLine": "12 Tahrir St", "city": "Cairo", "cityId": "5f9a5f1b23523b3ac43ae88b" },
//   "kitName":  "Starter Kit",
//   "orderId":  "mongo-order-id-here"
// }
app.post('/demo/kit-order', async (req, res) => {
  const { customer, address, kitName, orderId } = req.body;

  if (!customer || !address) {
    return res.status(400).json({ ok: false, message: 'customer and address are required' });
  }

  try {
    const webhookUrl = `${req.protocol}://${req.get('host')}/webhooks/bosta?secret=${process.env.WEBHOOK_SECRET}`;

    const delivery = await createDelivery({
      receiver: customer,
      dropOffAddress: address,
      specs: {
        packageType:    'Parcel',
        packageDetails: kitName || 'Kit',
        numberOfPieces: 1,
      },
      cod:   0,
      notes: orderId ? `Magnum Order ID: ${orderId}` : '',
      webhookUrl,
    });

    // In magnum you'd do:
    // await Orders.update(orderId, { bostaDeliveryId: delivery._id, bostaTrackingNumber: delivery.trackingNumber })

    ok(res, {
      message:         'Delivery created successfully',
      bostaDeliveryId: delivery._id,
      trackingNumber:  delivery.trackingNumber,
      estimatedDelivery: delivery.estimatedDeliveryDate,
      fullDelivery:    delivery,
    });
  } catch (e) { err(res, e); }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚚 Bosta demo server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET    /geo/cities`);
  console.log(`  GET    /geo/districts/:cityId`);
  console.log(`  GET    /deliveries`);
  console.log(`  GET    /deliveries/:id`);
  console.log(`  GET    /deliveries/track/:trackingNumber`);
  console.log(`  POST   /deliveries              — create delivery`);
  console.log(`  DELETE /deliveries/:id          — cancel delivery`);
  console.log(`  PATCH  /deliveries/:id          — update address/COD/phone`);
  console.log(`  POST   /demo/kit-order          — simulate kit purchase`);
  console.log(`  POST   /webhooks/bosta          — receive Bosta state events`);
  console.log(`\nEnvironment:`);
  console.log(`  BOSTA_BASE_URL = ${process.env.BOSTA_BASE_URL || '(not set)'}`);
  console.log(`  BOSTA_API_KEY  = ${process.env.BOSTA_API_KEY  ? '***set***' : '(not set)'}`);
});
