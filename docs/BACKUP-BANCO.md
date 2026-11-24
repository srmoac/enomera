# Backup diário do banco (Neon)

O banco único da Enomera (Core, Agendamento, Consultório e Site usam o mesmo Neon) é copiado
todo dia às 03:17 (Brasília) pelo GitHub Actions, de graça. O arquivo sai cifrado com AES-256 e
fica guardado 90 dias na aba **Actions → Backup diário do banco → (execução) → Artifacts**.

O repositório é público: qualquer pessoa logada no GitHub consegue baixar o arquivo, mas ele só
abre com a frase-senha. Por isso a frase precisa ser longa (mínimo 20 caracteres; use 5 ou mais
palavras aleatórias) e ficar só com o Marcos, num gerenciador de senhas.

## Ligar (uma vez)

Em https://github.com/srmoac/enomera/settings/secrets/actions, botão **New repository secret**:

1. `DATABASE_URL`: o endereço do banco. No painel da Vercel: Storage → banco Neon → **Open in Neon**
   → Connect → copiar a connection string (a Vercel esconde o valor das variáveis sensíveis).
2. `BACKUP_PASSPHRASE`: a frase-senha. Guarde também no gerenciador de senhas: sem ela os backups
   não abrem e não há como recuperar.

Para testar na hora: Actions → Backup diário do banco → **Run workflow**.

## Restaurar

1. Baixe o `.zip` do Artifact e extraia o `enomera-banco-....dump.gpg`.
2. No Neon, crie um branch novo e vazio (ou outro banco) para receber os dados. Não restaure
   direto em cima da produção.
3. Rode:

```bash
BACKUP_PASSPHRASE='sua frase' DESTINO_URL='postgresql://...branch-novo...' \
  scripts/restaurar-backup.sh enomera-banco-AAAA-MM-DD-HHMM.dump.gpg
```

Precisa de `gpg` e `pg_restore` da mesma versão do banco (ou mais nova).

## Limites

- 90 dias é o máximo do GitHub para Artifacts. Prontuários precisam ser guardados por 5 anos
  (CFP); antes do lançamento, vale levar uma cópia mensal para um lugar privado e durável.
- Os arquivos do Vercel Blob (anexos) não entram neste backup; só o banco.
