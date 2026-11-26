# Comparação de motion da home

Grava a mesma sequência (descida completa, volta ao topo, pausa na Etha, reversão antes de parar,
interações no Ambo e no Minne, seleção de serviços e fechamento) em duas versões da home e compara
a posição das cinco pétalas quadro a quadro.

1. `git worktree add /tmp/ref 2b6facb` e `npm run build` na branch atual.
2. `node scripts/motion-compare/serve.mjs "$PWD/dist" 4101` e `node scripts/motion-compare/serve.mjs /tmp/ref/public 4102`.
3. `node scripts/motion-compare/record.mjs cur 4101 d1440` e `... ref 4102 d1440` (repita com `m390`, e `ref 4102 d1440 ref2` para medir o ruído entre execuções).
4. `node scripts/motion-compare/compare.mjs`.

Resultado em 22 nov 2026 (Chromium, commit 28abb0d contra 2b6facb): diferenças dentro do ruído entre
duas execuções da própria referência. Vídeos em `public/review/comparacao-motion-*-1x.mp4`.
Não cobre WebKit nem Safari físico.
