function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function articleDateError(body) {
  if (!validDate(body.published)) return 'Published date is required (YYYY-MM-DD), and must be a valid calendar date';
  if (body.updated !== undefined && body.updated !== null && body.updated !== '' && !validDate(body.updated)) return 'Updated date must be a valid calendar date (YYYY-MM-DD)';
  return '';
}
