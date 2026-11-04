const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export async function resolveSelection(input, stores, persist) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Selection must be an object');
  }
  const hasSeller = 'sellerId' in input;
  const hasStore = 'storeId' in input;
  if (hasSeller === hasStore) throw new TypeError('Supply exactly one identifier');
  const key = hasSeller ? 'sellerId' : 'storeId';
  const identifier = input[key];
  if (!nonempty(identifier)) throw new TypeError('Identifier must be a nonempty string');
  if (!Array.isArray(stores)) throw new TypeError('Stores must be an array');
  if (typeof persist !== 'function') throw new TypeError('Persist must be a function');
  const matches = [];
  for (const store of stores) {
    if (store === null || typeof store !== 'object' || Array.isArray(store) ||
        !nonempty(store.id) || !nonempty(store.sellerId)) {
      throw new TypeError('Malformed store');
    }
    if (store[hasSeller ? 'sellerId' : 'id'] === identifier) matches.push(store);
  }
  if (matches.length !== 1) throw new Error('Selection must resolve to exactly one store');
  const { id: storeId, sellerId } = matches[0];
  await persist(storeId);
  return { storeId, sellerId };
}
