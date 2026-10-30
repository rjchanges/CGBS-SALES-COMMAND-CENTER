import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMinutes, format } from 'date-fns';
import { leadSchema, type FollowUpTask, type Lead, type LeadInput } from '../../../packages/shared/src/index';
import type { z } from 'zod';
import { Button, Modal } from './layout';
import { useApp } from './context';
import { request } from './api';
import { SalesDetailsFields } from './SalesDetailsFields';
type LeadForm = z.input<typeof leadSchema>;
export function FollowUpSalesEditor({ task, lead, actionType = 'Call', onClose }: { task?: FollowUpTask; lead: Lead; actionType?: FollowUpTask['type']; onClose: () => void }) {
  const { data, refresh, toast } = useApp();
  const defaults = useMemo(() => ({ ...lead, nextFollowUp: task ? format(new Date(task.dueAt), "yyyy-MM-dd'T'HH:mm") : lead.nextFollowUp ? format(new Date(lead.nextFollowUp), "yyyy-MM-dd'T'HH:mm") : null, expectedClose: lead.expectedClose ? format(new Date(lead.expectedClose), 'yyyy-MM-dd') : null }), [lead, task?.dueAt]);
  const form = useForm<LeadForm, unknown, LeadInput>({ resolver: zodResolver(leadSchema), defaultValues: defaults });
  const submit = form.handleSubmit(async (values) => {
    if (task && !values.nextFollowUp) { form.setError('nextFollowUp', { message: 'Choose a date and time for this follow-up.' }); return; }
    const dueAt = values.nextFollowUp || null;
    const duration = task?.endsAt ? Math.max(15 * 60_000, Date.parse(task.endsAt) - Date.parse(task.dueAt)) : 30 * 60_000;
    const payload = { ...(task ? { taskId: task.id } : {}), actionType, status: values.status, priority: values.priority, revenue: values.revenue, currency: values.currency, progression: values.progression, probability: values.probability, source: values.source, assignedTo: values.assignedTo, expectedClose: values.expectedClose, notes: values.notes, dueAt, endsAt: dueAt ? addMinutes(new Date(dueAt), duration / 60_000).toISOString() : null, taskNotes: values.notes };
    try { await request(task ? '/tasks/' + task.id + '/sales-details' : '/leads/' + lead.id + '/sales-details', { method: 'PATCH', body: JSON.stringify(payload) }); await refresh(); toast('Sales details and follow-up saved.'); onClose(); }
    catch (error) { form.setError('root', { message: error instanceof Error ? error.message : 'Could not save sales details.' }); }
  });
  const canReassign = data?.user.role === 'Admin' || data?.user.role === 'Manager';
  const members = [...new Set([data?.user.name || '', lead.assignedTo, ...(data?.leads.map((item) => item.assignedTo) || []), ...(data?.tasks.map((item) => item.assignedTo) || []), ...(data?.calls.map((item) => item.createdBy) || []), ...(data?.opportunities.map((item) => item.owner) || [])].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return <Modal title="Sales details & next step" sub={`Update progression for ${lead.name} · ${lead.company}`} onClose={onClose} wide><form className="lead-form" onSubmit={submit}><div className="lead-form-lead-context"><b>{lead.name}</b><span>{lead.company}</span></div><div className={!canReassign ? 'sales-details-assigned-locked' : ''}><SalesDetailsFields form={form} assignedDisabled={!canReassign} members={members} /></div>{form.formState.errors.root?.message && <p className="form-error" role="alert">{form.formState.errors.root.message}</p>}<div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button><Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : 'Save Changes'}</Button></div></form></Modal>;
}
