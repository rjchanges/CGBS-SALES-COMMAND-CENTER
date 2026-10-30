function validTimezone(timezone: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date()); return timezone; }
  catch { return 'Asia/Kolkata'; }
}
function partsAt(value: Date | string, timezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (key: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === key)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}
export function dateKeyInTimezone(value: Date | string, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const p = partsAt(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function timeInTimezone(value: Date | string, timezone: string): string {
  const p = partsAt(value, timezone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
export function minutesInTimezone(value: Date | string, timezone: string): number { const time = timeInTimezone(value, timezone).split(':').map(Number); return time[0]! * 60 + time[1]!; }
export function dateTimeInput(value: Date | string, timezone: string): string {
  return `${dateKeyInTimezone(value, timezone)}T${timeInTimezone(value, timezone)}`;
}
export function zonedDateTimeToIso(dateKey: string, time: string, timezone: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Enter a valid date and time.');
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = desired;
  const zone = validTimezone(timezone);
  for (let index = 0; index < 5; index += 1) {
    const p = partsAt(new Date(guess), zone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const adjustment = desired - represented;
    if (adjustment === 0) break;
    guess += adjustment;
  }
  return new Date(guess).toISOString();
}
export function shiftDateKey(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function startOfWeekKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return shiftDateKey(key, weekday === 0 ? -6 : 1 - weekday);
}
export function startOfMonthKey(key: string): string { return `${key.slice(0, 7)}-01`; }
export function endOfMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const day = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}
export function weekdayInUtc(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}
export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}
export function formatTime(value: string, timezone: string, options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }): string {
  return new Intl.DateTimeFormat('en', { ...options, timeZone: validTimezone(timezone) }).format(new Date(value));
}
export function rangeStartIso(dateKey: string, timezone: string): string { return zonedDateTimeToIso(dateKey, '00:00', timezone); }