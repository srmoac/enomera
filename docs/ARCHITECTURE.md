# Arquitetura Compartilhada — Ecossistema Enomera (v1 Operacional)

> Nomes: os produtos se chamam Enomera Agendamento, Enomera Consultório e Enomera Site. Os identificadores internos (`ambo`, `minne`, `etha` em rotas, colunas, variáveis de ambiente e chaves de armazenamento) foram mantidos por compatibilidade e não aparecem para o usuário. Preços vigentes: ver `server/catalog.mjs`; os valores citados abaixo são históricos.

## 1. Visão geral e justificativa
Os cinco projetos do ecossistema preservam integralmente seus stacks, identidades visuais (Direção A) e motion aprovados, operando sobre **um único núcleo autoritativo de backend (`Enomera Core API`, `/api/v1/*`)** hospedado em `enomera/server/` (executado localmente via `scripts/server.mjs` e em Vercel Functions via `api/[...route].mjs`):

- **Enomera** (HTML/CSS/JS estático + Core API): apresentação comercial, cadastro/login/verificação/recuperação, catálogo comercial central, checkout simulado persistido, direitos de acesso, portal adaptativo e ciclo de vida.
- **Agendamento** (Next.js): perfil público, solicitação de 1ª consulta, verificação real do paciente, convites, reserva transacional, acompanhamento, remarcação, cancelamento e operação profissional independente (**Agendamento Solo**).
- **Consultório** (Next.js): rotina clínica, pacientes, agenda, solicitações vindas do Agendamento com detecção de duplicata, atendimento, rascunhos, registros concluídos com versões, **importação real de prontuários (6 meios)** e preferências.
- **Site** (HTML/CSS/JS estático): contratação simulada, capacidade configurável + lista de espera sem pagamento, briefing por etapas com anexos privados, **operação mínima de Marcos**, revisão consolidada, aprovação, rascunho/prévia/publicação em homologação e CTA configurável.
- **Helena Duarte** (Next.js): site publicado de cliente fictícia consumindo a versão publicada da Site e o destino real do CTA (perfil Agendamento quando ativo ou contato próprio quando inativo).

**Por que um único núcleo compartilhado?** Evita dois bancos de agenda divergentes entre Agendamento e Consultório, garante controle transacional real de conflitos de horário e aplica uma única política de autorização e auditoria no servidor.

## 2. Identidade, Autenticação e Passagem entre Domínios
- **Senhas**: `crypto.scryptSync` com salt aleatório de 16 bytes por usuário e comparação em tempo constante (`crypto.timingSafeEqual`).
- **Sessões**: tokens criptográficos aleatórios (32 bytes) armazenados apenas como hash SHA-256 na tabela `sessions`, com `expires_at`, `revoked_at`, `actor_type` (`professional` | `patient` | `operator`) e `mfa_verified_at` (verificação reforçada para operações clínicas sensíveis).
- **Verificação e recuperação**: tokens/códigos de 6 dígitos armazenados como hash em `verification_tokens`, uso único, expiração de 15 min e limite de tentativas.
- **Passagem autenticada entre domínios (`vercel.app` / localhost)**: subdomínios distintos não compartilham cookies. Ao navegar da Enomera para Agendamento/Consultório/Site, o backend emite um **código opaco de troca (`POST /api/v1/auth/handoff`)** com TTL de 60 segundos, uso único e validação de origem; o app de destino troca via `POST /api/v1/auth/exchange` por uma sessão autenticada. **Senhas, tokens de sessão e dados clínicos nunca trafegam em URLs.**
- **Revogação/Logout**: `POST /api/v1/auth/logout` revoga a sessão no servidor; qualquer requisição subsequente em qualquer app recebe `401` e limpa o estado protegido.
- **Entrega de e-mail/SMS**: abstraída por `NotificationTransport`. Sem provedor SMTP/WhatsApp pago configurado, a API informa explicitamente `deliveryStatus: "not_configured_local_outbox"` e grava a notificação no canal de homologação (`dev_outbox_messages`) sem jamais simular "e-mail enviado".

## 3. Separação de Atores, Fronteiras de Dados e Autorização
| Ator | Escopo permitido | Bloqueios rígidos no servidor (`403`) |
|---|---|---|
| **Profissional** | Própria conta, perfil, disponibilidade, pacientes operacionais, agenda, solicitações, prontuários/importações do Consultório (se entitlement ativo), projeto Site próprio. | Qualquer conta/paciente/prontuário de outro profissional; operação global de Marcos. |
| **Paciente** | Perfil público do profissional + após verificação real de contato: apenas suas próprias solicitações, consultas operacionais e pedidos de remarcação no contexto do profissional. | Qualquer dado de outro paciente; **100% do conteúdo clínico, rascunhos, versões e anexos clínicos do Consultório**; área comercial da Enomera. |
| **Operação Site (Marcos)** | Capacidade, lista de espera, briefings/anexos de projetos Site, propostas, revisões consolidadas e publicação em homologação. | **Zero acesso a prontuários, rascunhos, anexos clínicos ou agenda clínica do Consultório.** |
| **Responsável legal** | Modelado como vínculo explícito em `patient_guardians` (não gera autorização automática apenas por preencher campo de formulário). | Acesso sem vínculo verificado. |

