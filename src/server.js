import 'dotenv/config';
import express from 'express';
import {
  getCities,
  getDistricts,
  getAllDistricts,
  getPickupLocations,
  createDelivery,
  getDelivery,
  trackDelivery,
  cancelDelivery,
  updateDelivery,
  listDeliveries,
  printAWB,
  createPickup,
  getPickup,
  listPickups,
  cancelPickup,
  getAvailablePickupDates,
} from './bosta.client.js';

const app  = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());

const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e)    => res.status(e.status || 500).json({
  ok: false,
  message:   e.message,
  bostaCode: e.bostaCode,
  raw:       e.raw,
});

// ─── GEO ──────────────────────────────────────────────────────────────────────

// GET /geo/cities
app.get('/geo/cities', async (req, res) => {
  try { ok(res, await getCities()); }
  catch (e) { err(res, e); }
});

// GET /geo/districts/:cityId
app.get('/geo/districts/:cityId', async (req, res) => {
  try { ok(res, await getDistricts(req.params.cityId)); }
  catch (e) { err(res, e); }
});

// GET /geo/districts  — all districts at once
app.get('/geo/districts', async (req, res) => {
  try { ok(res, await getAllDistricts()); }
  catch (e) { err(res, e); }
});

// ─── PICKUP LOCATIONS ─────────────────────────────────────────────────────────

// GET /pickup-locations  — get your business pickup locations + their IDs
app.get('/pickup-locations', async (req, res) => {
  try { ok(res, await getPickupLocations()); }
  catch (e) { err(res, e); }
});

// ─── DELIVERIES ───────────────────────────────────────────────────────────────

// GET /deliveries
app.get('/deliveries', async (req, res) => {
  try { ok(res, await listDeliveries(req.query.page, req.query.limit)); }
  catch (e) { err(res, e); }
});

// GET /deliveries/:id
app.get('/deliveries/:id', async (req, res) => {
  try { ok(res, await getDelivery(req.params.id)); }
  catch (e) { err(res, e); }
});

// GET /deliveries/track/:trackingNumber
app.get('/deliveries/track/:trackingNumber', async (req, res) => {
  try { ok(res, await trackDelivery(req.params.trackingNumber)); }
  catch (e) { err(res, e); }
});

// POST /deliveries  — create a delivery (full payload)
app.post('/deliveries', async (req, res) => {
  try {
    const webhookUrl = req.body.webhookUrl
      || `${req.protocol}://${req.get('host')}/webhooks/bosta?secret=${process.env.WEBHOOK_SECRET}`;
    ok(res, await createDelivery({ ...req.body, webhookUrl }));
  } catch (e) { err(res, e); }
});

// DELETE /deliveries/:id  — cancel (only while state = 10)
app.delete('/deliveries/:id', async (req, res) => {
  try { ok(res, await cancelDelivery(req.params.id)); }
  catch (e) { err(res, e); }
});

// PATCH /deliveries/:id  — update address / phone / COD (after confirmation)
app.patch('/deliveries/:id', async (req, res) => {
  try { ok(res, await updateDelivery(req.params.id, req.body)); }
  catch (e) { err(res, e); }
});

// ─── AWB PRINTING ─────────────────────────────────────────────────────────────

// POST /awb
// Body: { trackingNumbers: "3111,3222", type: "A6", lang: "en" }
// Returns base64 PDF for ≤50 AWBs; triggers email for >50
app.post('/awb', async (req, res) => {
  const { trackingNumbers, type = 'A6', lang = 'en' } = req.body;
  if (!trackingNumbers) return res.status(400).json({ ok: false, message: 'trackingNumbers is required' });
  try { ok(res, await printAWB(trackingNumbers, type, lang)); }
  catch (e) { err(res, e); }
});

// ─── PICKUPS ──────────────────────────────────────────────────────────────────

// GET /pickups
app.get('/pickups', async (req, res) => {
  try { ok(res, await listPickups()); }
  catch (e) { err(res, e); }
});

// GET /pickups/available-dates
app.get('/pickups/available-dates', async (req, res) => {
  try { ok(res, await getAvailablePickupDates()); }
  catch (e) { err(res, e); }
});

// GET /pickups/:id
app.get('/pickups/:id', async (req, res) => {
  try { ok(res, await getPickup(req.params.id)); }
  catch (e) { err(res, e); }
});

// POST /pickups  — schedule a pickup (Bosta courier comes to your location)
// Body: { scheduledDate, businessLocationId, contactPerson, numberOfParcels, packageType, notes }
app.post('/pickups', async (req, res) => {
  try { ok(res, await createPickup(req.body)); }
  catch (e) { err(res, e); }
});

