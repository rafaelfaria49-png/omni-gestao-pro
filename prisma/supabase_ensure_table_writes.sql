-- Rode no SQL Editor se aparecer erro do tipo "Target table is not updatable" ou falhas de INSERT/UPDATE via pooler.
-- Confirma que o objeto é TABLE (não VIEW) e desliga RLS nas tabelas do app (conexão Prisma usa o role do pooler).

SELECT c.relname AS name,
       CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE c.relkind::text END AS kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'clientes_importados', 'estoque_produtos', 'categorias_produto', 'ordens_servico',
    'logs_auditoria', 'ledger_snapshots', 'whatsapp_pending_actions', 'app_loja_settings'
  );

ALTER TABLE IF EXISTS public.clientes_importados DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.estoque_produtos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categorias_produto DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ordens_servico DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.logs_auditoria DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ledger_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.whatsapp_pending_actions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_loja_settings DISABLE ROW LEVEL SECURITY;

-- Verificação (opcional): rls_on = true significa RLS ainda ativo na tabela.
-- SELECT c.relname, c.relrowsecurity AS rls_on
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
--   AND c.relname IN ('clientes_importados','estoque_produtos','categorias_produto');
