# Handoff ETHA: após o comparativo AB

Atualizado em18/11/2026, fuso America/Sao_Paulo.

## Identidade técnica e ponto de partida
- Repositório: https://github.com/srmoac/etha
- Branch de continuidade: `feat/direction-a-etha`
- Commit de código aprovado: `0f6f9e80da54445608c462f09ced13fe25d89f6d`
- Produção: https://etha-enomera.vercel.app/
- Deployment de produção: `dpl_C8c9S68iC9xDCPyUgo8NttVkyktq`
- Projeto Vercel: `prj_KzyuSdYoCpo1RmXckW3gL5Yr8dtb` (`etha-enomera`)
- Checkout de trabalho: `C:/Users/mrsao/Documents/Codex/etha-direction-a-2026-11-18`
- Status da release: **READY em produção**, commit e domínio confirmados na Vercel; detalhes em RELEASE.json.

## Decisão que governa a continuidade
O usuário aprovou exclusivamente a Direção A do comparativo cromático AB: uma cor de pétala para cada serviço. A Direção B foi descartada, inclusive sua recomendação anterior. Não reinterpretar isso como autorização para neutralizar a identidade. Preservar Liquid Glass, transparência, borda iluminada, profundidade, fontes e motion funcional. Só a Enomera usa flor; produtos têm assinaturas tipográficas. Helena Duarte mantém identidade própria bordô #662E42.

Tokens A: Enomera institucional #5B70B2, tinta #202D50, base #F0F4FE; pétalas inferiores #DFE6FB e #CAD4F8. Etha: pétala #C7BDF4, superfície #F2EFFE, seleção rgba(199,189,244,.48), ação #53459A, foco #42367D. Ambo: #A4CFF6, #ECF6FE, rgba(164,207,246,.50), #235D94, #1D4E7D. Minne: #A6DDD8, #EDF8F7, rgba(166,221,216,.52), #1E625E, #174D4A. Estados semânticos independentes: sucesso #1B653E/#DFF4E8, aviso #7D5112/#F8EDD3, erro #992F49/#FBE8EE, indisponível #68738A/#EFF2F7.

## Cronologia e limites comuns
Após AB: aplicação A em código real e Figma; revisão de continuidade de estado/foco, motion e responsividade; gravações e comparativos; revisão textual felipebasurto/unslop-ui; correções adicionais de controles só na Enomera. Todos os previews foram explicitamente aprovados e o usuário autorizou deploy de todos em produção em18/11/2026. Até essa autorização, só previews eram permitidos; esta restrição histórica foi superada para esta release, não é autorização irrestrita para futuras mudanças.

unslop-ui instalada em C:/Users/mrsao/.codex/skills/unslop-ui. Escopo aplicado U1–U16 sem --surface: cortar redundância e slogans sem mudar paleta/layout/motion. Contador é heurístico, não nota de qualidade. O loader encontrou outra skill unslop homônima; usamos references/unslop-fallback.md para regras numeradas corretas. Skills UX/motion usadas: animate, apple-design, choreograph, animation-performance, review-animations e impeccable. Não aplicar recomendações genéricas que contradigam material aprovado. O usuário rejeitou explicitamente achatamento do vidro, hover estático e controles genéricos.

Aplicações continuam independentes: sem sincronização real de pacientes, consulta, autenticação, briefing ou publicação entre elas. Demonstrações usam dados fictícios; salvar local não equivale a publicar. Não inventar backend ou claims. Safari/WebKit emulado e toque emulado não equivalem a iPhone físico. Teclado virtual, GPU de aparelho modesto e hardware físico continuam pendentes. Não alegar FPS com base no desktop.

## Fontes e pacote de evidências
Pedido A: C:/Users/mrsao/.codex/attachments/8829806a-a6e3-4e59-9aa2-70aecdccc0f9/Texto colado.txt. Comparativo: C:/Users/mrsao/Downloads/comparativo-cromatico-ab.md.
Workspace principal: C:/Users/mrsao/OneDrive/Documentos/ChatGPT/Enomora. Ver docs/direction-a/ECOSYSTEM-REVIEW.md, COMPARISON.md, IMPLEMENTATION.md e REVIEW.md; docs/unslop-ui/ECOSYSTEM.md. Esses relatórios anteriores têm links de previews históricos, e vídeos/Figma anteriores à passada textual. Este handoff registra a release final. Não confundir commits só de documentação com código publicado.

## Release e operação
Equipe Vercel team_GNDrqYl3rrgjJm7oMqx2TKfT (marcosvmgs-projects). A tentativa de promover previews diretamente retornou422. A release foi recriada com target production a partir do deployment aprovado, mantendo o commit exato, sem mudar branches main. Não houve merge automático para main: próximas publicações de main podem sobrescrever esta release. Continue da branch/commit deste documento e reconcilie main conscientemente, sem reset destrutivo. Para rollback, inspecione histórico de produção na Vercel e selecione versão anterior; não adivinhe ID. Nunca publicar .env, credenciais, estado autenticado de navegador ou arquivos .vercel secretos.

## Implementação específica
Base0fc8083. Ferramenta lavanda independente da Helena (bordô#662E42, SourceSerif4/Manrope). Formato escolhido chega ao briefing; título/introdução seguem para painel/prévia; foto só entra apósdecode. Voltar restaura foco/rascunho/posição. Dados locais, sem publicação remota.
Principal encontrou precedência silenciosa de rascunho antigo. Correção funcional9f7712c mantém rascunho existente e oferece Aplicar briefing explicitamente, manter rascunho e Desfazer. Preserva foto/ação; não sobrescrever silenciosamente ao entrar por briefing.
unslop0f6f9e8 troca slogans por títulos concretos, remove nota interna Figma e rótulos redundantes; mensagem 'Rascunho salvo neste navegador. Não publicado.' Contador14→11; etapas reais, limite de foto, avisos externos e localidade mantidos. Último commit673a343 é só relatório, código aprovado/publicado0f6f9e8.

## Validação e continuidade
Tipos/sintaxe, domínio3, Chromium/WebKit, responsivo360/390/768/1024/1440, fotos/menu/teclado/reduzido e briefing/painel/aplicar/desfazer passaram. Principal conferiu várias páginas→briefing→novo título→painel com rascunho existente→aplicar→prévia→desfazer em390px.
Rotas /#formatos, /briefing?formato=varias, /painel?origem=briefing, /previa. Relatórios DIRECTION-A.md e UNSLOP-UI-REPORT.md. Evidências qa/direction-a e qa/unslop-ui; vídeos journey-desktop.webm/mobile.webm reproduzidos1×. Figma https://www.figma.com/design/fTjG4Bsq3zSgYdCV2JZ0fw?node-id=2-153 (comercial2:11, briefing2:112); não todas extensões do briefing foram frames separados. Condições comerciais existentes ainda precisam confirmação, não inventar preços/prazos.
Site independente Helena helenaduartepsi.vercel.app não é sexto deploy desta release. Chat01a1e9d0-9aea-71a0-b338-8d9fb3303ffc.

## Verificação pós-publicação
Domínio de produção aberto no navegador integrado e conteúdo esperado renderizado. Target production, estadoREADY, SHA e alias conferidos na API Vercel. Esta é uma verificação de abertura/versão, não repetição de toda a suíte E2E em produção. Logs históricos de runtime e drains/monitoramento não foram auditados nesta release; não afirmar ausência global de erros.
