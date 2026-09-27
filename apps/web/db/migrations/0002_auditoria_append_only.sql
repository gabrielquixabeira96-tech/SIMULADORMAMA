-- 0002_auditoria_append_only — ADR 0002 item 4: auditoria é append-only.
-- O role da aplicação é dono do banco em ambiente local (REVOKE no dono não tem efeito),
-- então a garantia é feita por gatilho, válido para qualquer role. Em produção, somar
-- REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM <role_da_aplicacao>.

create or replace function auditoria_bloquear_alteracao() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria e append-only: % proibido', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger auditoria_sem_update_delete
  before update or delete on auditoria
  for each row execute function auditoria_bloquear_alteracao();

create trigger auditoria_sem_truncate
  before truncate on auditoria
  for each statement execute function auditoria_bloquear_alteracao();
