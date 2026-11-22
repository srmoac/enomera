# Handoff MINNE: após o comparativo AB

Atualizado em18/11/2026, fuso America/Sao_Paulo.

## Identidade técnica e ponto de partida
- Repositório: https://github.com/srmoac/compasso-app
- Branch de continuidade: `feat/minne-direction-a`
- Commit de código aprovado: `ae0ecd023ef1bd8ffa852912ea7660a8a0fd7559`
- Produção: https://minne-enomera.vercel.app/
- Deployment de produção: `dpl_3sbE2t88Th3qVtRcNyPXk4Es3TYL`
- Projeto Vercel: `prj_ZFMLvlAjgHYn4Qc8ak6AUi0tbzmn` (`compasso-app`)
- Checkout de trabalho: `C:/Users/mrsao/Documents/Codex/2026-11-14/o-usu-rio-pediu-um-chat/minne-direction-a`
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
Base31c7c08. Direção mineral no contexto selecionado de agenda e detalhe; confirmação verde independente. Nome/paciente continuam entre telas. Retorno da ficha preserva consulta, seleção, rolagem e foco de origem. Foto decodificada antes da troca; HugeiconsAnimated ativa por ação sem loops de hover. Código final Aab7ccb2 corrige indicador residual em data vazia.
unslop-ui ae0ecd0 remove cinco textos redundantes e simplifica dois: 'Registro concluído. Seu dia continua.'→'Registro concluído'; 'Apresentação pública'→'Apresentação profissional', pois edição é local. Sem lógica, hooks, dados, CSS ou fonte alterados. Contador14→14, sete problemas manuais corrigidos; demais candidatos eram função real.

## Validação e continuidade
Build59 páginas, tipos,17 regressões de editor/perfil/a11y/A Chromium-WebKit e três verificações adicionais de cinco telas1440/390 e conclusão com persistência/versionamento. Principal conferiu última data vazia02dez,24nov→Ana→ficha→retorno restaurando foco Abrir ficha do paciente. Estado vazio final sem realce fantasma.
Relatório docs/unslop-ui.md no checkout; evidências ../outputs/minne-direction-a e ../outputs/minne-unslop-ui. Vídeos minne-direction-a-desktop.webm/mobile.webm reproduzidos1×. Rota /agenda/. Figma https://www.figma.com/design/EGOOS30HQxPd7FoAFuEWbl?node-id=13-155: cinco frames e painel mineral com badge verde na coluna30:54; tokens vinculados, sem última copy. Chat01a1d983-0204-7e50-882b-45e0473e8667.
A revisão automática inicialmente rejeitou promoção porque não reconheceu IDs. Principal reconferiu get_deployment pelo hostname: projeto compasso-app/prj_ZFMLvlAjgHYn4Qc8ak6AUi0tbzmn, commit aprovadoae0ecd0. A criação do build production posterior foi autorizada e aceita.

## Verificação pós-publicação
Domínio de produção aberto no navegador integrado e conteúdo esperado renderizado. Target production, estadoREADY, SHA e alias conferidos na API Vercel. Esta é uma verificação de abertura/versão, não repetição de toda a suíte E2E em produção. Logs históricos de runtime e drains/monitoramento não foram auditados nesta release; não afirmar ausência global de erros.
