import type { CSSProperties } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import type { CalendarItem } from '../../../packages/shared/src/index';
import { Button } from './layout';
import { dateKeyInTimezone, endOfMonthKey, formatDateKey, formatTime, minutesInTimezone, shiftDateKey, startOfMonthKey, startOfWeekKey } from './calendarTime';

export type CalendarView = 'Day' | 'Work Week' | 'Week' | 'Month' | 'Agenda';
export type CalendarRange = { start: string; end: string };
export type CalendarCategory = CalendarItem['category'];
export const views: CalendarView[] = ['Day', 'Work Week', 'Week', 'Month', 'Agenda'];
export const categories: CalendarCategory[] = ['Calls', 'Follow-ups', 'Meetings', 'CRM activity', 'Opportunities', 'Events'];
export const categoryColor: Record<CalendarCategory, string> = { Calls: 'blue', 'Follow-ups': 'amber', Meetings: 'purple', 'CRM activity': 'gray', Opportunities: 'green', Events: 'yellow' };
export const dayStart = 7;
export const dayEnd = 20;
const hourHeight = 64;
const minuteHeight = hourHeight / 60;

export function addMonth(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const moved = new Date(Date.UTC(year!, month! - 1 + amount, 1));
  const maxDay = new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0)).getUTCDate();
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day!, maxDay)).padStart(2, '0')}`;
}
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let key = start; key < end && days.length < 64; key = shiftDateKey(key, 1)) days.push(key);
  return days;
}
export function dateRange(view: CalendarView, anchor: string): CalendarRange {
  if (view === 'Day') return { start: anchor, end: shiftDateKey(anchor, 1) };
  if (view === 'Work Week') { const start = startOfWeekKey(anchor); return { start, end: shiftDateKey(start, 5) }; }
  if (view === 'Week') { const start = startOfWeekKey(anchor); return { start, end: shiftDateKey(start, 7) }; }
  if (view === 'Agenda') return { start: anchor, end: shiftDateKey(anchor, 31) };
  const start = startOfWeekKey(startOfMonthKey(anchor));
  return { start, end: shiftDateKey(startOfWeekKey(endOfMonthKey(anchor)), 7) };
}
export function rangeTitle(view: CalendarView, anchor: string, range: CalendarRange): string {
  if (view === 'Day') return formatDateKey(anchor);
  if (view === 'Month') return formatDateKey(anchor, { month: 'long', year: 'numeric' });
  return `${formatDateKey(range.start, { month: 'short', day: 'numeric' })} – ${formatDateKey(shiftDateKey(range.end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function isOnDay(item: CalendarItem, day: string, timezone: string): boolean {
  const start = dateKeyInTimezone(item.startAt, timezone);
  const end = dateKeyInTimezone(item.endAt, timezone);
  return item.allDay ? start <= day && day < end : start === day;
}
function minuteLabel(hour: number): string { return new Intl.DateTimeFormat('en', { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, hour))); }
function positionedItems(items: CalendarItem[], day: string, timezone: string) {
  const timed = items.filter((item) => !item.allDay && isOnDay(item, day, timezone)).map((item) => {
    const start = Math.max(dayStart * 60, minutesInTimezone(item.startAt, timezone));
    let end = Math.min(dayEnd * 60, minutesInTimezone(item.endAt, timezone));
    if (dateKeyInTimezone(item.endAt, timezone) !== day) end = dayEnd * 60;
    return { item, start, end: Math.max(start + 15, end), column: 0, columns: 1 };
  }).filter((entry) => entry.start < dayEnd * 60 && entry.end > dayStart * 60).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: typeof timed = [];
  let group: typeof timed = [];
  let groupEnd = -1;
  const finish = () => {
    if (!group.length) return;
    const ends: number[] = [];
    for (const entry of group) {
      let column = ends.findIndex((end) => end <= entry.start);
      if (column < 0) column = ends.length;
      entry.column = column; ends[column] = entry.end;
    }
    for (const entry of group) entry.columns = Math.max(1, ends.length);
    result.push(...group); group = []; groupEnd = -1;
  };
  for (const entry of timed) { if (group.length && entry.start >= groupEnd) finish(); group.push(entry); groupEnd = Math.max(groupEnd, entry.end); }
  finish(); return result;
}

export function MonthView({ days, anchor, today, items, timezone, onChooseDay, onSelectItem, onCreate }: { days: string[]; anchor: string; today: string; items: CalendarItem[]; timezone: string; onChooseDay: (key: string) => void; onSelectItem: (item: CalendarItem) => void; onCreate: (date: string, time?: string, allDay?: boolean) => void }) {
  return <div className="calendar-month-view"><div className="calendar-month-head">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <b key={day}>{day}</b>)}</div><div className="calendar-month-grid">{days.map((day) => {
    const dayItems = items.filter((item) => isOnDay(item, day, timezone));
    return <div key={day} className={'calendar-month-cell ' + (day === today ? 'is-today' : '') + (!day.startsWith(anchor.slice(0, 7)) ? ' is-outside' : '')} onDoubleClick={() => onCreate(day, '09:00', true)}><button className="calendar-month-date" onClick={() => onChooseDay(day)}>{Number(day.slice(-2))}</button><div className="calendar-month-events">{dayItems.slice(0, 3).map((item) => <button key={item.id} className={'calendar-month-event category-' + categoryColor[item.category] + ' status-' + item.status.toLowerCase()} onClick={() => onSelectItem(item)} title={item.title}><span>{item.allDay ? '' : formatTime(item.startAt, timezone, { hour: 'numeric', minute: '2-digit' }) + ' '}{item.title}</span></button>)}{dayItems.length > 3 && <button className="calendar-more-events" onClick={() => onChooseDay(day)}>+{dayItems.length - 3} more</button>}</div><button className="calendar-add-slot" aria-label={'Add event on ' + day} onClick={() => onCreate(day, '09:00', true)}><Plus size={12} /></button></div>;
  })}</div></div>;
}