## 4. Persistência, Concorrência, Idempotência e Arquivos Privados
- **Banco de dados**:
  - Desenvolvimento / testes / homologação autocontida: `node:sqlite` (Node 24 nativo) em modo `WAL`, `foreign_keys = ON`, transações exclusivas `BEGIN IMMEDIATE` que serializam reservas concorrentes de horários.
  - Cloud / Preview compartilhado: adaptador PostgreSQL pronto para **Neon Postgres** (integração Free Tier já instalada no time Vercel) via `DATABASE_URL` com a mesma estrutura relacional e restrições `UNIQUE`.
- **Fonte de verdade de agenda**: tabela única `appointments` com índice parcial único `UNIQUE(account_id, start_at) WHERE status IN ('confirmed', 'reschedule_requested')`. Duas confirmações/reservas concorrentes para o mesmo horário resultam em exatamente 1 sucesso (`200/201`) e 1 `409 SLOT_CONFLICT` com horários livres sugeridos.
- **Idempotência**: cabeçalho/campo `idempotencyKey` obrigatório ou suportado em `checkout`, `requests`, `confirm`, `reschedule`, `cancel` e `imports/commit`.
- **Fuso horário**: todas as datas são persistidas em ISO-8601 com offset explícito (`America/Sao_Paulo`, `-03:00`) e geradas dinamicamente a partir da data corrente (sem fixar novembro de 2026).
- **Eventos e recuperação (`sync_events`)**: toda transição crítica grava um evento de sincronização; em caso de falha/atraso simulável ou real, o registro autoritativo sobrevive ao recarregamento e permite retentativa segura (`POST /api/v1/sync/:id/retry`) sem duplicar a ação de negócio.
- **Arquivos clínicos e briefings (`private_files`)**: validados por magic bytes, tamanho máximo e SHA-256 no servidor; armazenados fora da pasta pública (`server/storage/private/` localmente ou **Vercel Blob Private** quando `BLOB_READ_WRITE_TOKEN` estiver configurado) e servidos apenas via `GET /api/v1/files/:fileId` com verificação de sessão + vínculo + escopo. **Nenhum prontuário tem URL pública.**

## 5. Catálogo Comercial Central (Simulação Versionada `2026-11-sim-v2`)
Todos os valores são calculados exclusivamente no servidor (o cliente nunca define preço nem direitos de acesso):
- Agendamento: `R$ 39/mês` · Consultório: `R$ 69/mês` · Combo Agendamento + Consultório: `R$ 89/mês` (economia explícita de `R$ 19` sobre `R$ 108`, sem somar 15%).
- Site Página única: `R$ 1.190` (50% entrada `R$ 595` + 50% saldo `R$ 595` na aprovação) + `R$ 39/mês` hospedagem/painel a partir da publicação.
- Site Até 4 páginas: `R$ 2.190` (50% entrada `R$ 1.095` + 50% saldo `R$ 1.095` na aprovação) + `R$ 39/mês` a partir da publicação.
- Licença permanente (`R$ 790` Agendamento / `R$ 1.390` Consultório): marcada como hipótese pendente de definição de hospedagem/suporte separados.
- Teste comercial: 7 dias sem cartão (datas reais calculadas pelo backend) vs Piloto acompanhado: 2 semanas (tabela `pilot_applications`).

## 6. Limitações de Conformidade Clínica Real
Passar nos testes funcionais e de isolamento **não certifica uso clínico real em produção**. Antes de aceitar prontuários reais de pacientes, ainda é obrigatório validar juridicamente: política de retenção/guarda CFP e LGPD, termo de consentimento, DPO, backup criptografado gerenciado, rotação de chaves e aprovação de provedor de e-mail/OCR (caso desejado).

## 7. Acréscimos de 27/11 na API do Agendamento (compatíveis)
Nenhuma rota existente mudou de formato; só entraram rotas e campos novos.
- **Ações da profissional (só a dona da agenda; outro papel recebe `403 OWNER_REQUIRED`)**:
  - `POST /api/v1/ambo/pro/requests/:id/decline` `{ message }`: encerra o pedido; o paciente vê "Não foi possível atender" com a mensagem.
  - `POST /api/v1/ambo/pro/appointments/:id/cancel` `{ reason }`: cancela a consulta, libera o horário e avisa o paciente.
  - `POST /api/v1/ambo/pro/appointments/:id/reschedule` `{ startAt, endAt, reason }` → `201`: propõe outro horário (`reschedule_requests.status = 'proposed'`, `initiated_by = 'professional'`). A consulta fica no horário atual até o paciente responder.
- **Resposta do paciente**: `POST /api/v1/ambo/patient/reschedules/:id/respond` `{ decision: 'accept' | 'decline' }`. Aceitar confere de novo se o horário está livre.
- **Overview da profissional**: novo `capabilities: { declineRequest, cancelAppointment, proposeReschedule }` (verdadeiro só para a dona), `account.timezone` e `proposedReschedule` por consulta. Clientes antigos ignoram os campos.
- **`GET /api/v1/ambo/patient/me`**: pedidos trazem `decline_message`; remarcações trazem `reason` e `initiated_by`.
- **Homônimos**: um pedido só reaproveita um paciente existente com o mesmo nome **e** o mesmo e-mail (ou o mesmo telefone quando não há dois e-mails diferentes). Cadastros juntados antes continuam visíveis para cada e-mail que fez pedido.
- **Migração 011**: colunas `consultation_requests.decline_message`, `declined_at`, `reschedule_requests.initiated_by` (padrão `'patient'`) e limpeza do link fictício de sala online em contas reais.
