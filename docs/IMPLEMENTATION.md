# Enomera — implementação demonstrativa

Referências consultadas em 17/11/2026: arquivo Figma `R4FYsZmgvfyA1ESAlTuOCY`, abertura `3:3`, narrativa `8:2`, combinação `8:71`, fechamento `8:96`, mobile `6:16`, portal `3:242`, identidade `3:282` e roteiro interno `3:300`. Foram consultados também Ambo `Cm4lNuhjY9N4Mg0P4WExXK` (`14:51`, `14:74`), Minne `EGOOS30HQxPd7FoAFuEWbl` (`13:62`) e Etha `fTjG4Bsq3zSgYdCV2JZ0fw` (`2:11`). A direção B não foi utilizada.

## Arquitetura

- Site estático em HTML, CSS e módulos JavaScript. Nenhuma biblioteca concorrente de scroll.
- `/`: apresentação, prévias interativas, combinação comercial e piloto.
- `/portal`: visão geral e navegação demonstrativa do profissional.
- `public/services.js`: destinos, disponibilidade e estrutura comercial centralizados.
- `public/style.css`: tokens semânticos, materiais, layout e adaptação móvel.
- Assets SVG exportados pelo Figma salvos localmente. Símbolo floral exclusivo da Enomera.
- Aplicações independentes não foram copiadas. Destinos legados de Lotus e Compasso permanecem na configuração apenas como referências, sem serem apresentados como novas versões finais.

## Fluxos

Ambo: apresentação → modalidade/dias/período → revisão → conclusão local, com retorno para editar. Não coleta dados pessoais. O preço de consulta exibido é um dado fictício do frame, não preço dos serviços Enomera.

Minne: prévia navegável entre Meu dia, Agenda, Pacientes e Solicitações. Consulta abre detalhe fictício. Não há prontuário no resumo geral.

Combinação: todas as sete combinações possíveis, além de nenhuma seleção. Alternância entre mensalidade e licença permanente. Pagamentos únicos e recorrência descritos separadamente. Nenhum preço, checkout ou desconto numérico.

Portal: resumo conforme serviços ativos, agenda, pacientes fictícios, solicitações respondidas localmente, edição de anotação fictícia em memória e Outros serviços. Apresentação adicional abre em diálogo sem perder o contexto. Recarregar restaura o cenário inicial. Não usa localStorage para informações clínicas.

Piloto: duas semanas gratuitas com dois a três profissionais. O teste comercial futuro de sete dias é descrito separadamente. Canal de inscrição não configurado; não há alegação de envio de dados.

## Materiais e movimento

Substratos originais, superfície óptica com gradientes, borda luminosa e backdrop-filter, conteúdo independente e estados de interação. Fallback sólido legível quando backdrop-filter não existe. Não há distorção de textos por filtro SVG.

Scroll nativo, sem interceptar wheel ou touch. Trecho horizontal conduzido pelo progresso vertical, com interpolação de aproximadamente 90ms e destino atualizado em cada gesto; sem snap magnético. Componentes reais das prévias entram por trajetórias individuais simples e terminam antes da leitura central. Não há screenshot por baixo. Movimento reduzido reorganiza o trecho horizontal em leitura vertical. Navegação retorna ao subir, ao foco e durante navegação por âncora.

Skills lidas: figma-design-to-code, Sites, apple-design, animate, find-animation-opportunities e design-taste-frontend. Regras incompatíveis com a composição explicitamente aprovada não substituem o Figma. Os repositórios de skills indicados pelo usuário foram consultados; capacidades pertinentes já estavam instaladas. Não foi invocada uma skill inexistente chamada `gestures`.

## Verificação e limites

- `npm test`: dois testes aprovados, incluindo as sete combinações em ambos os formatos de contratação.
- `npm run build`: exportação estática aprovada.
- Verificação de sintaxe de JavaScript aprovada.
- Script `scripts/verify.mjs` preparado para Chromium/WebKit em 1440, 1024, 768 e 390px, fluxos, overflow, erros e movimento reduzido. **Não executado**: o controle de navegador recusou a URL local por política de segurança. Não há comparação visual implementado/Figma nem validação de Safari real, touch físico, reversão e continuidade de motion. Não declarar fidelidade visual final aprovada.
- Os sites externos Helena/Lotus/Compasso não puderam ser inspecionados pela ferramenta web nesta sessão. As referências Figma atuais foram usadas.
- A montagem usa deslocamentos independentes, ainda sem coreografia curva detalhada ou refração dinâmica. O trecho horizontal é uma extensão da narrativa para cumprir o percurso solicitado; precisa de revisão visual junto da direção A.
- Mobile mantém as prévias funcionais abaixo dos textos; o Figma mobile compacto foi adaptado para comportar as interações. Essa adaptação precisa ser revisada visualmente.
- Não existem autenticação, SSO, sincronização, banco, envio, calendário conectado, pagamento ou contratação real.
- GitHub: conector autenticado como `srmoac`, sem repositório Enomera retornado e sem ação de criação disponível. Tentativa de usar credencial Git existente para criar repositório privado foi recusada pela revisão automática; nenhuma credencial foi obtida pelo script e ele foi removido. Requer autorização direta do usuário para retomar esse caminho.
- Vercel: nenhuma ferramenta ou credencial Vercel identificada. Não foi publicado preview remoto ou alterada produção.

## Próximos passos concretos

1. Autorizar/acessar navegador para QA visual e comparar os screenshots com os frames atuais.
2. Ajustar coreografia, material e geometria conforme comparação em desktop/mobile.
3. Concluir validação de teclado, WebKit e dispositivos físicos.
4. Criar repositório remoto autorizado, enviar commit e configurar preview Vercel em novo projeto.
5. Definir canal real de interesse antes de habilitar formulário.
