# HAVENLY backup scripts

PowerShell helpers for Supabase Free **logical** backups.

- Dumps prefer `C:\backups\havenly\` (outside this repository). Run dirs + artifacts use DACL-only NTFS restriction to the current user (**not** encryption at rest; no admin/`SeSecurityPrivilege` required).
- Credentials: **Process-scoped** env only; libpq `PG*` auth (no password/URI on tool argv).
- Restore script targets disposable **TEST only** — Production restore is rejected.
- Storage object bytes are **out of scope** here — see `docs/SUPABASE_STORAGE_BACKUP_PLAN.md`.
- Default schema dump is **`public` only**.

Docs: [`docs/SUPABASE_FREE_BACKUP_RESTORE.md`](../../docs/SUPABASE_FREE_BACKUP_RESTORE.md).

**Before any live dump/restore:** run offline checks (no database):

```powershell
.\scripts\backup\Test-HavenlyPgClientTools.ps1 -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
.\scripts\backup\Test-HavenlyBackupOffline.ps1
```

**Preferred TEST dump (interactive, Session pooler, masked password):**

```powershell
.\scripts\backup\Invoke-HavenlyPgDump.ps1 -Target Test -Interactive -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

**Local restore drill** (requires a running local PostgreSQL **server**, not client tools alone; never touches Supabase):

```powershell
.\scripts\backup\Invoke-HavenlyLocalRestoreDrill.ps1 `
  -DumpPath "C:\backups\havenly\test\20261114-174629\havenly-avyerjnzfsqgaascltqi-20261114-174629.dump" `
  -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

Stderr/exit-code offline check (no database):

```powershell
.\scripts\backup\Test-HavenlyNativeCommandOffline.ps1
```

Do not run dump/restore until the owner approves a specific target.
