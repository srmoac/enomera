# Contratação da Enomera · percurso aprovado no Figma (22 nov 2026)

Fonte: arquivo Figma `R4FYsZmgvfyA1ESAlTuOCY`, seção `76:696` (“Contratação corrigida para aprovação”), aprovada pelo Marcos em 22 nov 2026.
Desktop D1 `77:745` → D2 `77:1153` → D3 `77:1232` → D4 `77:1406` → D4b `77:1502` → D5 `77:1599`; mobile `78:745` a `78:1491`; estados só Ambo `77:848`, licença `77:948`, retorno `77:1050`, código incorreto `77:1319`; especificação `78:1906`.

## Percurso

`/checkout` (Escolha) → `/conta` (e-mail, depois código) → `/checkout?etapa=revisao` (Checkout) → Ativando (1,4 s) → `/portal`.

| Etapa | O que a tela mostra |
|---|---|
| Escolha | Cartões Ambo, Minne e Etha com preço e periodicidade; “Sua combinação” com Mensal ou Licença permanente, linhas por produto, desconto do combo como linha (−R$ 19,00), total e “Cobrado hoje: R$ 0,00 · nenhum cartão solicitado”. Só Ambo: o desconto some e vira a dica “Adicione Minne e economize R$ 19,00/mês”. Licença: R$ 790 + R$ 1.390, hospedagem e suporte “em definição”, desconto do combo na licença “em definição”. |
| Conta | Só e-mail profissional, “Enviar código”. Quem já tem conta usa o mesmo campo. Sem senha e sem nome antes da verificação. |
| Código | Seis dígitos, colar preenche todos, “Reenviar código em m:ss · Trocar e-mail”. Erro: “Código incorreto. Confira os 6 dígitos ou peça um novo código. Sua combinação continua guardada.” |
| Checkout | “✓ Conta verificada · nome · e-mail”, cartões escolhidos (o que ficou de fora aparece como “Não incluído”), “Ao ativar”, “Alterar combinação” e “Ativar sem cobrança hoje”. |
| Retorno | “↻ Você voltou da revisão. … foram mantidos; a conta continua verificada.” e “Voltar à revisão”. |
| Ativando | Botão “Ativando…”, resumo mantido e “se você sair, a ativação continua”. |
| Portal | “✓ Ambo e Minne ativos · cobrado hoje R$ 0,00” e “Sua combinação: … · Alterar”. |

Saíram da interface: a versão interna do catálogo, os selos de simulação, o seletor de resultado do pagamento, a chave de idempotência visível, o menu interno “Planos e checkout” (agora “Outros serviços”) e o login com senha nas telas do percurso.

## A combinação é estado da conta

- Antes da verificação a escolha fica na aba (`sessionStorage`).
- `POST /api/v1/auth/email-code/verify` recebe a escolha e grava na conta (`professional_accounts.ui_preferences_json.commercialSelection`); sem migração.
- Depois de verificada, cada mudança vai para `PUT /api/v1/commercial/selection`; ao recarregar ou entrar em outro aparelho, `GET /api/v1/commercial/selection` devolve a mesma escolha.
- `POST /api/v1/commercial/orders` com `billing` (`monthly` | `permanent`) ativa sem cobrança hoje (`due_today_cents = 0`) e registra `billing_mode` (`monthly` ou `permanent_hypothesis`). Chamadas antigas sem `billing` seguem iguais.

## API nova

| Rota | Uso |
|---|---|
| `POST /api/v1/auth/email-code/request` `{ email }` | Envia o código (mesma resposta para conta nova ou existente). Intervalo mínimo de 20 s no servidor; a tela pede 60 s. |
| `POST /api/v1/auth/email-code/verify` `{ email, code, selection? }` | Confere o código (uso único, 5 tentativas, 15 min), cria a conta se o e-mail for novo, abre a sessão e devolve `selection` e `contract`. |
| `GET/PUT /api/v1/commercial/selection` | Lê e grava a combinação da conta. |
| `POST /api/v1/catalog/quote` | Agora inclui `contract`, o resumo no formato da tela. |

Senha, cadastro e recuperação antigos continuam na API para os testes e para as contas fictícias.

## Decisões tomadas sem consulta (reversíveis)

1. Conta nova pelo código recebe o nome a partir do e-mail (`helena.duarte@…` → “Helena Duarte”); a pessoa ajusta em Perfil. O Figma tira o nome da etapa de conta.
2. Etha aparece com preço do projeto e não entra no total mensal; com Etha sozinha o total vira “Projeto Etha”. O formato (página única ou até quatro páginas) ficou num seletor discreto sob o cartão, para não perder o que já existia.
3. O portal recebeu o aviso de ativação e a linha “Sua combinação”, mas o painel “Seu dia, com clareza” do D5 não foi refeito nesta entrega.
4. Teste comercial de 7 dias e piloto continuam no portal, fora do percurso.
5. Em homologação sem Resend, o código aparece numa caixa “Homologação sem envio externo” com “Preencher”. Com `RESEND_API_KEY` e `RESEND_FROM_EMAIL` no Preview, a caixa some e o e-mail é enviado.

## Verificação

- `npm test`: 19 testes, incluindo `tests/contract-flow.test.mjs` (resumo, só Ambo, licença, Etha, código incorreto, código reutilizado, combinação preservada por conta, ativação com R$ 0 hoje).
- `node scripts/verify-contratacao.mjs`: 120 verificações no Chromium em 1440 × 1000 e 390 × 844, nos cenários combo, só Ambo e licença (escolha → conta → código incorreto → código colado → revisão → retorno → recarregar → ativando → portal), sem erros no console e sem rolagem horizontal.
- Capturas em `evidence/`.
- WebKit não estava instalado no ambiente desta rodada; o script aceita incluí-lo de novo.
