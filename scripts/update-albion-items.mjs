import { writeFile } from 'node:fs/promises';

const root = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/';
const [raw, names] = await Promise.all(['items.json', 'formatted/items.json'].map(async path => {
  const response = await fetch(root + path, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(path + ' returned ' + response.status);
  return response.json();
}));
const namesById = new Map(names.map(row => [row.UniqueName, row.LocalizedNames?.['EN-US']]));
const slots = { mainhand: 'weapon', offhand: 'offhand', head: 'head', armor: 'chest', shoes: 'feet', cape: 'cape', food: 'food', potion: 'potion' };
const catalog = [];
for (const section of ['equipmentitem', 'weapon', 'transformationweapon', 'consumableitem']) {
  for (const item of raw.items[section]) {
    const id = item['@uniquename'];
    const name = namesById.get(id);
    const slot = slots[item['@slottype']];
    if (!slot || !name || !/^T[1-8]_[A-Z0-9_]+$/.test(id)) continue;
    const variants = [item.enchantments?.enchantment ?? []].flat();
    const enchants = [0, ...variants.map(row => Number(row['@enchantmentlevel'])).filter(n => n >= 1 && n <= 4)];
    const twoHanded = item['@twohanded'] === 'true' || section === 'transformationweapon' || (slot === 'weapon' && id.includes('_2H_'));
    catalog.push([id, name, slot, enchants, Number(item['@maxqualitylevel']) || 1, ...(twoHanded ? [true] : [])]);
  }
}
catalog.sort((a, b) => a[1].localeCompare(b[1]));
await writeFile(new URL('../public/albion-items.json', import.meta.url), JSON.stringify(catalog) + '\n');
console.log('Saved ' + catalog.length + ' Albion items.');
