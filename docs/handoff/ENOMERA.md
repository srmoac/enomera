# Handoff ENOMERA: após o comparativo AB

Atualizado em18/11/2026, fuso America/Sao_Paulo.

## Identidade técnica e ponto de partida
- Repositório: https://github.com/srmoac/enomera
- Branch de continuidade: `codex/direcao-a-ecosistema`
- Commit de código aprovado: `faf057a0b3787db8d3c2e47a09bc925e848a8676`
- Produção: https://enomera.vercel.app/
- Deployment de produção: `dpl_H9F3AfGG5W5ATPUqXcYi6mZC1GyS`
- Projeto Vercel: `prj_yCMNpwedHPxYdHZ4lycMfeYkkWun` (`enomera`)
- Checkout de trabalho: `C:/Users/mrsao/OneDrive/Documentos/ChatGPT/Enomora`
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
Base avançada2a596b7 preservada. Flor em assets/flower.svg e brand.svg: ordem dos cinco caminhos Minne superior, Etha esquerda, Ambo direita, Enomera inferiores. Corrigido petal-model.js para ['minne','etha','ambo',null,null]; inferiores não apagam. petals.js mantém scroll nativo, curva independente por pétala, chegada medida ao produto, reversão e leituras agrupadas antes das escritas. Sem scroll hijacking.
public/direction-a.css separa tokens de produto e estado. public/avaliacao.html compara amostras embutidas com baseline congelada evaluation-before; não é comparação das aplicações completas. Opção de ocultar marcas só na avaliação.
Motion inicial ef50207 eliminou realce duplicado e dimensões animadas. Após unslop897dddc, revisão2431610 corrigiu hover/saltos, acordeão reversível220/160ms, entrada de conteúdo sem deslizar botões, diálogo com saída progressiva e select base-select progressivo com fallback nativo. O usuário apontou que a simplificação perdeu Liquid Glass: a correção FINAL faf057a restaurou material de lentes, botões, dias e modalidade, checkbox personalizada sem perder semântica, Voltar arredondado e hover com elevação1px/press.985. Lente mede largura/altura estáticas e anima só translate, sem scale deformando corner radius. Não restaurar o recorte plano da revisão2431610 nem pressão genérica com afundamento.
Principais arquivos: public/index.html, app.js, services.js, petals.js, petal-model.js, motion.js, motion.css, direction-a.css. Scripts npm run dev (4319), npm run build, npm test.

## Validação e próximos passos
Quatro testes domínio/geometria e build/sintaxe passaram. Primeira A exercitada Chromium/WebKit e390/1280 normal/reduzido. Revisão final glass: portal ativar/desativar checkbox e foco conferidos desktop; build passou. Última passada motion não concluiu mobile porque override permaneceu1440: não declarar mobile final validado. Ver docs/motion-refinement/REVIEW.md (histórico2431610) e glass-controls.png (correçãofaf057a). Falta consolidar CSS sobreposto em mudança separada com regressão visual; não apagar camadas cegamente.
Rotas: /, /#ambo, /#minne, /#combinacao, /#piloto, /portal. Testar modalidades/dias/período→revisão→voltar, combinação, acordeão reverso, menu teclado, diálogoEscape e select em diferentes engines.
Figma: https://www.figma.com/design/R4FYsZmgvfyA1ESAlTuOCY?node-id=3-285; legenda20:2. Vídeos em C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/enomera (desktop/mobile).

## Verificação pós-publicação
Domínio de produção aberto no navegador integrado e conteúdo esperado renderizado. Target production, estadoREADY, SHA e alias conferidos na API Vercel. Esta é uma verificação de abertura/versão, não repetição de toda a suíte E2E em produção. Logs históricos de runtime e drains/monitoramento não foram auditados nesta release; não afirmar ausência global de erros.
