# Backups

A second copy of the database, taken every night and kept off Neon.

Neon's free tier keeps only a few hours of history, so it cannot undo a mistake noticed the next
morning — and on 13 Sep a script pointed at production proved that is not hypothetical. This is
the copy that answers that.

## What a backup is

A folder of gzipped NDJSON, one file per table, plus a `meta.json`. About 240 KB for a week of
two restaurants; the whole thing compresses to a 165 KB archive.

It holds the data, not the schema. The schema is already in git as Prisma migrations, so a
restore is `prisma migrate deploy` followed by `npm run db:restore` — which is why there is no
`pg_dump` here, and no need for a client binary matching the server's major version.

**Two tables are left out on purpose:** `Session` and `AuthToken`. Those are live sign-in keys
and password-reset links. They expire on their own, a restore without them costs each user one
sign-in, and copying them off-site every night would spread working keys to someone's account
across every place a backup lands. `meta.json` records how many rows were skipped.

Adding a table to the schema without adding it to `BACKUP_MODELS` in
[`src/lib/backup/manifest.ts`](../src/lib/backup/manifest.ts) makes the backup **fail**, rather
than quietly producing copies that are missing it.

## Taking one by hand

```bash
npm run db:backup                      # into backups/<timestamp>/
npm run db:backup -- --out /some/dir
```

Read-only. It prints the host it read from, so check that line before trusting the result.

## Restoring

```bash
npm run db:restore -- --from backups/qimby-… --to "postgres://…/qimby"        # dry run
npm run db:restore -- --from backups/qimby-… --to "postgres://…/qimby" --yes
```

The target is never taken from `DATABASE_URL`. On a developer machine that variable points at
production, and a restore is the one operation where that default would be unrecoverable — so
it has to be named every time.

Four refusals stand in the way of the obvious accidents:

| Refusal | Override |
|---|---|
| The target is the host the backup came from | `--force-same-host` |
| The target has no tables yet | run `prisma migrate deploy` first |
| The target's schema is older than the data | run `prisma migrate deploy` first |
| The target already has rows | `--wipe` |

Restoring into a local database is also the safe way to get real data for development:

```bash
docker run -d --name qimby-local -e POSTGRES_PASSWORD=local -e POSTGRES_DB=qimby -p 55432:5432 postgres:18
DATABASE_URL="postgres://postgres:local@127.0.0.1:55432/qimby" npx prisma migrate deploy
npm run db:restore -- --from backups/qimby-… --to "postgres://postgres:local@127.0.0.1:55432/qimby" --yes
```

## The nightly copy

[`.github/workflows/backup.yml`](../.github/workflows/backup.yml) runs at 09:00 UTC — 02:00 in
California, the quietest hour for the restaurants. It takes the backup, checks it is not empty,
**restores it into a throwaway PostgreSQL 18 and compares the row counts**, then encrypts it and
keeps it as a build artifact for 90 days. What gets kept is a copy that has been proven to load,
not one that merely finished writing.

### This repository is public

On a public repository both artifacts and run logs are readable by anyone. So:

- the backup is **encrypted before it is uploaded**, with [age](https://age-encryption.org);
- the database host is masked out of the log;
- **without the key configured the job fails** rather than publishing the data.

Encryption uses a *public* key, so nothing secret is needed to make a backup. Only restoring
needs the private key, and that never goes near CI.

### Setting it up

Generate a keypair on your own machine:

```bash
age-keygen -o qimby-backup-key.txt
```

It prints a line like `Public key: age1abc…`. Then, in the repository settings:

| Where | Name | Value |
|---|---|---|
| Settings → Secrets and variables → Actions → **Secrets** | `DATABASE_URL` | the production Neon URL |
| Settings → Secrets and variables → Actions → **Variables** | `BACKUP_AGE_RECIPIENT` | the `age1…` public key |

Then run it once by hand: Actions → *Daily database backup* → **Run workflow**.

> **Keep `qimby-backup-key.txt` somewhere you will still have it after losing this laptop** — a
> password manager, or printed. Every backup is encrypted to it, and without it none of them can
> be read. Losing that file loses the backups as surely as losing the database.

### Reading a backup back

Download the artifact from the workflow run, then:

```bash
age -d -i qimby-backup-key.txt qimby-backup.tar.gz.age > backup.tar.gz
mkdir restored && tar xzf backup.tar.gz -C restored
npm run db:restore -- --from restored --to "postgres://…" --yes
```
