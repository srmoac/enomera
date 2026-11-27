// Migração 010: endereços antigos (slug) de uma conta. Quando o profissional troca o endereço
// do site, o anterior continua levando à mesma conta, para links já divulgados não quebrarem.

export const version = '010_endereco_do_site';
export const description = 'Troca do endereço (slug) do site com redirecionamento do endereço anterior';

export async function apply(tx) {
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS account_slug_aliases (
      slug TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_account_slug_aliases_account ON account_slug_aliases (account_id)');
}
