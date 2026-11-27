# Política de Privacidade da Enomera

Versão piloto · 26 de novembro de 2026 (antes: 25 de novembro de 2026)

> Este texto foi escrito pela própria equipe da Enomera para o piloto e **ainda não foi revisado por advogado**. Ele descreve com honestidade como tratamos dados hoje e será revisto antes da abertura comercial ampla.

## 1. Quem é responsável

A Enomera, criada e conduzida por Marcos Martins, é a **controladora** dos dados dos profissionais que criam conta e dos visitantes do site. Para os dados dos pacientes registrados no Agendamento e no Consultório, o **controlador é o profissional** que os atende, e a Enomera atua como **operadora**, seguindo as instruções dele (veja o item 10).

Encarregado pelo tratamento de dados (DPO): Marcos Martins · mrsaocwork@gmail.com

## 2. Quais dados tratamos

**Profissionais**

- Cadastro: nome, e-mail, especialidade, registro profissional (CRP ou CRM), cidade.
- Cobrança: CPF ou CNPJ, plano escolhido e situação dos pagamentos. Dados de cartão ficam só com o Asaas.
- Uso: registros de acesso (data, hora, endereço IP) e ações importantes na conta, para segurança.
- Conteúdo do Site: textos e fotos que você publica no seu site.

**Pacientes (tratados em nome do profissional)**

- Identificação e contato: nome, e-mail, telefone, data de nascimento e, para menores, dados do responsável.
- Agenda: pedidos, consultas, remarcações.
- Dados de saúde: registros e prontuário escritos pelo profissional no Consultório. São **dados pessoais sensíveis** (art. 5º, II, e art. 11 da LGPD).

**Visitantes do site**

