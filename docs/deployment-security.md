# Deploy e seguranca do CriaBot

## Runtime suportado

O CriaBot usa `better-sqlite3` e arquivos locais em `data/*.sqlite` e `data/media`.
Por isso, ele precisa rodar em um host Node.js com filesystem persistente, como Square Cloud.

Ele nao e compativel com runtimes Edge/Workers, incluindo Cloudflare Workers e templates
Lovable baseados em runtime serverless sem filesystem persistente.

## Sessoes

O painel usa apenas o cookie `criabot_session` com `httpOnly`, `sameSite=lax` e `secure`
quando a URL e HTTPS. O token de sessao nao deve ser exposto para o JavaScript do navegador.

Cookies antigos como `criabot_session_public` e `botvendassl_session` sao apagados no logout,
mas nao sao mais aceitos para autenticar novas requisicoes.

## Webhooks

Os webhooks do Telegram exigem o header `X-Telegram-Bot-Api-Secret-Token`.
O valor e derivado do token de cada bot e enviado ao Telegram no `setWebhook`.

O webhook do Mercado Pago exige assinatura valida via `x-signature` e `x-request-id`.

O endpoint de cron `/api/public/broadcasts/run` exige `Authorization: Bearer CRON_SECRET`.
Nao registre esse header em logs.

## Multi-tenant

Bots de venda criados no painel usam bancos SQLite separados. O isolamento principal vem do
banco separado e do runtime ativo por request via `AsyncLocalStorage`.

O UpMidias ainda usa um banco proprio unico porque e um bot independente. Caso ele evolua para
varios bots de midia por usuario, deve receber a mesma estrategia de banco separado por bot.
