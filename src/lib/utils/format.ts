const longDate = new Intl.DateTimeFormat("ar", { dateStyle: "long", timeZone: "UTC" });
const number = new Intl.NumberFormat("ar");

/** UTC, so the server and the browser always print the same day. */
export function formatDate(value: Date | string): string {
  return longDate.format(new Date(value));
}

export function formatNumber(value: number): string {
  return number.format(value);
}
