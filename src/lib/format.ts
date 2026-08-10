/** Display-only money formatting. Storage remains numeric(18,4). */
export function formatMoney(
  value: number | string,
  currencyCode = "INR",
  locale = "en-IN",
): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(amount) ? amount : 0);
}
