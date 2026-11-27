# Coreografia floral contínua — 17/11/2026

## Implementação

`petals.js` mantém cinco elementos vetoriais persistentes. Os paths originais são carregados do SVG aprovado, sem redesenho. Cada pétala mantém seu elemento, pivô e identidade durante todo o percurso. Os símbolos de assinatura da navegação permanecem intactos.

O progresso usa scroll nativo e âncoras medidas da composição existente. Nenhuma seção foi alongada. Um controlador floral interpola poses com arcos individuais, repousos nos serviços e desaceleração de 85–121ms. O destino se atualiza em cada gesto; inverter o scroll parte da pose atual. Não há wheel/touch preventDefault, snap, filas ou filtro animado.

| Gatilho | Elemento | Transformação | Repouso |
| --- | --- | --- | --- |
| Entrada | Cinco pétalas | Abertura individual curta, com fases diferentes | Símbolo aprovado na abertura |
| Scroll para Site | Mesmo conjunto | Expansão em arcos laterais | Enquadramento da apresentação |
| Scroll para Agendamento | Mesmo conjunto | Aproximação com amplitudes distintas | Relação entre as superfícies |
| Scroll para Consultório | Mesmo conjunto | Distribuição ordenada | Continuidade ao redor da interface |
| Percurso horizontal | Mesmo conjunto | Aberto → encontro → organização | Poses ligadas ao progresso existente |
| Seleção de serviços | Pétalas associadas abstratamente aos serviços | Aproximação/afastamento, rotação e escala menores | Combinação atual, sem novos logotipos |
| Scroll para piloto | Mesmo conjunto | Convergência progressiva | Reconstrução da flor |
| Expandir piloto | Mesmo conjunto | Pequena abertura, com geometria recalculada | Composição acomodada ao painel |
| Navegar no portal | Conjunto persistente no documento do portal | Deslocamentos de até 8px e rotações até 5° | Fora das áreas principais de leitura |
| Focar campo | Pétalas | Interrompe gesto residual de repouso | Leitura e edição estáveis |

O repouso é um gesto finito e amortecido, com fases individuais; não existe loop contínuo enquanto o profissional lê. Aba invisível cancela o frame pendente. ResizeObserver e carregamento de fontes atualizam as âncoras. A camada decorativa é inerte, não recebe eventos e tem clipping na viewport, sem expandir a largura do documento.

Mobile mantém os cinco vetores, com escala e opacidade menores. Movimento reduzido elimina entrada, oscilação e interpolação ampla; os estados acompanham a posição atual sem deriva. A preferência pode mudar durante a sessão.

## Validação efetivamente realizada

- Quatro testes de lógica aprovados: sete combinações comerciais, seleção vazia, continuidade matemática nos limites da coreografia e estados das oito combinações florais.
- Build estático e sintaxe aprovados.
- Preview Vercel acessado no navegador incorporado (Chromium): `/` e `/portal`.
- Desktop 1440×900: abertura, passagem vertical por Site/Agendamento, narrativa horizontal, seleção rápida, expansão do piloto, acesso ao portal, troca Agenda/Registros, preenchimento fictício com foco visível.
- Mobile 390×844: abertura, presença floral, menu. A inspeção revelou um conflito de especificidade que fazia o menu usar posição relativa. Corrigido para posição absoluta no breakpoint mobile.
- Nenhum overflow horizontal nas medições feitas em desktop/mobile. Cinco vetores presentes, transformações independentes e nenhum erro de JavaScript capturado durante esses fluxos.
- Ajuste posterior à inspeção: pétalas de Site/Consultório/Conhecer deslocadas para espaços à direita; opacidade reduzida para preservar os textos.

## Limites

Não houve Safari/WebKit real, dispositivos físicos, touch/trackpad real, teste dinâmico da preferência de movimento reduzido ou gravação de vídeo. A interface de navegador disponível não expõe gravação nem emulação de media query. Screenshots não são apresentados como prova de ritmo. A continuidade entre rotas é de linguagem visual: o portal carrega outro documento e inicia seu conjunto próprio; não há transição compartilhada de elementos entre documentos.

As funcionalidades e dados continuam demonstrativos. Nenhuma integração clínica, autenticação ou cobrança foi adicionada. A pasta `work/` já estava presente e foi preservada sem entrar nos commits deste refinamento.
