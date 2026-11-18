# Enomera — Direção A para revisão

18 de novembro de 2026. A Direção B foi descartada. Esta rodada publica somente previews; os domínios de produção foram preservados.

## Versões navegáveis

| Projeto | Commit publicado | Preview e rota | Testar |
|---|---|---|---|
| Enomera | ef50207 | https://enomera-6mwhh8rpu-marcosvmgs-projects.vercel.app/ | Scroll curto, flor→serviços, reverso, combinação e fechamento |
| Ambo | 445c819 | https://lotus-app-git-codex-ambo-direction-a-marcosvmgs-projects.vercel.app/solicitar/modalidade | Trocar Online/Presencial, interromper, avançar e voltar |
| Minne | ab7ccb2 | https://compasso-app-git-feat-minne-direction-a-marcosvmgs-projects.vercel.app/agenda/ | Trocar datas, selecionar atendimento, abrir ficha e retornar |
| Etha | 9f7712c | https://etha-enomera-5675ee3ph-marcosvmgs-projects.vercel.app/#formatos | Formato→briefing→aplicar no painel→prévia→desfazer |

A revisão do portfólio é acrescentada após sua validação final. Os previews podem exigir a sessão Vercel do proprietário. A proteção não foi desabilitada.

## Figma sincronizado

- [Flor / mapa das cinco pétalas](https://www.figma.com/design/R4FYsZmgvfyA1ESAlTuOCY?node-id=3-285), [legenda editável](https://www.figma.com/design/R4FYsZmgvfyA1ESAlTuOCY?node-id=20-2).
- [Ambo / modalidade e preferências](https://www.figma.com/design/Cm4lNuhjY9N4Mg0P4WExXK?node-id=14-74): seis frames e tokens celestes sincronizados; seleção e status têm papéis separados.
- [Minne / Agenda](https://www.figma.com/design/EGOOS30HQxPd7FoAFuEWbl?node-id=13-155): cinco frames com a paleta mineral; painel de atendimento selecionado acrescentado com tokens vinculados na coluna30:54.
- [Etha / painel](https://www.figma.com/design/fTjG4Bsq3zSgYdCV2JZ0fw?node-id=2-153): frames canônicos, tokens lavanda e identidade independente da Helena preservada.

## Gravações reais

| Percurso | Desktop | Mobile emulado |
|---|---|---|
| Enomera flor→serviços | [16,8 s](C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/enomera/enomera-flor-servicos-1280.webm) | [15,52 s](C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/enomera/enomera-flor-servicos-390.webm) |
| Ambo modalidade→revisão | [Vídeo](C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/ambo-direcao-a-1280.webm) | [Vídeo](C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/ambo-direcao-a-390.webm) |
| Minne datas→contexto | [Vídeo](C:/Users/mrsao/Documents/Codex/2026-11-14/o-usu-rio-pediu-um-chat/outputs/minne-direction-a/minne-direction-a-desktop.webm) | [Vídeo](C:/Users/mrsao/Documents/Codex/2026-11-14/o-usu-rio-pediu-um-chat/outputs/minne-direction-a/minne-direction-a-mobile.webm) |
| Etha briefing→prévia | [Vídeo](C:/Users/mrsao/Documents/Codex/etha-direction-a-2026-11-18/qa/direction-a/journey-desktop.webm) | [Vídeo](C:/Users/mrsao/Documents/Codex/etha-direction-a-2026-11-18/qa/direction-a/journey-mobile.webm) |

Os vídeos desses quatro produtos foram reproduzidos integralmente a1× pelos chats responsáveis, além da inspeção de quadros. Capturam interfaces operadas, sem montagem de capturas estáticas para simular interação. A captura mobile da Enomera usa wheel nativo em viewport emulada; Ambo, Minne e Etha incluem toque emulado. Nenhum teste foi feito em iPhone físico.

## Revisão cruzada pelo orquestrador

Enomera: os cinco caminhos renderizados têm as cores exatas; a última seleção da combinação coincide com o resumo; destaque de modalidade único; retorno preserva modalidade, dias e período. Portal mantém rascunho entre telas. Scroll em reverso e restauração foram testados.

Ambo: Presencial→Online→Presencial, avanço e retorno conservaram Presencial e foco no título. Preview390px sem overflow ou erro de console.

Minne: mudança rápida até02dez exibiu o estado vazio da última data.24nov→selecionarAna→ficha→retorno preservou consulta e foco na ação de origem. Seleção mineral e confirmação verde coexistem. Estado vazio final conferido sem destaque residual.

Etha: formato várias páginas chegou ao briefing; título editado foi preservado. O painel apresentou o rascunho anterior e ofereceu aplicação explícita do briefing. Aplicar mostrou o mesmo título na prévia; Desfazer recuperou o original.390px sem overflow ou erro de console.

## Comparação e limites

- [Antes / Direção A dos produtos reais](COMPARISON.md), incluindo as superfícies sob Liquid Glass.
- [Prancha interativa das amostras Enomera](https://enomera-6mwhh8rpu-marcosvmgs-projects.vercel.app/avaliacao.html), com opção390px e ocultação de assinaturas somente na avaliação.
- Chromium, WebKit e movimento reduzido foram exercitados; WebKitWindows e toque emulado não equivalem a Safari/iPhone real.
- Hardware físico, teclado virtual e desempenho de GPU de aparelho modesto permanecem sem validação. Não foi prometido um FPS de telefone com base na máquina de desenvolvimento.
- Links navegam entre aplicações independentes. Não há sincronização real de pacientes, consultas, autenticação, briefing ou publicação entre produtos. Salvar localmente continua diferente de publicar.
