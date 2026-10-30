import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Clock3, Filter, Menu, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { CalendarEvent, CalendarEventStatus, CalendarItem, FollowUpTask } from '../../../../packages/shared/src/index';
import { Button, Card, PageHeading } from '../layout';
import { request } from '../api';
import { useApp } from '../context';
import { dateKeyInTimezone, dateTimeInput, endOfMonthKey, formatDateKey, rangeStartIso, shiftDateKey, startOfMonthKey, startOfWeekKey, minutesInTimezone } from '../calendarTime';
import { AgendaView, addMonth, categories, categoryColor, dateRange, daysBetween, MonthView, rangeTitle, type CalendarView, TimeGrid, views } from '../calendarViews';
import { CalendarEventEditor, CalendarItemDetails, CalendarTaskEditor, OpportunityDateEditor } from '../CalendarEditors';

export function CalendarPage() {
  const { data, refresh } = useApp();
  const timezone = data?.settings.timezone || 'Asia/Kolkata';
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<CalendarView>(() => { const saved = localStorage.getItem('cgbs_calendar_view') as CalendarView | null; return saved && views.includes(saved) ? saved : 'Work Week'; });
  const [anchor, setAnchor] = useState(() => dateKeyInTimezone(new Date(), timezone));
  const [miniMonth, setMiniMonth] = useState(() => startOfMonthKey(dateKeyInTimezone(new Date(), timezone)));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cgbs_calendar_sidebar') === 'collapsed');
  const [categoriesVisible, setCategoriesVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(categories.map((category) => [category, true])));
  const [statusFilter, setStatusFilter] = useState<'All' | CalendarEventStatus>('All');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<CalendarEvent | null>(null);
  const [initialDateTime, setInitialDateTime] = useState('');
  const [initialAllDay, setInitialAllDay] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [editingTask, setEditingTask] = useState<FollowUpTask | null>(null);
  const [editingOpportunity, setEditingOpportunity] = useState<string | null>(null);
  const range = useMemo(() => dateRange(view, anchor), [view, anchor]);
  const gridDays = useMemo(() => daysBetween(range.start, range.end), [range]);
  const title = rangeTitle(view, anchor, range);
  const today = dateKeyInTimezone(new Date(), timezone);
  const visibleItems = useMemo(() => items.filter((item) => categoriesVisible[item.category] && (statusFilter === 'All' || item.status === statusFilter)), [items, categoriesVisible, statusFilter]);
  const members = useMemo(() => [...new Set([data?.user.name || '', ...(data?.leads.map((item) => item.assignedTo) || []), ...(data?.tasks.map((item) => item.assignedTo) || []), ...(data?.opportunities.map((item) => item.owner) || [])].filter(Boolean))], [data]);
  const loadCalendar = useCallback(async () => {
    if (!data) return;
    setLoading(true); setLoadError('');
    try {
      const start = rangeStartIso(range.start, timezone); const end = rangeStartIso(range.end, timezone);
      setItems(await request<CalendarItem[]>(`/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load this calendar range.'); setItems([]); }
    finally { setLoading(false); }
  }, [data, range.start, range.end, timezone]);
  useEffect(() => { void loadCalendar(); }, [loadCalendar, reload]);
  useEffect(() => { localStorage.setItem('cgbs_calendar_view', view); }, [view]);
  useEffect(() => { localStorage.setItem('cgbs_calendar_sidebar', sidebarCollapsed ? 'collapsed' : 'open'); }, [sidebarCollapsed]);
  useEffect(() => {
    if (searchParams.get('new') === '1') { setInitialDateTime(`${anchor}T09:00`); setInitialAllDay(false); setEventToEdit(null); setEditorOpen(true); setSearchParams({}, { replace: true }); }
  }, [searchParams, setSearchParams, anchor]);
  const move = (direction: number) => {
    if (view === 'Day') setAnchor((key) => shiftDateKey(key, direction));
    else if (view === 'Agenda') setAnchor((key) => shiftDateKey(key, direction * 30));
    else if (view === 'Week' || view === 'Work Week') setAnchor((key) => shiftDateKey(key, direction * 7));
    else { const next = addMonth(anchor, direction); setAnchor(next); setMiniMonth(startOfMonthKey(next)); }
  };
  const goToday = () => { const key = dateKeyInTimezone(new Date(), timezone); setAnchor(key); setMiniMonth(startOfMonthKey(key)); };
  const chooseDay = (key: string) => { setAnchor(key); setMiniMonth(startOfMonthKey(key)); };
  const openNew = (date = anchor, time = '09:00', allDay = false) => { setInitialDateTime(`${date}T${time}`); setInitialAllDay(allDay); setEventToEdit(null); setEditorOpen(true); };
  const changeCategory = (category: string) => setCategoriesVisible((current) => ({ ...current, [category]: !current[category] }));
  const currentMinute = minutesInTimezone(new Date(), timezone);
  const currentTimeVisible = today >= range.start && today < range.end && currentMinute >= 7 * 60 && currentMinute <= 20 * 60;
  const openEventEdit = (item: CalendarItem) => {
    setSelectedItem(null); setInitialDateTime(dateTimeInput(item.startAt, timezone)); setInitialAllDay(item.allDay);
    setEventToEdit({ id: item.sourceId, title: item.title, description: item.sourceNotes || item.description, startAt: item.startAt, endAt: item.endAt, allDay: item.allDay, type: item.type, status: item.status, leadId: item.leadId, opportunityId: item.opportunityId, assignedTo: item.assignedTo, priority: item.priority, location: item.location, meetingLink: item.meetingLink, createdBy: data?.user.name || '', createdAt: item.startAt, updatedAt: item.startAt });
    setEditorOpen(true);
  };
  const openTaskEdit = (item: CalendarItem) => { const task = data?.tasks.find((record) => record.id === item.sourceId); if (task) { setSelectedItem(null); setEditingTask(task); } };
  const openOpportunityEdit = (item: CalendarItem) => { if (item.opportunityId) { setSelectedItem(null); setEditingOpportunity(item.opportunityId); } };
  const miniStart = startOfWeekKey(startOfMonthKey(miniMonth));
  const miniEnd = shiftDateKey(startOfWeekKey(endOfMonthKey(miniMonth)), 7);
  const miniDays = daysBetween(miniStart, miniEnd);
  const filterControls = <div className="calendar-filter-popover"><b>Show on calendar</b>{categories.map((category) => <label key={category}><input type="checkbox" checked={Boolean(categoriesVisible[category])} onChange={() => changeCategory(category)} /><i className={'calendar-category-dot ' + categoryColor[category]} />{category}</label>)}<label className="calendar-status-filter">Activity status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | CalendarEventStatus)}><option>All</option><option>Scheduled</option><option>Completed</option><option>Cancelled</option></select></label></div>;
  return <div className={'page-stack calendar-page ' + (sidebarCollapsed ? 'calendar-sidebar-collapsed' : '')}>
    <PageHeading eyebrow="Plan your time" title="Calendar" description="CRM calls, follow-ups, meetings, and events in one schedule." />
    <Card className="outlook-calendar-card">
      <div className="outlook-calendar-toolbar"><div className="calendar-toolbar-left"><button className="calendar-toolbar-icon" aria-label="Collapse or expand calendar sidebar" onClick={() => setSidebarCollapsed((value) => !value)}><Menu size={17} /></button><button className="calendar-today-button" onClick={goToday}>Today</button><div className="calendar-range-nav"><button className="calendar-toolbar-icon" aria-label="Previous date range" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="calendar-toolbar-icon" aria-label="Next date range" onClick={() => move(1)}><ChevronRight size={18} /></button></div><h2>{title}</h2></div><div className="calendar-toolbar-right"><div className="calendar-filter-wrap"><button className={'calendar-select-button ' + (filtersOpen ? 'selected' : '')} onClick={() => setFiltersOpen((value) => !value)}><Filter size={14} /> Filter <ChevronDown size={13} /></button>{filtersOpen && filterControls}</div><select className="calendar-view-select" aria-label="Calendar view" value={view} onChange={(event) => setView(event.target.value as CalendarView)}>{views.map((item) => <option key={item}>{item}</option>)}</select><Button variant="primary" onClick={() => openNew()}><Plus size={15} /> New event</Button></div></div>
      <div className="outlook-calendar-body"><aside className={'calendar-left-rail ' + (sidebarCollapsed ? 'is-collapsed' : '')}>
        <div className="mini-calendar-heading"><b>{formatDateKey(miniMonth, { month: 'long', year: 'numeric' })}</b><div><button aria-label="Previous mini-calendar month" onClick={() => setMiniMonth((key) => startOfMonthKey(addMonth(key, -1)))}><ChevronLeft size={15} /></button><button aria-label="Next mini-calendar month" onClick={() => setMiniMonth((key) => startOfMonthKey(addMonth(key, 1)))}><ChevronRight size={15} /></button></div></div>
        <div className="mini-calendar-grid mini-calendar-weekdays">{['M','T','W','T','F','S','S'].map((day, index) => <span key={day + index}>{day}</span>)}</div><div className="mini-calendar-grid">{miniDays.map((day) => <button key={day} className={'mini-calendar-day ' + (day === anchor ? 'selected' : '') + (day === today ? ' today' : '') + (!day.startsWith(miniMonth.slice(0, 7)) ? ' outside-month' : '')} onClick={() => chooseDay(day)} aria-label={formatDateKey(day)}><span>{Number(day.slice(-2))}</span>{items.some((item) => item.startAt.slice(0, 10) === day) && <i />}</button>)}</div>
        <button className="calendar-mini-today" onClick={goToday}>Today <span>{Number(today.slice(-2))}</span></button><div className="my-calendars"><b>My calendars</b>{categories.map((category) => <label key={category}><input type="checkbox" checked={Boolean(categoriesVisible[category])} onChange={() => changeCategory(category)} /><i className={'calendar-category-dot ' + categoryColor[category]} />{category}</label>)}</div><div className="calendar-timezone"><Clock3 size={12} /> {timezone}</div>
      </aside>
      <main className="calendar-main-pane">{loading && <div className="calendar-loading">Loading this date range…</div>}{loadError && <div className="calendar-load-error" role="alert">{loadError}<button onClick={() => setReload((value) => value + 1)}>Retry</button></div>}{view === 'Month' ? <MonthView days={gridDays} anchor={anchor} today={today} items={visibleItems} timezone={timezone} onChooseDay={chooseDay} onSelectItem={setSelectedItem} onCreate={openNew} /> : view === 'Agenda' ? <AgendaView days={daysBetween(range.start, range.end)} items={visibleItems} timezone={timezone} onSelectItem={setSelectedItem} onCreate={openNew} /> : <TimeGrid days={gridDays} view={view} today={today} items={visibleItems} timezone={timezone} currentTimeVisible={currentTimeVisible} currentMinute={currentMinute} onSelectItem={setSelectedItem} onCreate={openNew} />}</main></div>
    </Card>
    {selectedItem && <CalendarItemDetails item={selectedItem} timezone={timezone} onClose={() => setSelectedItem(null)} onEditEvent={() => openEventEdit(selectedItem)} onEditTask={() => openTaskEdit(selectedItem)} onEditOpportunity={() => openOpportunityEdit(selectedItem)} />}
    {editorOpen && <CalendarEventEditor initialDateTime={initialDateTime || `${anchor}T09:00`} initialAllDay={initialAllDay} event={eventToEdit} members={members} items={items} timezone={timezone} onClose={() => { setEditorOpen(false); setEventToEdit(null); }} onSaved={async () => { await refresh(); setReload((value) => value + 1); setEditorOpen(false); setEventToEdit(null); }} />}
    {editingTask && <CalendarTaskEditor task={editingTask} timezone={timezone} members={members} onClose={() => setEditingTask(null)} onSaved={async () => { await refresh(); setReload((value) => value + 1); setEditingTask(null); }} />}
    {editingOpportunity && data?.opportunities.find((item) => item.id === editingOpportunity) && <OpportunityDateEditor opportunity={data.opportunities.find((item) => item.id === editingOpportunity)!} timezone={timezone} onClose={() => setEditingOpportunity(null)} onSaved={async () => { await refresh(); setReload((value) => value + 1); setEditingOpportunity(null); }} />}
  </div>;
}
