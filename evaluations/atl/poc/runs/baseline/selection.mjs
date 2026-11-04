const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export async function resolveSelection(input, stores, persist) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Input must be an object');
  }
  const hasSeller = 'sellerId' in input;
  const hasStore = 'storeId' in input;
  if (hasSeller === hasStore ||
      (hasSeller && !nonempty(input.sellerId)) ||
      (hasStore && !nonempty(input.storeId))) {
    throw new TypeError('Supply exactly one valid sellerId or storeId');
  }
  if (!Array.isArray(stores) || typeof persist !== 'function') {
    throw new TypeError('Stores must be an array and persist must be a function');
  }
  for (const store of stores) {
    if (store === null || typeof store !== 'object' || Array.isArray(store) ||
        !nonempty(store.id) || !nonempty(store.sellerId)) {
      throw new TypeError('Malformed store');
    }
  }
  const matches = stores.filter(store => hasSeller
    ? store.sellerId === input.sellerId
    : store.id === input.storeId);
  if (matches.length !== 1) throw new Error('Selection must resolve to one store');
  const result = { storeId: matches[0].id, sellerId: matches[0].sellerId };
  await persist(result.storeId);
  return result;
}