// DELETE /pickups/:id  — cancel a pickup
app.delete('/pickups/:id', async (req, res) => {
  try { ok(res, await cancelPickup(req.params.id)); }
  catch (e) { err(res, e); }
});

// ─── DEMO: simulate a full kit order ─────────────────────────────────────────

// POST /demo/kit-order
// Simulates what Magnum does when a customer buys a kit:
//   1. Creates a Bosta delivery
//   2. Returns deliveryId + trackingNumber to save on the Order document
//
// Body:
// {
//   "customer":  { "firstName", "lastName", "phone", "email?" },
//   "address":   { "firstLine", "city", "cityId", "districtId" },
//   "kitName":   "Magnum Starter Kit",
//   "orderId":   "mongo-order-id"
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
        packageType:    'SMALL',
        packageDetails: { description: kitName || 'Kit', itemsCount: 1 },
      },
      cod:   0,
      notes: orderId ? `Magnum Order ID: ${orderId}` : '',
      webhookUrl,
    });

    // In Magnum, after this you'd do:
    // await Orders.update(orderId, {
    //   bostaDeliveryId:     delivery.data._id,
    //   bostaTrackingNumber: delivery.data.trackingNumber,
    // })

    ok(res, {
      message:         'Delivery created. Next: print AWB, then schedule a pickup.',
      bostaDeliveryId: delivery.data?._id    || delivery._id,
      trackingNumber:  delivery.data?.trackingNumber || delivery.trackingNumber,
      nextSteps: {
        printAWB:       `POST /awb  { "trackingNumbers": "${delivery.data?.trackingNumber || delivery.trackingNumber}", "type": "A6" }`,
        schedulePickup: 'POST /pickups  { scheduledDate, businessLocationId, contactPerson, ... }',
        getLocationId:  'GET /pickup-locations',
      },
      fullResponse: delivery,
    });
  } catch (e) { err(res, e); }
});

// ─── WEBHOOK RECEIVER ─────────────────────────────────────────────────────────

// POST /webhooks/bosta?secret=xxx
// Bosta fires this on every state change.
// Validate secret, then handle the event.
app.post('/webhooks/bosta', (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const event = req.body;
  console.log('\n[webhook] Bosta event:');
  console.log(JSON.stringify(event, null, 2));

  // State code meanings (key ones):
  // 10  = Created/Pickup Requested
  // 21  = Picked up by courier
  // 24  = Received at warehouse
  // 45  = DELIVERED ✓ → mark order fulfilled
  // 46  = Returned to business ✗
  // 47  = Exception ✗ → check event.exceptionCode
  // 49  = Cancelled

  // In Magnum integration:
  // const order = await Orders.findOne({ where: { bostaDeliveryId: { equals: event._id } } })
  // await Orders.update(order.id, { bostaStatus: String(event.state) })
  // if (event.state === 45) await Orders.update(order.id, { status: 'fulfilled' })
  // if (event.state === 46 || event.state === 47) { notify CS }

  res.sendStatus(200);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚚 Bosta demo server on http://localhost:${PORT}\n`);
  console.log('GEO');
  console.log('  GET  /geo/cities');
  console.log('  GET  /geo/districts/:cityId');
  console.log('  GET  /geo/districts              (all at once)');
  console.log('  GET  /pickup-locations           (get your businessLocationId)');
  console.log('\nDELIVERIES');
  console.log('  GET  /deliveries');
  console.log('  GET  /deliveries/:id');
  console.log('  GET  /deliveries/track/:trackingNumber');
  console.log('  POST /deliveries                 (create)');
  console.log('  DELETE /deliveries/:id           (cancel — state 10 only)');
  console.log('  PATCH /deliveries/:id            (update address/phone/COD)');
  console.log('\nAWB');
  console.log('  POST /awb                        (print shipping label)');
  console.log('\nPICKUPS');
  console.log('  GET  /pickups');
  console.log('  GET  /pickups/available-dates');
  console.log('  GET  /pickups/:id');
  console.log('  POST /pickups                    (schedule courier pickup)');
  console.log('  DELETE /pickups/:id              (cancel pickup)');
  console.log('\nDEMO');
  console.log('  POST /demo/kit-order             (simulate Magnum kit purchase)');
  console.log('\nWEBHOOK');
  console.log('  POST /webhooks/bosta             (receive Bosta state events)');
  console.log(`\nEnv: ${process.env.BOSTA_BASE_URL} | key: ${process.env.BOSTA_API_KEY ? '***set***' : 'NOT SET'}`);
});