export function TimeGrid({ days, view, today, items, timezone, currentTimeVisible, currentMinute, onSelectItem, onCreate }: { days: string[]; view: CalendarView; today: string; items: CalendarItem[]; timezone: string; currentTimeVisible: boolean; currentMinute: number; onSelectItem: (item: CalendarItem) => void; onCreate: (date: string, time?: string, allDay?: boolean) => void }) {
  const tickHours = Array.from({ length: dayEnd - dayStart + 1 }, (_, index) => dayStart + index);
  return <div className="calendar-time-view" style={{ '--calendar-day-count': days.length } as CSSProperties}>
    <div className="calendar-week-header"><div className="calendar-time-spacer" />{days.map((day) => <div key={day} className={'calendar-day-heading ' + (day === today ? 'is-current-day' : '')}><small>{formatDateKey(day, { weekday: 'short' })}</small><button onClick={() => onCreate(day, '09:00', false)}>{Number(day.slice(-2))}</button></div>)}</div>
    <div className="calendar-all-day-row"><div className="calendar-all-day-label">all day</div>{days.map((day) => <div key={day} className={'calendar-all-day-cell ' + (day === today ? 'is-current-day' : '')}>{items.filter((item) => item.allDay && isOnDay(item, day, timezone)).map((item) => <button key={item.id} className={'calendar-all-day-event category-' + categoryColor[item.category] + ' status-' + item.status.toLowerCase()} onClick={() => onSelectItem(item)}>{item.title}</button>)}</div>)}</div>
    <div className="calendar-time-scroll"><div className="calendar-time-canvas" style={{ height: (dayEnd - dayStart) * hourHeight }}><div className="calendar-time-axis">{tickHours.slice(0, -1).map((hour) => <div key={hour} style={{ top: (hour - dayStart) * hourHeight }}><span>{minuteLabel(hour)}</span></div>)}</div><div className="calendar-day-columns">{days.map((day) => {
      const positioned = positionedItems(items, day, timezone); const nowTop = (currentMinute - dayStart * 60) * minuteHeight;
      return <div key={day} className={'calendar-day-column ' + (day === today ? 'is-current-day' : '')} onClick={(event) => {
        if ((event.target as HTMLElement).closest('.calendar-event-block')) return;
        const rect = event.currentTarget.getBoundingClientRect(); const scroll = event.currentTarget.closest('.calendar-time-scroll');
        const pixel = event.clientY - rect.top + (scroll?.scrollTop || 0);
        const minute = Math.max(dayStart * 60, Math.min(dayEnd * 60 - 30, Math.round(pixel / minuteHeight / 30) * 30 + dayStart * 60));
        onCreate(day, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, false);
      }}>
        {tickHours.slice(0, -1).map((hour) => <div className="calendar-hour-line" key={hour} style={{ top: (hour - dayStart) * hourHeight }}><i /></div>)}
        {positioned.map(({ item, start, end, column, columns }) => { const top = (start - dayStart * 60) * minuteHeight; const height = Math.max(24, (end - start) * minuteHeight); const width = 100 / columns; return <button key={item.id} className={'calendar-event-block category-' + categoryColor[item.category] + ' status-' + item.status.toLowerCase()} style={{ top, height, left: `calc(${column * width}% + 3px)`, width: `calc(${width}% - 6px)` }} onClick={(event) => { event.stopPropagation(); onSelectItem(item); }} title={item.title}><b>{item.title}</b><span>{formatTime(item.startAt, timezone)} – {formatTime(item.endAt, timezone)}</span>{height > 44 && <small>{item.leadName}{item.company ? ' · ' + item.company : ''}</small>}</button>; })}
        {currentTimeVisible && day === today && <div className="calendar-now-indicator" style={{ top: Math.max(0, nowTop) }}><i /></div>}
      </div>;
    })}</div></div></div>
    <div className="calendar-grid-footnote">Showing {view === 'Day' ? 'one day' : view === 'Work Week' ? 'Monday through Friday' : 'seven days'} · click an empty time slot to create an event · {timezone}</div>
  </div>;
}

