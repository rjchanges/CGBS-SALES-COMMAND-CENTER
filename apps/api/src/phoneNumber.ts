export function isE164PhoneNumber(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

export function normalizeE164PhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\s().-]/g, '');
  return isE164PhoneNumber(normalized) ? normalized : null;
}
