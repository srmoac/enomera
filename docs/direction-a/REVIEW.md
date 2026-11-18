# Revisão do orquestrador — em andamento

## Enomera

- Código mais recente: `5b547c7`, branch `codex/direcao-a-ecosistema`.
- Preview publicado e inspecionado: https://enomera-lsq5kgugh-marcosvmgs-projects.vercel.app/ — contém `8b64de5`, anterior ao refinamento do realce único.
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

## Pendências verificáveis

- Atualizar preview da Enomera para `5b547c7`: o conector Vercel foi desconectado durante o trabalho e a sessão CLI deixou de estar disponível. Reconexão solicitada ao usuário.
- Gravação Enomera em velocidade normal: navegador integrado não anuncia recurso de gravação. Capturas não foram apresentadas como vídeo.
- WebKit da nova versão Enomera e redução de movimento dinâmica ainda não foram executados pelo orquestrador nesta rodada. A evidência anterior de `docs/verification.json` pertence à base, não valida automaticamente esta alteração.
- iPhone físico e aparelhos de menor desempenho não estão disponíveis no ambiente. Viewport emulado não substitui hardware real; nenhum FPS de telefone foi alegado.
- Revisão dos outros produtos e sincronização dos links dependem das versões Direção A em conclusão nos chats correspondentes.