export function AgendaView({ days, items, timezone, onSelectItem, onCreate }: { days: string[]; items: CalendarItem[]; timezone: string; onSelectItem: (item: CalendarItem) => void; onCreate: (date: string, time?: string, allDay?: boolean) => void }) {
  const agendaDays = days.filter((day) => items.some((item) => isOnDay(item, day, timezone)));
  return <div className="calendar-agenda-view">{agendaDays.map((day) => <section key={day} className="calendar-agenda-day"><header><span>{formatDateKey(day, { weekday: 'short' })}</span><b>{formatDateKey(day, { month: 'short', day: 'numeric' })}</b><button onClick={() => onCreate(day, '09:00', false)}><Plus size={13} /> Add</button></header><div>{items.filter((item) => isOnDay(item, day, timezone)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.startAt) - Date.parse(b.startAt)).map((item) => <button key={item.id} className={'calendar-agenda-item category-' + categoryColor[item.category] + ' status-' + item.status.toLowerCase()} onClick={() => onSelectItem(item)}><i /><div><b>{item.title}</b><span>{item.leadName}{item.company ? ' · ' + item.company : ''}{item.description ? ' · ' + item.description : ''}</span></div><small>{item.allDay ? 'All day' : formatTime(item.startAt, timezone) + ' – ' + formatTime(item.endAt, timezone)}</small><em>{item.status}</em></button>)}</div></section>)}{!agendaDays.length && <div className="calendar-empty-state"><CalendarDays size={27} /><b>No events in this range</b><span>Scheduled CRM activities and calendar events will appear here.</span><Button variant="primary" onClick={() => onCreate(days[0] || dateKeyInTimezone(new Date(), timezone), '09:00', false)}><Plus size={15} /> New event</Button></div>}</div>;
}