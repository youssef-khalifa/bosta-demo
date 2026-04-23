import fetch from 'node-fetch';

const BASE_URL = process.env.BOSTA_BASE_URL || 'https://app.bosta.co';
const API_KEY  = process.env.BOSTA_API_KEY;

if (!API_KEY) {
  console.warn('[bosta] WARNING: BOSTA_API_KEY is not set. Requests will fail.');
}

const headers = () => ({
  'Authorization': API_KEY,
  'Content-Type': 'application/json',
});

// path must include version prefix: '/v1/...' or '/v2/...'
async function request(method, path, body) {
  const url = `${BASE_URL}/api${path}`;
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(json.message || `Bosta ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.bostaCode = json.errorCode;
    err.raw = json;
    throw err;
  }
  return json;
}

// ─── Geo ─────────────────────────────────────────────────────────────────────

export const getCities = () =>
  request('GET', '/v2/cities');

export const getDistricts = (cityId) =>
  request('GET', `/v2/cities/${cityId}/districts`);

export const getAllDistricts = () =>
  request('GET', '/v2/cities/getAllDistricts?countryId=EG');

export const getZones = (cityId) =>
  request('GET', `/v2/cities/${cityId}/zones`);

// ─── Pickup Locations ─────────────────────────────────────────────────────────

export const getPickupLocations = () =>
  request('GET', '/v2/businesses/pickup-locations');

// ─── Deliveries ───────────────────────────────────────────────────────────────

/**
 * Create a standard deliver-to-customer shipment (type 10).
 *
 * @param {object} params
 * @param {object} params.receiver           - { firstName, lastName, phone, email? }
 * @param {object} params.dropOffAddress     - { firstLine, city, cityId, districtId }
 * @param {object} params.specs              - { packageType, packageDetails: { description, itemsCount } }
 * @param {number} params.cod                - Cash on delivery in EGP (0 = pre-paid)
 * @param {string} params.notes              - Optional notes
 * @param {string} params.webhookUrl         - Webhook URL for state updates
 * @param {string} params.businessLocationId - Your pickup location ID (omit = default)
 */
export const createDelivery = (params) => {
  const {
    receiver,
    dropOffAddress,
    specs = {},
    cod = 0,
    notes = '',
    webhookUrl,
    businessLocationId = process.env.BOSTA_BUSINESS_LOCATION_ID || undefined,
  } = params;

  const body = {
    type: 10,
    receiver: {
      firstName: receiver.firstName,
      lastName:  receiver.lastName,
      phone:     receiver.phone,
      ...(receiver.email ? { email: receiver.email } : {}),
    },
    dropOffAddress: {
      firstLine:  dropOffAddress.firstLine,
      city:       dropOffAddress.city,
      cityId:     dropOffAddress.cityId,
      ...(dropOffAddress.districtId   ? { districtId:   dropOffAddress.districtId }   : {}),
      ...(dropOffAddress.districtName ? { districtName: dropOffAddress.districtName } : {}),
    },
    specs: {
      packageType: specs.packageType || 'SMALL',
      // packageDetails MUST be an object — Bosta rejects plain strings
      packageDetails: typeof specs.packageDetails === 'object'
        ? specs.packageDetails
        : { description: specs.packageDetails || '', itemsCount: 1 },
    },
    cod,
    notes,
    ...(webhookUrl         ? { webhookUrl }                              : {}),
    ...(businessLocationId ? { businessLocationId: businessLocationId } : {}),
  };

  return request('POST', '/v2/deliveries?apiVersion=1', body);
};

export const getDelivery = (deliveryId) =>
  request('GET', `/v2/deliveries/${deliveryId}`);

export const trackDelivery = (trackingNumber) =>
  request('GET', `/v2/deliveries/track/${trackingNumber}`);

export const cancelDelivery = (deliveryId) =>
  request('DELETE', `/v2/deliveries/${deliveryId}`);

export const updateDelivery = (deliveryId, updates) =>
  request('PUT', `/v2/deliveries/${deliveryId}`, updates);

export const listDeliveries = (page = 1, limit = 20) =>
  request('GET', `/v2/deliveries?page=${page}&limit=${limit}`);

// ─── AWB Printing ─────────────────────────────────────────────────────────────

/**
 * Print Air Waybill(s) — the shipping label to attach to the package.
 *
 * @param {string} trackingNumbers - Comma-separated tracking numbers e.g. "3111,3222"
 * @param {string} awbType         - "A4" (standard) or "A6" (Zebra thermal label)
 * @param {string} lang            - "en" or "ar"
 *
 * Response for ≤50 AWBs: base64-encoded PDF string
 * Response for >50 AWBs: email sent to registered address
 */
export const printAWB = (trackingNumbers, awbType = 'A6', lang = 'en') =>
  request('POST', '/v2/deliveries/mass-awb', {
    trackingNumbers,
    requestedAwbType: awbType,
    lang,
  });

// ─── Pickup Requests ──────────────────────────────────────────────────────────

/**
 * Create a pickup request — Bosta sends a courier to collect packages from your location.
 *
 * @param {object} params
 * @param {string} params.scheduledDate      - "YYYY-MM-DD" (no Fridays, no past dates)
 * @param {string} params.businessLocationId - Your pickup location ID
 * @param {object} params.contactPerson      - { name, phone, secPhone, person_email }
 * @param {number} params.numberOfParcels    - How many packages to collect
 * @param {string} params.packageType        - "Normal" | "Light Bulky" | "Heavy Bulky"
 * @param {string} params.notes              - Optional notes
 */
export const createPickup = (params) => {
  const {
    scheduledDate,
    businessLocationId,
    contactPerson,
    numberOfParcels = 1,
    packageType = 'Normal',
    notes = '',
  } = params;

  return request('POST', '/v2/pickups', {
    scheduledDate,
    businessLocationId,
    contactPerson,
    numberOfParcels,
    packageType,
    notes,
  });
};

export const getPickup = (pickupId) =>
  request('GET', `/v2/pickups/${pickupId}`);

export const listPickups = () =>
  request('GET', '/v2/pickups');

export const cancelPickup = (pickupId) =>
  request('DELETE', `/v2/pickups/${pickupId}`);

export const getAvailablePickupDates = () =>
  request('GET', '/v2/pickups/available-dates');
