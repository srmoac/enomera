// Credenciais só de teste, geradas a cada execução: nenhuma senha fica no repositório.
// Importar este arquivo ANTES de abrir o banco, para o seed usar estes valores.
import crypto from 'node:crypto';

export const DEMO_PASSWORD = process.env.ENOMERA_DEMO_PASSWORD || `Demo-${crypto.randomBytes(12).toString('hex')}`;
export const OPERATOR_PASSWORD = process.env.ENOMERA_OPERATOR_PASSWORD || `Ops-${crypto.randomBytes(12).toString('hex')}`;
process.env.ENOMERA_DEMO_PASSWORD = DEMO_PASSWORD;
process.env.ENOMERA_OPERATOR_PASSWORD = OPERATOR_PASSWORD;
// Ativação simulada: fechada por padrão; os testes que a exercitam ligam de propósito.
if (process.env.ENOMERA_ALLOW_SIMULATED_CHECKOUT === undefined) process.env.ENOMERA_ALLOW_SIMULATED_CHECKOUT = 'true';
process.env.ENOMERA_UNIFORM_DELAY = 'off';
