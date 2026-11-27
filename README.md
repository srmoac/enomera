# Enomera Core

Site institucional, contratação, portal do profissional e a API central (Core) da Enomera. Os três produtos que usam esta API são **Enomera Agendamento**, **Enomera Consultório** e **Enomera Site**, cada um no seu repositório e publicados no mesmo domínio, por caminho: `/agendamento`, `/consultorio` e `/site`.

> Os identificadores internos `ambo`, `minne` e `etha` (rotas da API, colunas do banco, variáveis de ambiente e chaves de armazenamento) foram mantidos por compatibilidade. Eles não aparecem para o usuário.

## Executar

```text
npm install
npm run dev        # http://127.0.0.1:4319 (portal em /portal)
npm test           # API, cobrança, piloto, segurança e regressões da auditoria
npm run build      # gera dist/ (inclui /termos e /privacidade a partir de docs/legal)
```

Local usa SQLite e arquivos privados em disco; nenhum e-mail sai (os códigos aparecem na caixa de desenvolvimento quando `ENOMERA_ENABLE_DEV_OUTBOX=true`). `/termos` e `/privacidade` só existem depois do build.

## Publicação (Vercel)

`api/[...route].mjs` serve a API; `vercel.json` reescreve `/agendamento`, `/consultorio` e `/site` para os projetos de cada produto (endereços internos, que nunca viram link visível).

Variáveis de ambiente (segredos ficam só na Vercel, nunca no repositório):

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon). |
| `BLOB_READ_WRITE_TOKEN` | Arquivos privados (Vercel Blob). |
| `SMTP_USER` / `SMTP_PASS` ou `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Envio de e-mail. Basta um dos dois; o domínio próprio no Resend tem prioridade quando configurado. |
| `ENOMERA_PUBLIC_URL` | Domínio público. Links de e-mail e de convite saem sempre sobre ele. |
| `ENOMERA_CONTACT_EMAIL` | E-mail de contato mostrado nos e-mails, nos Termos e na Política. |
| `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_EMAIL` | Cobrança (Asaas). Sem a chave, nada é cobrado. |
| `CRON_SECRET` | Autoriza a rotina diária de retenção (`/api/v1/internal/retention`). |
| `ENOMERA_HEALTH_TOKEN` | Libera o detalhe de `/api/v1/health` (sem ele a resposta é mínima). |
| `ENOMERA_OPERATOR_PASSWORD`, `ENOMERA_DEMO_PASSWORD` | Senhas da operação e das contas de demonstração. Sem elas, são sorteadas. |
| `ENOMERA_REQUIRE_CLINICAL_STEPUP`, `ENOMERA_REQUIRE_PATIENT_CONSENT` | Travas opcionais (confirmação por código para área clínica; consentimento obrigatório do paciente). |
| `ALLOWED_ORIGINS` | Origens extras aceitas pela API. |

## Cobrança e piloto

- Convidados do piloto (convite conferido no servidor) usam tudo sem custo até 31/01/2027, sem cartão.
- Fora do convite, cada serviço tem 30 dias grátis uma única vez; depois, a continuidade depende da assinatura no Asaas.
- A ativação simulada só existe em teste (`ENOMERA_ALLOW_SIMULATED_CHECKOUT=true`) e é sempre recusada em produção.
- Preços vêm de `server/catalog.mjs` (39, 49, 59; combos 69, 79, 89, 99; anual = 10 mensalidades). Um teste falha se as telas divergirem.

## Documentos

- Arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Histórico da implementação: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).
- Termos e Política: `docs/legal/*.md` (viram páginas no build).
- Cópia de segurança do banco: [docs/BACKUP-BANCO.md](docs/BACKUP-BANCO.md).
