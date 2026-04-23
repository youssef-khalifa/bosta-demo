import fetch from 'node-fetch';

const BASE_URL = process.env.BOSTA_BASE_URL || 'https://stg-app.bosta.co';
const API_KEY  = process.env.BOSTA_API_KEY;

if (!API_KEY) {
  console.warn('[bosta] WARNING: BOSTA_API_KEY is not set. Requests will fail.');
}

const headers = () => ({
  'Authorization': API_KEY,
  'Content-Type': 'application/json',
});

// path should include the version prefix, e.g. '/v1/cities' or '/v2/deliveries'
async function request(method, path, body) {
  const url = `${BASE_URL}/api${path}`;
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(json.message || `Bosta ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.bostaCode = json.code;
    err.raw = json;
    throw err;
  }
  return json;
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

export const getCities = () =>
  request('GET', '/v1/cities');

export const getDistricts = (cityId) =>
  request('GET', `/v1/cities/${cityId}/districts`);

// ─── Deliveries ───────────────────────────────────────────────────────────────

/**
 * Create a standard deliver-to-customer shipment.
 *
 * @param {object} params
 * @param {object} params.receiver        - { firstName, lastName, phone, email? }
 * @param {object} params.dropOffAddress  - { firstLine, city, cityId, districtId?, districtName? }
 * @param {object} params.specs           - { packageDetails?: string, packageType: 'Parcel'|'Document'|'Bulky', numberOfPieces?: number }
 * @param {number} params.cod             - Cash on delivery amount in EGP (0 if pre-paid)
 * @param {string} params.notes           - Optional delivery notes
 * @param {string} params.webhookUrl      - Optional per-order webhook override
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
    // 10 = standard deliver
    type: 10,
    receiver: {
      firstName:   receiver.firstName,
      lastName:    receiver.lastName,
      phone:       receiver.phone,
      ...(receiver.email ? { email: receiver.email } : {}),
    },
    dropOffAddress: {
      firstLine:    dropOffAddress.firstLine,
      city:         dropOffAddress.city,
      cityId:       dropOffAddress.cityId,
      ...(dropOffAddress.districtId   ? { districtId:   dropOffAddress.districtId }   : {}),
      ...(dropOffAddress.districtName ? { districtName: dropOffAddress.districtName } : {}),
    },
    specs: {
      packageType:    specs.packageType    || 'Parcel',
      // packageDetails must be an object, not a string
      packageDetails: typeof specs.packageDetails === 'object'
        ? specs.packageDetails
        : { description: specs.packageDetails || '' },
      numberOfPieces: specs.numberOfPieces || 1,
    },
    cod,
    notes,
    ...(webhookUrl           ? { webHook:             webhookUrl }           : {}),
    ...(businessLocationId   ? { businessLocationId:  businessLocationId }   : {}),
  };

  return request('POST', '/v2/deliveries?apiVersion=1', body);
};

/**
 * Get a single delivery by its Bosta ID.
 */
export const getDelivery = (deliveryId) =>
  request('GET', `/v2/deliveries/${deliveryId}`);

/**
 * Track a delivery by tracking number (the short code on the waybill).
 */
export const trackDelivery = (trackingNumber) =>
  request('GET', `/v2/deliveries/track/${trackingNumber}`);

/**
 * Cancel (terminate) a delivery.
 * Only possible while the order is NOT yet confirmed/dispatched.
 * Once confirmed → only address, COD amount, and phone can be patched.
 */
export const cancelDelivery = (deliveryId) =>
  request('DELETE', `/v2/deliveries/${deliveryId}`);

/**
 * Update allowed fields on a delivery that is already confirmed.
 * Bosta only allows: dropOffAddress, cod, receiver.phone
 */
export const updateDelivery = (deliveryId, updates) =>
  request('PATCH', `/v2/deliveries/${deliveryId}`, updates);

/**
 * List deliveries (paginated).
 */
export const listDeliveries = (page = 1, limit = 20) =>
  request('GET', `/v2/deliveries?page=${page}&limit=${limit}`);
