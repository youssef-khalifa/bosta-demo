# Bosta Integration Guide

Complete reference for integrating Bosta's delivery API into Magnum.
Covers: authentication, deliveries, pickups, AWB printing, webhooks, addresses, and the full Magnum kit flow.

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Setup](#2-setup)
3. [Authentication](#3-authentication)
4. [Address Format](#4-address-format)
5. [Delivery Orders](#5-delivery-orders)
6. [Pickup Requests](#6-pickup-requests)
7. [AWB (Air Waybill) Printing](#7-awb-air-waybill-printing)
8. [Webhooks](#8-webhooks)
9. [All API Endpoints](#9-all-api-endpoints)
10. [Delivery State Codes](#10-delivery-state-codes)
11. [Error Codes](#11-error-codes)
12. [Testing Step by Step](#12-testing-step-by-step)
13. [Cancellation Rules](#13-cancellation-rules)
14. [Magnum Kit Flow](#14-magnum-kit-flow)
15. [IP Whitelisting](#15-ip-whitelisting)

---

## 1. Prerequisites

- Node.js 18+
- Active Bosta business account at [app.bosta.co](https://app.bosta.co)
- **Active bundle/subscription** on the account — without it, order creation returns `errorCode: 8000002`
- At least one **pickup location** configured in your Bosta dashboard (needed to schedule pickups)

---

## 2. Setup

```bash
cd d:/projects/bosta-demo
npm install
cp .env.example .env
```

Fill in `.env`:

```env
BOSTA_API_KEY=<your key>
BOSTA_BASE_URL=https://app.bosta.co
BOSTA_BUSINESS_LOCATION_ID=
PORT=3333
WEBHOOK_SECRET=magnum-bosta-2024
```

Run:
```bash
npm run dev    # auto-restarts on file changes
npm start      # plain
```

> Always restart the server after editing `.env`.

---

## 3. Authentication

### Option A — API Key (recommended for server integrations)

Generate from: **Bosta Dashboard → Settings → API Integration → Request OTP → Create API key**

- Copy the key immediately — Bosta will not show it again
- Permission scopes:
  - **Read** — GET endpoints only
  - **Read/Write** — POST/PUT, no DELETE
  - **Full Access** — all including DELETE/terminate (use this)
- Keys can be enabled, disabled, or deleted at any time

Request headers:
```
Authorization: <your-api-key>
Content-Type: application/json
```

### Option B — Bearer Token (user login)

```
POST https://app.bosta.co/api/v2/users/login
Body: { "email": "...", "password": "..." }
Response: { "success": true, "token": "Bearer sdhgb..." }
```

Use as: `Authorization: Bearer <token>`

> For Magnum integration, always use the API Key — not the login token.

---

## 4. Address Format

All delivery and pickup addresses must follow this structure:

| Field | Required | Notes |
|---|---|---|
| `firstLine` | YES | Min 5 characters. Street + building details |
| `city` | YES | City name string |
| `cityId` | YES | From `GET /api/v2/cities` response |
| `districtId` | YES (or districtName) | From `GET /api/v2/cities/:cityId/districts` |
| `districtName` | YES (or districtId) | Free text — but `districtId` is more reliable |
| `secondLine` | no | Nearby landmark |
| `buildingNumber` | no | |
| `floor` | no | |
| `apartment` | no | |
| `zoneId` | no | From `GET /api/v2/cities/:cityId/zones` |
| `isWorkAddress` | no | Boolean, defaults to false |

**Important rules:**
- `districtId` takes precedence over `districtName` — always prefer it
- Bosta only covers Egypt (`countryId: EG`)
- Each district has `pickupAvailability` and `dropOffAvailability` flags — check these
- **Dokki is under Giza, not Cairo** — use the correct cityId per district

**Known IDs (production):**
- Cairo cityId: `FceDyHXwpSYYF9zGW`
- Cairo → Downtown Cairo districtId: `KV9fhG8LRCU`
- Cairo → Abdeen districtId: `zDdEL5RT52B`

Get all cities:
```
GET https://app.bosta.co/api/v2/cities
```
Get all districts for a city:
```
GET https://app.bosta.co/api/v2/cities/:cityId/districts
```
Get all districts at once:
```
GET https://app.bosta.co/api/v2/cities/getAllDistricts?countryId=EG
```

---

## 5. Delivery Orders

### Order Types

| Type | Code | Use Case |
|---|---|---|
| Deliver | `10` | Customer bought a kit — deliver to them |
| Cash Collection | `15` | Collect cash from customer |
| Exchange | `30` | Deliver new item, collect old one |
| CRP (Customer Return Pickup) | `25` | Customer wants to return an order |

For Magnum kits: always use type `10`.

### Create a delivery

```
POST https://app.bosta.co/api/v2/deliveries?apiVersion=1
Authorization: <api-key>
```

**Request body:**

```json
{
  "type": 10,
  "receiver": {
    "firstName": "Youssef",
    "lastName":  "Khalifa",
    "phone":     "+201001234567",
    "email":     "youssef@example.com"
  },
  "dropOffAddress": {
    "firstLine":    "12 Tahrir Square Apt 5",
    "city":         "Cairo",
    "cityId":       "FceDyHXwpSYYF9zGW",
    "districtId":   "KV9fhG8LRCU"
  },
  "specs": {
    "packageType":    "SMALL",
    "packageDetails": {
      "description": "Magnum Starter Kit",
      "itemsCount":  1
    }
  },
  "cod": 0,
  "notes": "Magnum Order ID: abc123",
  "businessLocationId": "<your-pickup-location-id>",
  "webhookUrl": "https://your-server/webhooks/bosta?secret=xxx",
  "webhookCustomHeaders": { "Authorization": "Basic abc123" }
}
```

**Field notes:**
- `packageType`: `SMALL` | `MEDIUM` | `LARGE` | `Light Bulky` | `Heavy Bulky`
- `packageDetails` must be an **object** with `description` (string) and `itemsCount` (number) — NOT a plain string
- `cod`: Cash on delivery in EGP. Use `0` for pre-paid orders. Max 30,000 EGP
- `businessLocationId`: optional — omit to use your default pickup location
- `goodsInfo`: optional — required only if you want insurance calculation
- `dropOffAddress` required for type 10; `pickupAddress` required for types 15 and 25

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "bosta-delivery-id",
    "trackingNumber": "3xxxxxx"
  }
}
```

Save both `_id` (as `bostaDeliveryId`) and `trackingNumber` on the Order document.

### Bulk create

```
POST https://app.bosta.co/api/v2/deliveries/bulk?apiVersion=1
Body: array of delivery objects (same shape as single create)
```

### Get a delivery

```
GET https://app.bosta.co/api/v2/deliveries/:deliveryId
```

### Search deliveries

```
POST https://app.bosta.co/api/v2/deliveries/search
```

### Update a delivery (after confirmation)

Only these fields can be changed after Bosta confirms the order:

```
PUT https://app.bosta.co/api/v2/deliveries/:deliveryId
Body: { "dropOffAddress": {...}, "cod": 0, "receiver": { "phone": "..." } }
```

### Cancel / Terminate a delivery

```
DELETE https://app.bosta.co/api/v2/deliveries/:deliveryId
```

Only works while `state.code === 10` (Created, not yet confirmed). See [Section 13](#13-cancellation-rules).

---

## 6. Pickup Requests

Since Magnum stores kits at its own location (not Bosta's warehouse), **you must create a pickup request** so Bosta sends a courier to collect the kit before delivering it.

### Flow for a kit order:
1. Customer places order → `createDelivery()` → get `deliveryId` + `trackingNumber`
2. Schedule a pickup → `createPickup()` with your `businessLocationId`
3. Bosta courier arrives at your location, collects the kit, delivers to customer

### Create a pickup request

```
POST https://app.bosta.co/api/v2/pickups
Authorization: <api-key>
```

**Request body:**

```json
{
  "scheduledDate":    "2024-05-10",
  "businessLocationId": "<your-pickup-location-id>",
  "contactPerson": {
    "name":         "Youssef Khalifa",
    "phone":        "+201001234567",
    "secPhone":     "+201009876543",
    "person_email": "youssef@magnum.com"
  },
  "numberOfParcels": 1,
  "packageType":     "Normal",
  "notes":           "1x Magnum Starter Kit"
}
```

**Field notes:**
- `scheduledDate`: `YYYY-MM-DD` format
- `packageType`: `Normal` | `Light Bulky` | `Heavy Bulky`
- `contactPerson.secPhone`: secondary phone (optional but recommended)
- `repeatedData`: optional recurring pickups `{ repeatedType: "Weekly", days: ["Sunday", "Monday"], startDate: "...", endDate: "..." }`

**Pickup scheduling rules:**
- No Fridays (error 1080)
- No past dates (error 1083)
- No holiday dates (error 2022)
- Only one pickup per day per location (error 2027)
- Must have a default contact at pickup location (error 1077)
- Cannot schedule after the daily cut-off time

**Response:**
```json
{ "success": true, "message": { "_id": "pickup-id" } }
```

### Get your pickup locations

```
GET https://app.bosta.co/api/v2/businesses/pickup-locations
```

Returns array of locations with `_id` — use this `_id` as `businessLocationId`.

### Other pickup operations

```
GET    https://app.bosta.co/api/v2/pickups              — list all pickups
GET    https://app.bosta.co/api/v2/pickups/:id          — get single pickup
PUT    https://app.bosta.co/api/v2/pickups/:id          — update pickup
DELETE https://app.bosta.co/api/v2/pickups/:id          — cancel pickup
GET    https://app.bosta.co/api/v2/pickups/available-dates — available scheduling dates
```

---

## 7. AWB (Air Waybill) Printing

An AWB is the shipping label attached to the package. Bosta's courier scans it at pickup and at each transit point.

**When to print:** After creating a delivery and before the pickup — print the AWB and attach it to the kit box.

**Formats:**
- `A4` — standard paper
- `A6` — Zebra thermal label printer (more common in logistics)

### Print AWB(s)

```
POST https://app.bosta.co/api/v2/deliveries/mass-awb
Authorization: <api-key>
```

**Request body:**

```json
{
  "trackingNumbers": "77873113,77873114",
  "requestedAwbType": "A6",
  "lang": "en"
}
```

**Field notes:**
- `trackingNumbers`: comma-separated string of tracking numbers
- Alternatively use `deliveryIds` instead of tracking numbers
- If both are sent, `trackingNumbers` takes precedence
- `lang`: `"ar"` or `"en"`
- `requestedAwbType`: `"A4"` or `"A6"`

**Response:**
- **≤ 50 AWBs**: base64-encoded PDF in response body — decode and save as `.pdf`
- **> 50 AWBs**: email sent to registered address with zip of PDFs (batches of 100)
- Max per request: **1,000 AWBs**

**Not printable:** CRP orders, Cash Collection orders, and orders with a finished/terminated status.

### Magnum AWB flow:
1. Order created → get `trackingNumber`
2. POST to `/mass-awb` with that tracking number
3. Decode base64 → PDF → print and attach to kit box
4. Schedule pickup — Bosta courier scans the AWB when collecting

---

## 8. Webhooks

Bosta sends a POST request to your webhook URL on every delivery state change.

### Setup — Option A: Dashboard
Settings → API Integration → Set Up Your Webhook → enter URL + optional auth header name/value

### Setup — Option B: Per-order (in create delivery body)
```json
{
  "webhookUrl": "https://your-server/webhooks/bosta?secret=xxx",
  "webhookCustomHeaders": { "Authorization": "Basic abc123" }
}
```

### Whitelist Bosta's IPs (important)
Bosta sends webhooks from:
- `34.89.199.241`
- `35.246.223.19`

Add both to your server's firewall allowlist.

### Event payload

```json
{
  "_id":                  "bosta-delivery-id",
  "trackingNumber":       "3xxxxxx",
  "state":                24,
  "type":                 "SEND",
  "cod":                  0,
  "timeStamp":            1715000000000,
  "isConfirmedDelivery":  false,
  "deliveryPromiseDate":  "10-05-2024",
  "exceptionReason":      "",
  "exceptionCode":        null,
  "businessReference":    "magnum-order-id",
  "numberOfAttempts":     1
}
```

**`type` values:** `SEND` | `EXCHANGE` | `CUSTOMER_RETURN_PICKUP` | `RTO` | `SIGN_AND_RETURN` | `FXF_SEND`

---

## 9. All API Endpoints

### Auth / User
| Method | Path | Description |
|---|---|---|
| POST | `/api/v2/users/login` | Login, get Bearer token |
| POST | `/api/v2/users/forget-password` | Forgot password |
| POST | `/api/v2/users/reset-password` | Reset password |
| POST | `/api/v2/users/refresh-token` | Refresh Bearer token |

### Cities / Geo
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/cities` | List all cities |
| GET | `/api/v2/cities/:cityId` | Get one city |
| GET | `/api/v2/cities/:cityId/districts` | Get districts for a city |
| GET | `/api/v2/cities/:cityId/zones` | Get zones for a city |
| GET | `/api/v2/cities/getAllDistricts?countryId=EG` | All districts at once |

### Deliveries
| Method | Path | Description |
|---|---|---|
| POST | `/api/v2/deliveries?apiVersion=1` | Create delivery |
| POST | `/api/v2/deliveries/bulk?apiVersion=1` | Bulk create deliveries |
| GET | `/api/v2/deliveries` | List deliveries |
| GET | `/api/v2/deliveries/:id` | Get delivery by ID |
| PUT | `/api/v2/deliveries/:id` | Update delivery |
| DELETE | `/api/v2/deliveries/:id` | Cancel/terminate delivery |
| POST | `/api/v2/deliveries/search` | Search deliveries |
| POST | `/api/v2/deliveries/mass-awb` | Print AWB(s) |
| GET | `/api/v2/deliveries/signedUrl` | Get signed URL |
| GET | `/api/v2/deliveries/analytics/total-deliveries` | Delivery analytics |

### Pickups
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/pickups` | List all pickup requests |
| POST | `/api/v2/pickups` | Create pickup request |
| GET | `/api/v2/pickups/search` | Search pickups |
| GET | `/api/v2/pickups/available-dates` | Available scheduling dates |
| GET | `/api/v2/pickups/creationValidity` | Check if pickup can be created today |
| GET | `/api/v2/pickups/:id` | Get pickup by ID |
| PUT | `/api/v2/pickups/:id` | Update pickup |
| DELETE | `/api/v2/pickups/:id` | Cancel pickup |
| GET | `/api/v2/pickups/:id/points` | Get pickup points |

### Pickup Locations
| Method | Path | Description |
|---|---|---|
| POST | `/api/v2/businesses/pickup-locations` | Create pickup location |
| GET | `/api/v2/businesses/pickup-locations` | List pickup locations |
| PUT | `/api/v2/businesses/pickup-locations/:id` | Update pickup location |
| GET | `/api/v2/businesses/pickup-locations/:id` | Get pickup location |
| DELETE | `/api/v2/businesses/pickup-locations/:id` | Delete pickup location |
| PUT | `/api/v2/businesses/pickup-locations/:id/default` | Set as default |

### Pricing
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/pricing/calculator` | Calculate delivery price |
| GET | `/api/v2/pricing/shipment-calculator` | Shipment price estimate |
| GET | `/api/v2/pricing/insuranceFeeEstimate` | Insurance fee estimate |

### Business
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/businesses/profile` | Get business profile |
| GET | `/api/v2/businesses/transactions` | Get transactions |

### Products
| Method | Path | Description |
|---|---|---|
| GET | `/api/v2/products` | List business products |

---

## 10. Delivery State Codes

| Code | State | Action |
|---|---|---|
| 10 | Pickup Requested | ✅ Can still cancel via API |
| 11 | Waiting for Route | ❌ Too late to cancel |
| 20 | Route Assigned | |
| 21 | Picked Up (Send/Exchange) | Courier has the kit |
| 22 | Picking Up (CRP/Exchange) | |
| 23 | Picked Up (CRP/Exchange) | |
| 24 | Received at Warehouse | |
| 25 | Fulfilled | |
| 30 | In Transit | |
| 40 | Picking Up (Cash Collection) | |
| 41 | Picked Up (heading to customer) | |
| **45** | **Delivered** | ✅ Mark order fulfilled |
| **46** | **Returned to Business** | ⚠️ Notify CS |
| **47** | **Exception** | ⚠️ Check exceptionCode |
| **48** | **Terminated** | Cancelled by Bosta |
| **49** | **Cancelled** | Cancelled by business |
| 60 | Returned to Stock | |
| 100 | Lost | ⚠️ File claim |
| 101 | Damaged | ⚠️ File claim |
| 102 | Investigation | |
| 103 | Awaiting Action | |
| 104 | Archived | |
| 105 | On Hold | |

### Exception Codes (state 47)

**Forward (delivery failed):**
1-Not at address, 2-Address changed, 3-Postponed, 4-Open shipment cancellation, 5-Unclear address/phone, 6-Sender cancellation, 7-Not answering, 8-Refused, 12-Outside coverage, 13-Unclear address, 14-Wrong phone, 100-Bad weather, 101-Suspicious consignee

**Return (return failed):**
20-Business address changed, 21-Postponed, 22-Unclear data, 23-Not answering, 24-Refused, 25-Not at address, 26-Damaged, 27-Empty, 28-Incomplete, 29-Wrong business, 30-Opened improperly, 100-Bad weather, 101-Suspicious consignee

---

## 11. Error Codes

| Code | Message | Fix |
|---|---|---|
| 1028 | Invalid authorization token or API key | Check key; restart server; key must match environment (prod vs staging) |
| 777 | Validation error | `packageDetails` must be object; `districtId` must be real ID |
| 3001-3009 | Location/address validation failures | Check cityId, districtId, firstLine length |
| 3003 | District Not Found | Use `districtId` from `/cities/:id/districts`, not free text |
| 3005 | CRP orders require refund COD | Add `cod` field for return orders |
| 3006 | Cash Collection requires COD | Add `cod` amount |
| 3007-3008 | Amount limit violation | Max COD is 30,000 EGP |
| 1080 | No Fridays for pickup | Choose Mon–Thu or Sat–Sun |
| 1083 | No past dates for pickup | Use today or future date |
| 2022 | Holiday date blocked | Choose a non-holiday |
| 2027 | One pickup per day limit | Already have a pickup scheduled today |
| 1077 | No default contact at pickup location | Set contact person in pickup location settings |
| 8000002 | Active bundle subscription required | Activate a Bosta plan |

---

## 12. Testing Step by Step

### Step 1 — Verify key + get cities
```
GET http://localhost:3333/geo/cities
```
Confirm response has city list. Cairo ID = `FceDyHXwpSYYF9zGW`

### Step 2 — Get valid district IDs
```
GET http://localhost:3333/geo/districts/FceDyHXwpSYYF9zGW
```
Pick any `districtId` (e.g. `KV9fhG8LRCU` for Downtown Cairo)

### Step 3 — Get your pickup location ID
```
GET http://localhost:3333/deliveries   (or hit Bosta dashboard)
```
Or call `GET https://app.bosta.co/api/v2/businesses/pickup-locations` — copy the `_id`

### Step 4 — Create a test kit delivery
```
POST http://localhost:3333/demo/kit-order
{
  "customer": { "firstName": "Youssef", "lastName": "Khalifa", "phone": "+201001234567" },
  "address": { "firstLine": "12 Tahrir Square Apt 5", "city": "Cairo", "cityId": "FceDyHXwpSYYF9zGW", "districtId": "KV9fhG8LRCU" },
  "kitName": "Magnum Starter Kit",
  "orderId": "test-order-001"
}
```
Save the returned `bostaDeliveryId` and `trackingNumber`.

### Step 5 — Print the AWB
```
POST http://localhost:3333/awb
{ "trackingNumbers": "<trackingNumber>", "type": "A6", "lang": "en" }
```
Returns base64 PDF — decode and print, attach to package.

### Step 6 — Schedule a pickup
```
POST http://localhost:3333/pickups
{
  "scheduledDate": "2024-05-10",
  "businessLocationId": "<your-location-id>",
  "contactPerson": { "name": "Youssef Khalifa", "phone": "+201001234567", "secPhone": "", "person_email": "y@magnum.com" },
  "numberOfParcels": 1,
  "packageType": "Normal"
}
```

### Step 7 — Track the delivery
```
GET http://localhost:3333/deliveries/track/<trackingNumber>
```

### Step 8 — Cancel (while state = 10 only)
```
DELETE http://localhost:3333/deliveries/<bostaDeliveryId>
```

### Step 9 — Test webhook manually
```
POST http://localhost:3333/webhooks/bosta?secret=magnum-bosta-2024
{ "_id": "<bostaDeliveryId>", "trackingNumber": "3xxx", "state": 45 }
```
Server logs the event. State 45 = delivered → mark order fulfilled.

---

## 13. Cancellation Rules

| State | Can cancel via API? | What to do instead |
|---|---|---|
| State 10 — Created | ✅ YES — `DELETE /deliveries/:id` | Immediate, works |
| State 11+ — Confirmed | ❌ NO | Patch address/phone only |
| Out for delivery | ❌ NO | Call Bosta support |
| Delivered | ❌ NO | Create CRP order (type 25) for return |

**No hard documented time window.** Bosta confirms orders same business day.
Safe rule: **cancel within 30–60 minutes** of creation.
Always check `state` from `GET /deliveries/:id` before attempting cancel — if not 10, don't try.

---

## 14. Magnum Kit Flow

This is the full end-to-end flow for when a customer buys a kit:

```
Customer checks out
  │
  ├─► initiateCartPayment() creates Order in MongoDB
  │     └─► order.items contains kit(s) with address
  │
  ├─► createBostaDelivery(order, customer)
  │     └─► POST /api/v2/deliveries?apiVersion=1
  │           └─► save bostaDeliveryId + trackingNumber on Order
  │
  ├─► printAWB(trackingNumber)
  │     └─► POST /api/v2/deliveries/mass-awb
  │           └─► base64 PDF → print → attach to kit box
  │
  ├─► schedulePickup(businessLocationId, date)
  │     └─► POST /api/v2/pickups
  │           └─► Bosta courier comes to your location
  │
  ├─► Bosta picks up kit (state 21)
  │
  ├─► Bosta delivers to customer (state 45)
  │     └─► webhook fires → update order.bostaStatus = "Delivered"
  │           └─► mark order fulfilled
  │
  └─► If delivery fails (state 47/46)
        └─► webhook fires → notify CS team
```

### Fields to add to Magnum Orders collection:

```js
{ name: 'bostaDeliveryId',    type: 'text' },
{ name: 'bostaTrackingNumber', type: 'text' },
{ name: 'bostaStatus',        type: 'text' },
```

### Webhook handler (Next.js route):

```js
// src/app/api/bosta-webhook/route.js
export async function POST(req) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (secret !== process.env.BOSTA_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });

  const event = await req.json();
  const order = await Orders.findByBostaId(event._id);
  if (!order) return new Response('OK');

  await Orders.update(order.id, { bostaStatus: String(event.state) });

  if (event.state === 45) await Orders.update(order.id, { status: 'fulfilled' });
  if (event.state === 47 || event.state === 46) { /* notify CS */ }

  return new Response('OK');
}
```

---

## 15. IP Whitelisting

If your server has a firewall, whitelist these Bosta IPs to allow webhook delivery:

```
34.89.199.241
35.246.223.19
```
