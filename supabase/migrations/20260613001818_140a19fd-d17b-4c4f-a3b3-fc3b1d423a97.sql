ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS welcome_image_url text,
  ADD COLUMN IF NOT EXISTS menu_buttons jsonb NOT NULL DEFAULT '[
    {"id":"plans","label":"💎 Ver planos","enabled":true},
    {"id":"contents","label":"🖼️ Comprar conteúdo","enabled":true},
    {"id":"myaccess","label":"🔑 Meus acessos","enabled":true},
    {"id":"support","label":"💬 Suporte","enabled":true},
    {"id":"terms","label":"📜 Termos e regras","enabled":true}
  ]'::jsonb;