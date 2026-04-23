# Bosta Demo Server

Standalone Express server for testing the Bosta delivery API before integrating into Magnum.

---

## Prerequisites

- Node.js 18+
- An active **Bosta account** at [app.bosta.co](https://app.bosta.co)
- The account must have an **active bundle/subscription** — without it, order creation returns `errorCode: 8000002`

---

## 1. Setup

```bash
cd d:/projects/bosta-demo
npm install
cp .env.example .env
```

Open `.env` and fill in:

```env
BOSTA_API_KEY=<your key>
BOSTA_BASE_URL=https://app.bosta.co
BOSTA_BUSINESS_LOCATION_ID=
PORT=3333
WEBHOOK_SECRET=magnum-bosta-2024
```

### Getting your API key

1. Log into [app.bosta.co](https://app.bosta.co)
2. Go to **Settings → API Integration**
3. Click **Request OTP** → enter the OTP sent to your phone
4. Click **Create API key** → give it a name → select **Full Access** scope
5. Copy the key immediately — **Bosta will not show it again**

> **Important:** Your API key only works on the environment it was created in.
> A key from `app.bosta.co` (production) will NOT work on `stg-app.bosta.co` (staging) and vice versa.
> Always set `BOSTA_BASE_URL` to match where the key was created.

---

## 2. Run the server

```bash
npm run dev    # auto-restarts on file changes (Node 18+)
npm start      # plain run
```

You should see:
```
🚚 Bosta demo server running on http://localhost:3333
```

> **Always restart the server after editing `.env`** — environment variables are read at startup only.

---

## 3. Known field constraints (learned from testing)

These are not documented clearly in Bosta's docs but were confirmed by actual API responses:

| Field | Wrong | Correct |
|---|---|---|
| `specs.packageDetails` | `"Magnum Starter Kit"` (string) | `{ "description": "Magnum Starter Kit" }` (object) |
| `dropOffAddress.districtName` | `"Dokki"` (free text) | Use `districtId` from `/geo/districts/:cityId` |
| `cityId` | any string | Must come from `GET /geo/cities` response |
| Base URL for API key | staging if key created on prod | Must match where key was created |

---

## 4. Testing step by step

### Step 1 — Verify the API key works

```
GET http://localhost:3333/geo/cities
```

Expected: a list of Egyptian cities with `_id`, `name`, `code` fields.
If you get `Invalid authorization token` → key is wrong or server wasn't restarted after `.env` was filled.

Known Cairo ID: **`FceDyHXwpSYYF9zGW`**

---

### Step 2 — Get valid district IDs for Cairo

```
GET http://localhost:3333/geo/districts/FceDyHXwpSYYF9zGW
```

Pick any district from the response. Use its `districtId` field (not `districtName`).

Sample Cairo districts:

| districtId | districtName |
|---|---|
| `KV9fhG8LRCU` | Downtown Cairo |
| `zDdEL5RT52B` | Abdeen |
| `rmtiGnvfJSH` | Bab ElLouq |
| `Iy7-lFD0BE0` | 15 May |

> **Note:** Dokki is under **Giza**, not Cairo. If the customer is in Dokki, use the Giza cityId instead.

---

### Step 3 — Create a test delivery (kit order simulation)

```
POST http://localhost:3333/demo/kit-order
Content-Type: application/json

{
  "customer": {
    "firstName": "Youssef",
    "lastName":  "Khalifa",
    "phone":     "+201001234567"
  },
  "address": {
    "firstLine":  "12 Tahrir Square Apt 5",
    "city":       "Cairo",
    "cityId":     "FceDyHXwpSYYF9zGW",
    "districtId": "KV9fhG8LRCU"
  },
  "kitName":  "Magnum Starter Kit",
  "orderId":  "test-order-001"
}
```

Expected response:
```json
{
  "ok": true,
  "data": {
    "bostaDeliveryId":    "abc123xyz",
    "trackingNumber":     "3xxxxxx",
    "estimatedDelivery":  "2024-05-10",
    "fullDelivery":       { ... }
  }
}
```

Save the `bostaDeliveryId` and `trackingNumber` — you need them for the next steps.

---

### Step 4 — Get the delivery details

```
GET http://localhost:3333/deliveries/<bostaDeliveryId>
```

Look at `state.code` in the response to know if you can still cancel:
- `10` = Created / not yet confirmed → **can cancel**
- anything else → **too late to cancel via API**

---

### Step 5 — Track by tracking number

```
GET http://localhost:3333/deliveries/track/<trackingNumber>
```

---

### Step 6 — Cancel the delivery (while state.code = 10)

```
DELETE http://localhost:3333/deliveries/<bostaDeliveryId>
```

Works only before Bosta confirms the order. Safe window: **within 30–60 minutes** of creation.

---

### Step 7 — Update an already-confirmed delivery

Only three fields can be changed after confirmation:

```
PATCH http://localhost:3333/deliveries/<bostaDeliveryId>
Content-Type: application/json

{
  "dropOffAddress": {
    "firstLine": "New address street",
    "cityId":    "FceDyHXwpSYYF9zGW",
    "districtId": "KV9fhG8LRCU"
  },
  "receiver": { "phone": "+201009876543" },
  "cod": 0
}
```

---

### Step 8 — Test the webhook receiver

Bosta will POST to your webhook URL on every status change. The URL is:
```
http://localhost:3333/webhooks/bosta?secret=magnum-bosta-2024
```

To test it manually (simulate a Bosta event):
```
POST http://localhost:3333/webhooks/bosta?secret=magnum-bosta-2024
Content-Type: application/json

{
  "_id": "abc123xyz",
  "trackingNumber": "3xxxxxx",
  "state": { "code": 24, "value": "Out for delivery" },
  "updatedAt": "2024-05-09T10:00:00Z"
}
```

The server will log the event to the console.

> For real Bosta webhooks to reach your local machine you need a tunnel like [ngrok](https://ngrok.com):
> ```bash
> ngrok http 3333
> # gives you: https://abc123.ngrok.io
> # set BOSTA_WEBHOOK_BASE=https://abc123.ngrok.io in .env (optional, server builds URL from request host)
> ```

---

## 5. All endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/geo/cities` | List all Egyptian cities with cityIds |
| GET | `/geo/districts/:cityId` | List districts for a city (get districtIds) |
| GET | `/deliveries` | List all deliveries (`?page=1&limit=20`) |
| GET | `/deliveries/:id` | Get delivery by Bosta ID |
| GET | `/deliveries/track/:trackingNumber` | Track by tracking number |
| POST | `/deliveries` | Create a delivery (full payload) |
| DELETE | `/deliveries/:id` | Cancel a delivery |
| PATCH | `/deliveries/:id` | Update address / phone / COD |
| POST | `/demo/kit-order` | Simulate a Magnum kit purchase |
| POST | `/webhooks/bosta` | Receive Bosta state-change events |

---

## 6. Delivery status lifecycle

```
Created (10)
  └─► Picked up from warehouse (20)
        └─► Received at hub (22)
              └─► Out for delivery (24)
                    ├─► Delivered ✓ (45)   → mark order fulfilled
                    └─► Failed / Returned ✗ (46)  → notify CS
                          └─► Cancelled (47)
```

Full state code reference:

| Code | Meaning | Can cancel? |
|---|---|---|
| 10 | Created / Pending | YES via API |
| 20 | Picked up | NO |
| 22 | At hub / In transit | NO |
| 24 | Out for delivery | NO |
| 45 | Delivered | NO |
| 46 | Failed / Returned | NO |
| 47 | Cancelled | — |

---

## 7. Cancellation rules

| Delivery state | Can cancel via API? | What to do |
|---|---|---|
| Created (state 10) | YES — `DELETE /deliveries/:id` | Immediate, no fee |
| Confirmed / Dispatched | NO | Patch address or phone only |
| Out for delivery | NO | Call Bosta support |
| Delivered | NO | Create a return pickup (CRP order, type 25) |

**No hard time window is documented by Bosta.** In practice, Bosta confirms orders the same business day. If a customer cancels, act within **30–60 minutes** of the order being created to guarantee the API cancel works. After that, check `state.code` first — if it's no longer `10`, escalate to Bosta support.

---

## 8. Error codes reference

| errorCode | Message | Fix |
|---|---|---|
| 1028 | Invalid authorization token or API key | Check API key; restart server after editing .env; confirm key matches environment (prod vs staging) |
| 777 | Validation error | Check field shapes — `packageDetails` must be an object, `districtId` must be a real ID |
| 3003 | District Not Found | Use `districtId` from `/geo/districts/:cityId`, not a free-text `districtName` |
| 8000002 | Active bundle subscription required | Account needs an active Bosta plan — contact Bosta sales |

---

## 9. Magnum integration plan (when ready)

1. After `initiateCartPayment` creates the order and items contain kits → call `createBostaDelivery(order, user)`
2. Add `bostaDeliveryId` and `bostaTrackingNumber` fields to `Orders.js` in Payload
3. The `address` field (street, city, country) is already being added to Orders as part of the checkout plan
4. Show `bostaTrackingNumber` on the thank-you page for kit orders
5. Add a `/api/bosta-webhook` route in Next.js (same logic as the demo webhook handler):
   - Validate secret
   - Find order by `bostaDeliveryId`
   - Update `order.bostaStatus`
   - On state 45 (delivered): mark order fulfilled
   - On state 46 (failed): notify CS team
