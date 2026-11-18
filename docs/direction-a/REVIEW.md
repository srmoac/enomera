# Revisão do orquestrador — em andamento

## Enomera

- Código mais recente: `ef50207`, branch `codex/direcao-a-ecosistema`.
- Preview publicado e inspecionado: https://enomera-6mwhh8rpu-marcosvmgs-projects.vercel.app/ — contém `ef50207`, estado READY confirmado.
- Código atual testado localmente: http://127.0.0.1:4319/.
- Produção não alterada nesta rodada.

Validação visual e interativa no Chromium integrado, 1440×900 e 390×844: cinco caminhos com as cores exatas, scroll para frente e reverso, escolha rápida Presencial→Online→Presencial, avanço e retorno conservando Presencial/Ter/Qui/Tarde, combinação rápida com resumo coerente com a última seleção, portal sem erro de console e rascunho conservado entre suas telas. Nenhum overflow horizontal foi observado em 390 px.

Quatro testes de domínio/geometria passaram; build e verificação de sintaxe passaram. O teste das oito combinações preserva duas pétalas institucionais mesmo sem produtos selecionados.

## Revisão de motion

| Antes | Depois | Motivo |
|---|---|---|
| Duas lentes podiam acompanhar modalidade | Reuso de uma única `.motion-lens` | Uma escolha tem um único elemento para acompanhar |
| Lente animava largura e altura | Base fixa, translate e scale só no realce | Texto conserva proporção; reduz recálculo de layout |
| Consulta repetida a DOM por pétala | Leituras do contexto agrupadas antes das escritas | Evita alternância de leituras e escritas por caminho |
| Inferiores se apagavam conforme produtos | Inferiores sempre institucionais | Preserva mapa aprovado |

A revisão do código passou nesses pontos. O ritmo completo ainda exige as gravações solicitadas; não considero a aprovação de motion encerrada apenas por esses testes.

## Complemento de validação

Gravações reais desktop 16,8 s e mobile emulado 15,52 s concluídas e reproduzidas em velocidade normal. Relatório: C:/Users/mrsao/Documents/Codex/ambo-direction-a-evidence/enomera/relatorio.md. Oito combinações Chromium/WebKit × 390/1280 × normal/reduzido passaram sem overflow ou erros; cinco pétalas em cada estado. Scroll reverso e restauração de posição passaram. Mobile emulado foi rolado com wheel; não é dedo físico nem teste de iPhone.

Ambo445c819: preview real inspecionado em390px; modalidade Presencial preservada no avanço/retorno, foco título, sem overflow/console. Minne62aab7d: troca rápida de datas encerrou na última data vazia;24nov→selecionarAna→ficha→retorno preservou consulta selecionada e foco Abrirficha, sem overflow/console. Seleção mineral e confirmação verde coexistem.

Figma Ambo: tokens e51pinturas nos6frames sincronizados pelo orquestrador após carregar a página14:41; screenshot modalidade14:74 conferido. Não houve alteração de geometria ou dados.

## Pendências verificáveis

- iPhone físico, teclado virtual, Safari real e aparelhos de menor desempenho não estão disponíveis. Emulação não substitui hardware; nenhum FPS de telefone foi alegado.
- Etha9f7712c: revisão cruzada da correção aprovada no preview; aplicação explícita preserva rascunho anterior, prévia e desfazer funcionam em390px.
- Portfólio: integração e preview em conclusão; revisão cruzada ainda não encerrada.
- Figma Minne: painel sincronizado pelo orquestrador em13:155, coluna30:54; screenshot visual conferido.
