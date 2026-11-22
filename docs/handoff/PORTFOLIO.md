# Handoff PORTFOLIO: após o comparativo AB

Atualizado em18/11/2026, fuso America/Sao_Paulo.

## Identidade técnica e ponto de partida
- Repositório: https://github.com/srmoac/mrsaoc-portfolio
- Branch de continuidade: `codex/direction-a-portfolio-20261118`
- Commit de código aprovado: `6a42560a5aaf3b2e63378a0c7777616b05e36b15`
- Produção: https://mrsaoc-portfolio.vercel.app/
- Deployment de produção: `dpl_8wnTqMeeXR1yhS5hJfFKjSfXFGep`
- Projeto Vercel: `prj_G7ePRgwyUdQNg46j4B7cq3CSVUzN` (`mrsaoc-portfolio`)
- Checkout de trabalho: `C:/Users/mrsao/.codex/visualizations/2026/11/13/01a1d39f-17de-7d01-8d46-95fb1eccf523/direction-a-portfolio`
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
Base avançadae77b81d. Integra interfaces REAIS Ambo, Minne e Etha nos três cases com montagem curva independente por peça e uso interativo após montar. Preservar geometria, narrativa editorial, scroll, router e núcleo Safari; não substituir por screenshots nem iframes desconectados só para facilitar. Mobile prioriza gestos internos da amostra.
Código A1718bd1 integrou produtos atuais. Copy final6a42560 inclui nove substituições próprias em app/content.ts e sync pontual das versões Ambo0d071f1, Minneae0ecd0, Etha0f6f9e8. Arquivos de fontes em app/ambo-source, app/minne-source, app/etha-source; app/product-content/screens.json contém snapshots SSR, app/product-sources.ts registra origens. Atualizar fontes e snapshots pelo pipeline existente juntos. Não restaurar arquivos completos das fontes por cima dos adaptadores.
As últimas correções de motion/glass faf057a da Enomera institucional NÃO devem ser copiadas às amostras dos produtos: elas têm seus controles próprios. Não confundir Enomera embutida simplificada com app real.

## Validação e continuidade
A:85 testes, build e30 combinações Chromium/WebKit, larguras e reduzido; seis vídeos montagem desktop/mobile1×. Última copy: TypeScript, build10 páginas e25checks afetados;171 outros arquivos app idênticos à base. Um teste de título antigo Etha foi atualizado. Visual final Etha1280/390 e Ambo/Minne abertos390; sem nova matriz integral de gestos após copy. Um salto desktop veio do autoenquadramento do teste durante a transição; operação pela rolagem interna ficou estável, core não mudou.
Rotas /projetos/aplicativo (Ambo), /projetos/sistema-de-gestao (Minne), /projetos/website (Etha). Interfaces no capítulo04/05; rolar internamente. Principal verificou Ambo seleção/avanço/voltar; Minne consulta→ficha→retorno restaurando foco; Etha editar→prévia mantendo capítulo.
Relatório docs/unslop-ui/relatorio.md; review/unslop-ui/entrega.md. Gravações review/direction-a/montage-{aplicativo,sistema-de-gestao,website}-{1440,390}.webm. Preservar contrastes semânticos, avisos de demonstração e pesquisa pendente, e nome acessível de controles. Chat01a1d39f-17de-7d01-8d46-95fb1eccf523.

## Verificação pós-publicação
Domínio de produção aberto no navegador integrado e conteúdo esperado renderizado. Target production, estadoREADY, SHA e alias conferidos na API Vercel. Esta é uma verificação de abertura/versão, não repetição de toda a suíte E2E em produção. Logs históricos de runtime e drains/monitoramento não foram auditados nesta release; não afirmar ausência global de erros.
