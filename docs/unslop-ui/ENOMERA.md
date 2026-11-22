| Regra | Antes | Depois | Mantidos |
|---|---:|---:|---:|
| U1 chamadas acima de títulos, leitura manual | 8 | 0 | 0 |
| U2 numeração, contador | 3 | 1 | 1 |
| U3 instrução repetida, leitura manual | 2 | 0 | 0 |
| U6 informações concatenadas, contador | 9 | 9 | 9 |
| U11 emoji, contador | 1 | 1 | 1 |
| unslop 13 travessão, contador | 6 | 0 | 0 |
| Total heurístico | 19 | 11 | 11 |

**Reescritas**
- Veredito light. Fonte: felipebasurto/unslop-ui, instalada em C:/Users/mrsao/.codex/skills/unslop-ui. Sem --surface. O loader encontrou a outra skill unslop; as regras corretas de redação foram lidas em references/unslop-fallback.md. U1–U16 prevalecem.
- “Enomera — Uma experiência conectada” → “Enomera | Site, agendamento e gestão” (U8, unslop13).
- “Site, agendamento e gestão.” → “Site, agendamento e gestão” (pontuação de título).
- “Uma experiência conectada.” → “Para profissionais independentes” (U8). “Ferramentas para a rotina de profissionais independentes.” → “Ferramentas para a rotina de psicólogos e psiquiatras.” (U3). Os dois fatos já estavam na página.
- “Do primeiro contato à continuidade do cuidado.” → “Conheça os produtos” (U8).
- “Apresente seu trabalho.” → “Seu site profissional”; “Organize o encontro.” → “Agendamento e área do paciente”; “Continue o cuidado.” → “Gestão clínica” (U8).
- “Conhecer.”, “Agendar.”, “Acompanhar.” → mesmos verbos sem ponto (fragmentos de título).
- “Escolha o que faz sentido para sua prática.” → “Escolha seus serviços”; “Sua prática. Seus serviços.” → “Serviços selecionados” (U8).
- “Uma rotina melhor começa por experimentar.” → “Experimente os produtos” (U8).
- “Conheça os produtos com dados fictícios. Depois, conheça o primeiro piloto acompanhado.” → “Demonstrações com dados fictícios e um piloto acompanhado de duas semanas.” (U3; duração já aparece no piloto).
- “Um espaço para cuidar de você.” → “Consulta com Helena Duarte” (U8).
- “Confira suas preferências.” → “Confira suas preferências”; “Preferências registradas na amostra.” → “Preferências registradas” (fragmentos e U3; aviso local preservado).
- “Seu dia, com espaço para cuidar.” e “Seu dia, com clareza.” → “Meu dia” (U8). O título passa a repetir o nome da área selecionada.
- “PRÓXIMO ATENDIMENTO · 14H—14H50” → “Próximo atendimento · 14h–14h50” (unslop13/17; intervalo usa meia-risca).
- “Anotação de demonstração — use somente texto fictício” → “Anotação fictícia” (U7, unslop13). Campo mantém label visível e aviso de memória local.
- “Portal profissional — Enomera · Demonstração” → “Portal profissional | Enomera” (U6, unslop13; banner local preservado).

**Mantidos de propósito**
- As três etapas de solicitação têm ordem real. O candidato restante U2 é uma referência a data no código, não numeração decorativa. O contador não reconhece os elementos .eyebrow deste HTML; U1 foi contado pela leitura.
- U6: modalidade, duração, valor, data, disponibilidade, confirmação e natureza fictícia orientam a consulta. Não são indicadores de serviço remoto ativo.
- U11: o glifo de menu é um controle com nome acessível, não emoji decorativo.
- Sem alterações de CSS, cor, fonte, layout estrutural, motion, lógica ou dados. Sete chamadas decorativas e a saudação do portal foram removidas. Removidas também duas instruções redundantes; sem wrappers vazios.
- Build, sintaxe e quatro testes existentes passaram. Revisão visual em390/1440px; preview READY do commit897dddc: https://enomera-jqjopxflc-marcosvmgs-projects.vercel.app/. Produção preservada.

**Tarefas**
- [ ] iPhone físico, teclado virtual e GPU de aparelho modesto continuam sem validação física.
