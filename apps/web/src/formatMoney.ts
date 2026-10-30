const currencyFormatter = (currency: string, maximumFractionDigits = 0) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });

/** Formats INR values using Indian lakh/crore units while retaining other currencies. */
export function formatMoney(value: number, currency = 'INR'): string {
  if (currency !== 'INR') return currencyFormatter(currency).format(value);

  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 10_000_000) {
    return currencyFormatter('INR', 2).format(value / 10_000_000) + 'Cr';
  }
  if (absoluteValue >= 100_000) {
    return currencyFormatter('INR', 2).format(value / 100_000) + 'L';
  }
  return currencyFormatter('INR').format(value);
}