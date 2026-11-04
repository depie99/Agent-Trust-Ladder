export function paginate(items, options) {
  if (!Array.isArray(items)) throw new TypeError('Items must be an array');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Options must be an object');
  }
  const { page, pageSize } = options;
  if (!Number.isSafeInteger(page) || page <= 0 ||
      !Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new RangeError('Page and pageSize must be positive safe integers');
  }
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new RangeError('Pagination offsets must be safe integers');
  }
  return {
    items: items.slice(start, end), page, pageSize,
    total: items.length, totalPages: Math.ceil(items.length / pageSize)
  };
}
