-- Execute este arquivo no Editor SQL do Supabase
-- (https://supabase.com/dashboard > seu projeto > SQL Editor)

CREATE TABLE IF NOT EXISTS public.abastecimentos (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       TIMESTAMPTZ DEFAULT NOW()             NOT NULL,
  km_atual         INTEGER                               NOT NULL,
  valor_pago       FLOAT                                 NOT NULL,
  litros           FLOAT,
  preco_por_litro  FLOAT,
  latitude         FLOAT,
  longitude        FLOAT,
  posto_nome       TEXT,
  cidade           TEXT
);

-- Índice para ordenação por data (usado na query de histórico)
CREATE INDEX IF NOT EXISTS idx_abastecimentos_created_at
  ON public.abastecimentos (created_at DESC);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.abastecimentos ENABLE ROW LEVEL SECURITY;

-- Política permissiva — app pessoal sem autenticação.
-- A API usa a service role key (bypassa RLS), então esta política
-- só entra em jogo se você adicionar autenticação depois.
CREATE POLICY "allow_all_service_role" ON public.abastecimentos
  USING (true)
  WITH CHECK (true);