- Não usamos cookies de publicidade nem ferramentas de rastreamento de terceiros. O que guardamos no seu navegador está no item [Cookies e armazenamento no navegador](#cookies).
- A medição de uso só acontece se você permitir no aviso de privacidade, ou se você entrou no piloto por convite e aceitou no cadastro.

<a id="piloto"></a>

**Registro de uso do piloto (participantes convidados)**

Quem entra no piloto por convite concorda, no cadastro, com um registro de uso na Enomera (Agendamento, Consultório e Site) e no site publicado pelo Enomera Site. Registramos:

- telas abertas, tempo de uso ativo, rolagem e quando a pessoa volta;
- onde toca ou clica: posição relativa na tela e o nome do botão ou link (por exemplo, "Confirmar horário");
- campos usados e envio de formulário, **sem o conteúdo digitado**;
- erros técnicos, chamadas que falharam e tempo de carregamento;
- tipo de aparelho, sistema e navegador (sem endereço IP no registro).

Não registramos o que é escrito: prontuário, nomes ou dados de pacientes, mensagens e valores de campos ficam fora. Os textos de botões passam por um filtro que retira e-mails, números e nomes próprios antes do envio. Base legal: consentimento (art. 7º, I, da LGPD). Só a administração da Enomera vê esses dados, guardados na mesma infraestrutura da plataforma (Vercel e Neon). Eles são apagados até 90 dias depois do fim do piloto ou na hora em que o participante pedir para sair, por e-mail para mrsaocwork@gmail.com.

<a id="cookies"></a>

**Cookies e armazenamento no navegador**

Usamos um cookie e o armazenamento local do navegador (localStorage e sessionStorage) em dois grupos:

| Grupo | O que é | Precisa de permissão? |
| --- | --- | --- |
| Necessários | Cookies `enomera_sid` (sessão de login do profissional) e `enomera_psid` (sessão do paciente), só acessíveis pelo servidor, e chaves de sessão de cada serviço; rascunhos que você ainda não enviou (pedido de consulta, perguntas do Site, contratação); preferências de tela, como modo leve, tema e avisos já vistos; a sua escolha neste aviso (`eno_consent_v1`). | Não. Sem eles o serviço não funciona ou perde o que você digitou. |
| Medição de uso | Identificadores aleatórios do aparelho e da visita (`eno_uso_d`, `eno_uso_s`, `eno_uso_sa`, `eno_uso_sh`, `eno_uso_pu`) usados pelo registro de uso descrito abaixo. | Sim. Só são gravados se você clicar em Permitir, ou se você entrou no piloto por convite e aceitou no cadastro. |

Se você recusar, nada da medição é gravado no seu aparelho e nenhum evento é enviado. Você pode mudar a escolha quando quiser pelo link "Preferências de privacidade" no rodapé, e apagar tudo limpando os dados do site no seu navegador. Os dados de cookies e do armazenamento ficam no seu aparelho e não são compartilhados com terceiros.

## 3. Para que usamos e com qual base legal

| Finalidade | Base legal (LGPD) |
| --- | --- |
| Criar e manter sua conta e prestar os serviços | Execução de contrato (art. 7º, V) |
| Enviar códigos de acesso e avisos sobre a conta | Execução de contrato (art. 7º, V) |
| Cobrar a assinatura e emitir comprovantes | Execução de contrato e obrigação legal (art. 7º, V e II) |
| Registros de acesso por 6 meses | Obrigação legal (Marco Civil da Internet, art. 15) |
| Segurança, prevenção a fraude e melhoria dos serviços | Legítimo interesse (art. 7º, IX), sem uso de dados de saúde |
| Medição de uso para visitantes que permitiram no aviso | Consentimento (art. 7º, I), que pode ser retirado a qualquer momento |
| Guardar prontuário e registros clínicos | A pedido do profissional, para cumprir as obrigações dele (art. 11, II, "a" e "f") |

Não usamos dados de pacientes para nenhuma finalidade própria da Enomera.

## 4. Com quem compartilhamos

Usamos fornecedores que nos ajudam a operar. Cada um recebe apenas o necessário:

| Fornecedor | Para quê | Onde |
| --- | --- | --- |
| Vercel | Hospedagem dos sites e da aplicação | Estados Unidos |
| Neon | Banco de dados | Estados Unidos |
| Vercel Blob | Arquivos e fotos | Estados Unidos |
| Asaas | Cobrança (Pix, boleto, cartão) | Brasil |
| Google (Gmail) | Envio de e-mails com códigos e avisos | Estados Unidos e outros |
| Resend | Envio de e-mails (alternativo) | Estados Unidos |

Não vendemos dados. Também podemos compartilhar dados quando a lei ou uma ordem judicial exigir.

## 5. Transferência internacional

Parte dos fornecedores guarda dados fora do Brasil. Fazemos essa transferência com base no art. 33 da LGPD e no Regulamento de Transferência Internacional de Dados (Resolução CD/ANPD nº 19/2024), usando fornecedores com cláusulas contratuais de proteção de dados e medidas de segurança compatíveis com a lei brasileira. Estamos incorporando as cláusulas-padrão contratuais aprovadas pela ANPD aos contratos com esses fornecedores; até lá, dados clínicos dos pacientes só são guardados com as proteções do item 7. Você pode pedir a lista atualizada de fornecedores e países pelo e-mail do item 13.

## 6. Por quanto tempo guardamos

- Conta do profissional: enquanto estiver ativa. Após o cancelamento, 90 dias em modo somente leitura para exportação; depois, apagamos. Se você pedir a exclusão da conta no portal, o prazo é de 30 dias.
- Prontuário e registros clínicos: pelo tempo que o profissional determinar. As normas do Conselho Federal de Psicologia pedem guarda mínima de 5 anos (Resolução CFP nº 1/2009) e as do CFM, de 20 anos para prontuário médico. Antes de apagar a conta, o profissional recebe a exportação completa para cumprir esse dever.
- Dados de cobrança: 5 anos, por exigência fiscal.
- Registros de acesso: 6 meses.
- Registro de uso do piloto: até 90 dias após o fim do piloto, ou até o participante pedir para sair. Eventos de aparelhos não identificados: até 24 horas.

## 7. Como protegemos

- Conexões sempre criptografadas (HTTPS).
- Acesso por código de uso único, com tempo de expiração e limite de tentativas. Contas criadas por convite do piloto também podem usar e-mail e senha.
- Separação entre contas: um profissional nunca vê dados de outro.
- Acesso ao conteúdo clínico apenas por quem o profissional autorizou.
- Registro de ações importantes (auditoria) e cópias de segurança do banco de dados.

Nenhum sistema é totalmente imune a falhas. Se houver um incidente que possa causar risco ou dano relevante, avisaremos os afetados e a ANPD em até 3 dias úteis, como pede a Resolução CD/ANPD nº 15/2024.

## 8. Seus direitos

Você pode pedir, a qualquer momento: confirmação de que tratamos seus dados; acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informação sobre compartilhamento; e revogação de consentimento, quando ele for a base (art. 18 da LGPD).

Exportar seus dados, sair do registro de uso do piloto e excluir a conta são feitos direto no portal. Para os demais pedidos, escreva para mrsaocwork@gmail.com. Respondemos em até 15 dias. Pacientes devem fazer pedidos sobre dados clínicos ao profissional que os atende; nós o ajudamos a responder. Você também pode reclamar à ANPD (www.gov.br/anpd).

## 9. Crianças e adolescentes

Dados de pacientes menores de idade são tratados no melhor interesse deles (art. 14 da LGPD), com o cadastro feito pelo profissional e o acompanhamento do responsável legal quando exigido.

<a id="acordo"></a>

## 10. Acordo de Tratamento de Dados com o profissional

Esta seção faz parte dos Termos de Uso e vale entre você, profissional (controlador), e a Enomera (operadora), para os dados dos seus pacientes.

1. **Instruções.** A Enomera trata os dados dos pacientes apenas para prestar os serviços contratados e conforme suas instruções dadas pelo uso dos serviços.
2. **Sigilo.** Quem trabalha para a Enomera e precisa acessar dados se compromete com sigilo. O acesso ao conteúdo clínico pela Enomera só ocorre para suporte pedido por você ou por obrigação legal, e fica registrado.
3. **Suboperadores.** Você autoriza os fornecedores do item 4. Avisaremos por e-mail com 15 dias de antecedência antes de incluir um novo fornecedor que acesse dados de pacientes; você pode cancelar sem custo se não concordar.
4. **Segurança.** A Enomera mantém as medidas do item 7.
5. **Incidentes.** A Enomera avisa você em até 48 horas depois de saber de um incidente que envolva dados dos seus pacientes, com as informações disponíveis, para que você possa cumprir seus deveres perante a ANPD e os titulares.
6. **Direitos dos titulares.** A Enomera ajuda você a responder pedidos de pacientes, com ferramentas de exportação e correção.
7. **Fim do contrato.** Ao fim do contrato, você recebe a exportação completa dos dados. Depois do prazo do item 6, a Enomera apaga os dados, salvo obrigação legal de guarda.
8. **Comprovação.** A Enomera fornece, quando pedido, as informações necessárias para demonstrar o cumprimento deste acordo.

<a id="pacientes"></a>

## 11. Aviso aos pacientes

Se você é paciente e pediu uma consulta, entrou na área do paciente ou é atendido por um profissional que usa a Enomera:

- **Quem decide sobre os seus dados é o profissional** que atende você. A Enomera guarda e processa esses dados em nome dele, sem usá-los para nada próprio.
- **O que é guardado:** nome, contato, data de nascimento, os pedidos e horários de consulta e o que você escrever no pedido (por exemplo, o motivo da busca, que é opcional). O prontuário é escrito pelo profissional e fica sob sigilo profissional.
- **Para quê:** organizar o seu agendamento e o seu atendimento. Dados de saúde são tratados para a tutela da sua saúde, por profissional de saúde (art. 11, II, "f", da LGPD).
- **Com quem:** com ninguém além do profissional e dos fornecedores de hospedagem do item 4. Não vendemos dados nem usamos para publicidade.
- **Seus direitos:** peça acesso, correção ou cópia ao profissional que atende você. Se preferir, escreva para o e-mail do item 13 e nós repassamos o pedido a ele e o ajudamos a responder.

Não escreva no pedido de consulta nada que você não queira que o profissional leia antes do primeiro encontro. Em situação de crise ou risco, procure o CVV (ligue 188, 24 horas) ou o SAMU (192): o Agendamento não é um canal de urgência.

## 12. Mudanças nesta Política

Avisaremos mudanças importantes por e-mail e nesta página, com a data da nova versão.

## 13. Contato

Marcos Martins · Encarregado de dados · mrsaocwork@gmail.com
