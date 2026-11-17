export const services=[
 {id:'ambo',name:'ambo',description:'Agendamento e área do paciente',billing:'Mensal ou licença permanente',destination:'#ambo',availability:'embedded-demo',legacy:'https://lotus-app-phi.vercel.app/'},
 {id:'minne',name:'minne',description:'Gestão clínica e continuidade',billing:'Mensal ou licença permanente',destination:'#minne',availability:'embedded-demo',legacy:'https://compasso-app-seven.vercel.app/'},
 {id:'etha',name:'etha',description:'Site exclusivo para o profissional',billing:'Projeto + hospedagem e painel separados',destination:'https://helenaduartepsi.vercel.app/',availability:'external-example'}
];
export function billingFor(ids,mode){return services.filter(s=>ids.includes(s.id)).map(s=>({id:s.id,text:s.id==='etha'?'Criação: pagamento único. Hospedagem e painel: recorrência separada. Identidade visual essencial: adicional.':mode==='license'?'Licença: pagamento único, com atualizações futuras incluídas. Hospedagem e suporte separados.':'Assinatura mensal: hospedagem, atualizações e suporte de uso incluídos.'}));}
