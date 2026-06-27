# CriaBot

Painel responsivo para criação e administração de bots de vendas, atendimento e
automação para diferentes tipos de negócio.

## O que já funciona

- cadastro e login reais com Supabase Auth;
- confirmação de e-mail com callback PKCE;
- cadastro com nome, telefone, confirmação e indicador de força da senha;
- criação, busca, ativação, pausa e edição de bots;
- onboarding inicial por Telegram/BotFather com nome, usuário e token;
- validação real do token via API do Telegram;
- registro de webhook quando existe uma URL HTTPS pública configurada;
- persistência no Postgres com isolamento por usuário via RLS;
- armazenamento do token em tabela separada sem leitura pelo navegador;
- configurações de conta e diagnóstico da infraestrutura;
- painel responsivo e PWA para desktop e celular.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Ativar Supabase

1. Crie um projeto no Supabase.
2. Copie `.env.example` para `.env.local`.
3. Preencha a URL e a chave **Publishable** obtidas no diálogo **Connect**.
4. Execute `supabase/migrations/202606210001_initial_schema.sql` no SQL Editor.
5. Em **Authentication > URL Configuration**, configure:

```text
Site URL: http://localhost:3000
Redirect URL: http://localhost:3000/auth/callback
```

Depois reinicie `npm run dev`.

Se o projeto já recebeu versões anteriores do schema, execute também:

```text
supabase/migrations/202606220001_generalize_platform.sql
supabase/migrations/202606220002_telegram_onboarding.sql
```

A primeira atualização adiciona telefone, remove campos antigos e recupera
usuários que estejam em Authentication sem uma linha correspondente em
`profiles`. A segunda adiciona a estrutura de integração Telegram.

## Webhook do Telegram

Para registrar webhooks do Telegram, configure uma URL HTTPS pública:

```env
CRIABOT_WEBHOOK_BASE_URL=https://seu-dominio.com
```

Em `localhost`, o CriaBot consegue validar o token e criar o bot, mas deixa o
webhook como pendente porque o Telegram não aceita webhook em URL local.

## Segurança implementada

- tokens de sessão em cookies com renovação no Proxy do Next.js;
- validação de sessão no servidor antes de conectar canais;
- RLS habilitado em todas as tabelas expostas;
- filtros de propriedade em todas as consultas;
- moderação geral e proteção anti-spam habilitadas nos bots;
- tokens de canais ficam em `bot_integration_secrets`, sem política de leitura
  para o navegador.

## Verificações

```bash
npm run lint
npm run typecheck
npm run build
npm audit
```

## Próxima fase

1. Processar mensagens recebidas no webhook e salvar conversas.
2. Adicionar fila de tarefas para respostas e automações.
3. Adicionar o bot-mestre que cria/configura bots por conversa.
4. Criar catálogo, ofertas e fluxos de venda por bot.
