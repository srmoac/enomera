# Enomera

Site institucional, contratação e portal profissional com Core API, implementados a partir da Direção A aprovada no Figma. A coreografia comercial de `2b6facb` foi preservada.

## Executar

```text
npm install
npm run dev
```

Endereço local: http://127.0.0.1:4319. Portal: http://127.0.0.1:4319/portal.

```text
npm test
npm run build
```

O build gera a interface em `dist`; `api/[...route].mjs` serve a API na Vercel. O ambiente Preview requer Neon Postgres (`DATABASE_URL`), Blob privado (`BLOB_READ_WRITE_TOKEN`) e Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). Credenciais ficam nas variáveis secretas da Vercel, nunca no repositório.

Referências, fluxos, decisões, verificações e limitações: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

Cadastro, códigos temporários, sessões, transferência entre produtos, escolhas, pedidos, ativação, fotos privadas e publicação versionada usam o servidor. Somente o pagamento é simulado, com cobrança efetiva de R$ 0. Não promover para produção sem aprovação posterior.

Os destinos `ENOMERA_PUBLIC_URL`, `ENOMERA_AMBO_URL`, `ENOMERA_MINNE_URL`, `ENOMERA_ETHA_URL` e `ENOMERA_HELENA_URL` devem apontar aos cinco Previews coordenados. Origens extras usam `ALLOWED_ORIGINS`. Não há destino de produção inferido no portal.

Para a validação local isolada, execute `node scripts/start-approved-local.mjs`. Ela usa SQLite, arquivos privados locais e caixa de e-mail de desenvolvimento; não comprova envio remoto. `npm test` cobre API, concorrência, isolamento e publicação. `node tests/browser-approved.mjs` cobre a contratação real local em Chromium/WebKit, 390/1440 px, incluindo retomada após recusa e outro navegador. O teste de caixa local recusa URLs remotas.

Estado de homologação: publicação remota, entrega real de e-mail, Safari físico e revisão independente dos Previews ainda precisam ser comprovados. As capturas locais não substituem esses testes.
