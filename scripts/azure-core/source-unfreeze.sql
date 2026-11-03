-- SOURCE SUPABASE ONLY. Before Azure production writes, this reverses the freeze.
-- AFTER Azure writes: reconcile those writes first and disable the Azure timer.
-- Restore/promote the preserved source deployment with its matching cron secret.
begin;
update academy_cutover.state set active=false where singleton;
drop policy if exists academy_azure_storage_guard on storage.objects;
do $$ declare j record; begin
  for j in select s.jobid,s.was_active from academy_cutover.schedulers s join cron.job c using(jobid)
    where c.jobname='vfuture-exam-sweep'
  loop perform cron.alter_job(j.jobid,active:=j.was_active); end loop;
end $$;
commit;
