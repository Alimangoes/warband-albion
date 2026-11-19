import { request } from './providers.mjs';

const markets = { asia: 'east', americas: 'west', europe: 'europe' };
const cities = ['Bridgewatch', 'Caerleon', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien'];
const maxPriceAge = 7 * 86400000;
const fallbackPriceAge = 30 * 86400000;
const priceKey = (id, quality) => id + ':' + quality;
const itemPriceKey = item => priceKey(item.id, item.quality ?? 1);
const validQuality = quality => Number.isInteger(quality) && quality >= 1 && quality <= 5;
const marketDate = value => typeof value === 'string' ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + 'Z') : NaN;
const dateParam = timestamp => new Date(timestamp).toISOString().slice(0, 10);

async function marketRows(region, endpoint, ids, options = '') {
  const batches = [];
  let batch = '';
  for (const id of ids.map(encodeURIComponent)) {
    if (batch && batch.length + id.length >= 1500) {
      batches.push(batch);
      batch = '';
    }
    batch += (batch ? ',' : '') + id;
  }
  if (batch) batches.push(batch);
  const rows = await Promise.allSettled(batches.map(items => request(
    'https://' + markets[region] + '.albion-online-data.com/api/v2/stats/' + endpoint + '/' + items +
      '.json?qualities=1,2,3,4,5&locations=' + cities.map(encodeURIComponent).join(',') + options, {}, 'Albion Market')));
  return rows.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
}

export async function combatPrices(region, items) {
  const prices = new Map();
  if (!Object.hasOwn(markets, region)) return prices;
  const ids = [...new Set(items.map(item => item.id))].slice(0, 120);
  const allowed = new Set(ids);
  const wanted = new Set(items.filter(item => allowed.has(item.id)).map(itemPriceKey));
  const now = Date.now();
  const cutoff = now - maxPriceAge;
  const fallbackCutoff = now - fallbackPriceAge;
  const recent = date => Number.isFinite(date) && date >= cutoff && date <= now + 3600000;
  const history = await marketRows(region, 'history', ids, '&time-scale=24&date=' + dateParam(fallbackCutoff) +
    '&end_date=' + dateParam(now + 86400000));
  const totals = new Map();
  const olderTotals = new Map();
  for (const row of history) {
    if (!allowed.has(row?.item_id) || !validQuality(row.quality) || !cities.includes(row.location) || !Array.isArray(row.data)) continue;
    const key = priceKey(row?.item_id, row?.quality);
    for (const sale of row.data) {
      const unit = sale?.avg_price;
      const count = sale?.item_count;
      const date = marketDate(sale?.timestamp);
      if (!Number.isFinite(date) || date < fallbackCutoff || date > now + 3600000 ||
        !Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(count) || count <= 0) continue;
      const bucket = date >= cutoff ? totals : olderTotals;
      const total = bucket.get(key) ?? { silver: 0, count: 0 };
      if (!Number.isSafeInteger(total.silver + unit * count) ||
        !Number.isSafeInteger(total.count + count)) continue;
      total.silver += unit * count;
      total.count += count;
      bucket.set(key, total);
    }
  }
  const missing = [...new Set(items.filter(item => wanted.has(itemPriceKey(item)) && !totals.has(itemPriceKey(item))).map(item => item.id))];
  const listings = new Map();
  for (const row of await marketRows(region, 'prices', missing)) {
    if (!allowed.has(row?.item_id) || !validQuality(row.quality) || !cities.includes(row.city)) continue;
    const key = priceKey(row?.item_id, row?.quality);
    const silver = row?.sell_price_min;
    if (!recent(marketDate(row.sell_price_min_date)) || !Number.isSafeInteger(silver) || silver <= 0) continue;
    const values = listings.get(key) ?? [];
    values.push(silver);
    listings.set(key, values);
  }
  for (const values of listings.values()) {
    values.sort((a, b) => a - b);
  }
  function quote(id, quality) {
    const key = priceKey(id, quality);
    const sales = totals.get(key);
    if (sales) return { silver: Math.round(sales.silver / sales.count), source: 'sales', quality };
    const values = listings.get(key);
    if (values) {
      const middle = Math.floor(values.length / 2);
      const lower = values[Math.floor((values.length - 1) / 2)];
      return { silver: Math.round(lower + (values[middle] - lower) / 2), source: 'listings', quality };
    }
    const older = olderTotals.get(key);
    return older ? { silver: Math.round(older.silver / older.count), source: 'older-sales', quality } : null;
  }
  for (const item of items) {
    const key = itemPriceKey(item);
    if (!wanted.has(key) || prices.has(key)) continue;
    const quality = item.quality ?? 1;
    const alternatives = [1, 2, 3, 4, 5].filter(other => other !== quality)
      .sort((a, b) => Math.abs(a - quality) - Math.abs(b - quality));
    const estimate = quote(item.id, quality) || alternatives.map(other => quote(item.id, other)).find(Boolean);
    if (estimate) prices.set(key, estimate);
  }
  return prices;
}

export function priceCombatItems(items, prices) {
  return items.map(item => {
    const quote = prices.get(itemPriceKey(item));
    const total = quote?.silver * (item.count ?? 1);
    return { ...item, market: Number.isSafeInteger(total) ? { unit: quote.silver, total, source: quote.source, quality: quote.quality } : null };
  });
}

export function estimateSilver(items) {
  let priced = 0;
  let silver = 0;
  for (const item of items) {
    const value = item.market?.total;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(silver + value)) continue;
    priced++;
    silver += value;
  }
  return { silver: priced || !items.length ? silver : null, priced, total: items.length };
}
