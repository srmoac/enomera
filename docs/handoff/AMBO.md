# Handoff AMBO: após o comparativo AB

Atualizado em18/11/2026, fuso America/Sao_Paulo.

## Identidade técnica e ponto de partida
- Repositório: https://github.com/srmoac/lotus-app
- Branch de continuidade: `codex/ambo-direction-a`
- Commit de código aprovado: `0d071f15993213ec6bb0d7d2f86010991ad28198`
- Produção: https://ambo-enomera.vercel.app/
- Deployment de produção: `dpl_8hzw1Cn66NRMgQ7AhVtZgpDYcao1`
- Projeto Vercel: `prj_Ha5dZAHSyqrKjwr1c2NIJtNYAujp` (`lotus-app`)
- Checkout de trabalho: `C:/Users/mrsao/Documents/Codex/ambo-direction-a`
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
Base53eb17f. Direção A celeste aplicada a superfícies, seleção, ações e foco, sem confundir com confirmação. Código funcional A445c819: lens única, tap e drag1:1 com limiar horizontal8px e prioridade de rolagem vertical; escolhas persistentes ao avançar/voltar; multiseleção de dias; revisão com indicação de alterações; última data/horário vence. Solicitação enviada é aviso âmbar, consulta confirmada é sucesso verde. Sem consulta real enviada pela demo.
Revisão unslop-ui0d071f1 só duas strings components/intake.tsx e patient.tsx: remove instrução repetida na revisão, mantém 'A consulta ainda não está agendada.'; acompanhamento pendente agora 'Aguarde a definição do horário.' Sem CSS/lógica alterados. app/lotus.css é referência de material original para Enomera: glass-fill .24, borda branca.86, blur14 e sombra interna.

## Validação e continuidade
Build19 páginas, tipos e domínio8; Chromium17/WebKit16 na A, mais verificações isoladas. Dois fluxos afetados passaram após texto; contador9→9 por casos funcionais. Principal conferiu Presencial→Online→Presencial, avanço/retorno com última opção e foco no título em390px. Evidências C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence: entrega.md, comparativo.html, unslop-ui-relatorio.md, ambo-direcao-a-1280.webm e ambo-direcao-a-390.webm. Vídeos completos1×.
Rota inicial para revisão: /solicitar/modalidade. Testar gesto interrompido, teclado, retorno e distinção solicitado/confirmado. Figma https://www.figma.com/design/Cm4lNuhjY9N4Mg0P4WExXK?node-id=14-74: seis frames e tokens sincronizados; Figma não inclui última revisão textual. Chat01a1d983-22a8-76e1-9485-7a2eb7e5962b.

## Verificação pós-publicação
Domínio de produção aberto no navegador integrado e conteúdo esperado renderizado. Target production, estadoREADY, SHA e alias conferidos na API Vercel. Esta é uma verificação de abertura/versão, não repetição de toda a suíte E2E em produção. Logs históricos de runtime e drains/monitoramento não foram auditados nesta release; não afirmar ausência global de erros.
