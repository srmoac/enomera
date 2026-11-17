# Enomera

Site institucional e comercial, demonstrações Etha/Ambo/Minne e portal profissional com dados fictícios, implementados a partir da direção A atual do Figma.

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

Saída estática em `dist`. Para hospedar na Vercel, usar build `npm run build`, diretório `dist`, e o rewrite de `/portal` no `vercel.json`. Não há backend.

Referências, fluxos, decisões, verificações e limitações: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

O resultado ainda requer QA visual em navegador. Nenhum envio, autenticação, cobrança ou integração clínica é real.
