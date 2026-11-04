export function paginate(items, options) {
  if (!Array.isArray(items) || options === null || typeof options !== 'object' ||
      Array.isArray(options)) throw new TypeError('Invalid pagination input');
  const { page, pageSize } = options;
  if (!Number.isSafeInteger(page) || page <= 0 ||
      !Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new TypeError('Page and pageSize must be positive safe integers');
  }
  const start = BigInt(page - 1) * BigInt(pageSize);
  const end = start + BigInt(pageSize);
  if (start > BigInt(Number.MAX_SAFE_INTEGER) || end > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Unsafe pagination offset');
  }
  return {
    items: items.slice(Number(start), Number(end)),
    page,
    pageSize,
    total: items.length,
    totalPages: Math.ceil(items.length / pageSize),
  };
}
