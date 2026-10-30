import type { UseFormReturn } from 'react-hook-form';
import { leadSchema, type LeadInput } from '../../../packages/shared/src/index';
import type { z } from 'zod';

type LeadForm = UseFormReturn<z.input<typeof leadSchema>, unknown, LeadInput>;
export function SalesDetailsFields({ form, assignedDisabled = false, members = [] }: { form: LeadForm; assignedDisabled?: boolean; members?: string[] }) {
  const errorFor = (field: keyof LeadInput) => form.formState.errors[field]?.message;
  return <>
    <div className="form-section-title"><span>02</span><div><b>Sales details &amp; next step</b><small>Set deal context and a tracked follow-up action.</small></div></div>
    <div className="form-grid">
      <label>Lead status<select {...form.register('status')}>{['New Lead','Contacted','Interested','Follow-up Required','RNR','Meeting Scheduled','Qualified','Proposal Sent','Negotiation'].map((item) => <option key={item}>{item}</option>)}</select>{errorFor('status') && <em>{errorFor('status')}</em>}</label>
      <label>Priority<select {...form.register('priority')}>{['Low','Medium','High','Critical'].map((item) => <option key={item}>{item}</option>)}</select>{errorFor('priority') && <em>{errorFor('priority')}</em>}</label>
      <label>Estimated deal value<input type="number" min="0" {...form.register('revenue')} />{errorFor('revenue') && <em>{errorFor('revenue')}</em>}</label>
      <label>Currency<select {...form.register('currency')}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound Sterling</option></select></label>
      <label>Progression %<input type="number" min="0" max="100" {...form.register('progression')} /><small className="field-help">Sales progress, separate from win probability.</small>{errorFor('progression') && <em>{errorFor('progression')}</em>}</label>
      <label>Win probability %<input type="number" min="0" max="100" {...form.register('probability')} />{errorFor('probability') && <em>{errorFor('probability')}</em>}</label>
      <label>Lead source<select {...form.register('source')}>{['Website','Referral','LinkedIn','Campaign','Cold Calling','Other'].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Assigned to{members.length ? <select {...form.register('assignedTo')} disabled={assignedDisabled}>{members.map((member) => <option key={member}>{member}</option>)}</select> : <input {...form.register('assignedTo')} disabled={assignedDisabled} />}{errorFor('assignedTo') && <em>{errorFor('assignedTo')}</em>}</label>
      <label>Next follow-up<input type="datetime-local" {...form.register('nextFollowUp', { setValueAs: (value) => value ? new Date(value).toISOString() : null })} /><small className="field-help">Reschedules this follow-up record.</small>{errorFor('nextFollowUp') && <em>{errorFor('nextFollowUp')}</em>}</label>
      <label>Expected close date<input type="date" {...form.register('expectedClose', { setValueAs: (value) => value ? new Date(value).toISOString() : null })} /></label>
      <label className="field-wide">Notes<textarea rows={3} {...form.register('notes')} placeholder="Context for your next conversation…" />{errorFor('notes') && <em>{errorFor('notes')}</em>}</label>
    </div>
  </>;
}




