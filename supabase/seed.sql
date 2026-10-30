-- Fictional seed records only. Use a separate non-production Supabase project.
insert into public.companies (id, name, website, industry) values
  ('10000000-0000-4000-8000-000000000001','Northstar Technologies','https://northstar.example','Technology'),
  ('10000000-0000-4000-8000-000000000002','Brightpath Learning','https://brightpath.example','Education'),
  ('10000000-0000-4000-8000-000000000003','Evergreen Retail',null,'Retail'),
  ('10000000-0000-4000-8000-000000000004','Monarch Health','https://monarch.example','Healthcare')
on conflict (id) do nothing;

insert into public.leads
  (id, company_id, full_name, role_title, email, phone, source, status, priority, estimated_revenue, currency, progression, win_probability, is_shared, notes)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Amit Sharma','VP of Sales','amit.sharma@example.test','+91 98765 43210','Referral','Follow-up Required','High',1800000,'INR',35,32,true,'Fictional demo lead. Requested a product walkthrough.'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Priya Nair','Operations Director','priya.nair@example.test','+91 98765 43211','Website','Interested','Critical',2450000,'INR',30,40,true,'Fictional demo lead. Interested in a multi-team rollout.'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','Arjun Mehta','Chief Operating Officer','arjun.mehta@example.test','+91 98765 43212','LinkedIn','RNR','Medium',1250000,'INR',20,18,true,'Fictional demo lead.'),
  ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','Sara Thomas','Procurement Lead','sara.thomas@example.test','+91 98765 43213','Campaign','Meeting Scheduled','High',3200000,'INR',50,55,true,'Fictional demo lead. Discovery meeting scheduled.')
on conflict (id) do nothing;

insert into public.lead_stage_history (lead_id, to_stage, changed_by)
select id, status, created_by from public.leads
where id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004')
and not exists (select 1 from public.lead_stage_history h where h.lead_id = leads.id);
