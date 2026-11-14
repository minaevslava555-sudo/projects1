# HAVENLY — Supabase Free backup & test-restore

**Phase 3B.1 support tooling (logical dumps). Does not apply migrations.**

| Field | Value |
|---|---|
| Production project ref | `mwlvxyszksogsyflxvuv` |
| Disposable TEST project ref | `avyerjnzfsqgaascltqi` (havenly-pricing-test) |
| Preferred backup root (outside git) | `C:\backups\havenly\` |
| Scripts | `scripts/backup/*.ps1` |
| Storage objects | Separate plan: [`SUPABASE_STORAGE_BACKUP_PLAN.md`](./SUPABASE_STORAGE_BACKUP_PLAN.md) |
| Related | [`PHASE_3B1_PRODUCTION_RUNBOOK.md`](./PHASE_3B1_PRODUCTION_RUNBOOK.md) §5.1 |

**Do not paste database passwords, service-role keys, or full connection strings into this document, chat logs, or Git.**

---

## 0) Safety rules

1. **Never** restore a dump into Production with these scripts. Restore automation is **TEST-only** and fail-closed on project identity. Production is an explicit reject destination.
2. **Never** commit dump files, `.sha256` sidecars, Storage object mirrors, or `.env*` with credentials.
3. Set the database URI only as a **Process-scoped** environment variable for the current PowerShell session. User/Machine-scoped fallbacks are **not** read.
4. Tools authenticate via **libpq `PG*` process environment variables**. Passwords and full URIs are **not** placed on `pg_dump` / `pg_restore` / `psql` command lines.
5. Dashboard **daily backups** and **PITR** are separate from local `pg_dump`. Free plans often lack PITR — **verify in the dashboard; do not assume**.
6. A successful SQL dump does **not** back up uploaded Storage files (repair photos). See the Storage plan.
7. Default dump schema is **`public` only**. Auth, Storage metadata, extensions, and role/ACL fidelity are **incomplete** unless you knowingly expand `-IncludeSchemas` and accept restore risk.
8. NTFS ACLs restrict dump directories/files to the **current Windows user**. That is **not encryption at rest** (BitLocker / encrypted volume still recommended).
9. Do not run dump/restore until the owner has approved a specific action for a named project. Offline helper tests may be run anytime.

---

## 1) Prerequisites

### 1.1 PostgreSQL client tools (Windows)

Required binaries on `PATH` (or via `-PgBinDir`):

| Tool | Used for |
|---|---|
| `pg_dump` | Create logical backups |
| `pg_restore` | List / restore custom-format dumps |
| `psql` | Optional connectivity / read-only checks after restore |

**Offline client check (no database):**

```powershell
cd C:\projects1
.\scripts\backup\Test-HavenlyPgClientTools.ps1 -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

**Offline identity / redaction / ACL unit checks (synthetic only, no database):**

```powershell
.\scripts\backup\Test-HavenlyBackupOffline.ps1
```

Supported client tools: **PostgreSQL 15+** (17.x verified on this workstation).

### 1.2 Credentials (Process scope only)

| Target | Process environment variable |
|---|---|
| Production dump | `HAVENLY_PROD_DATABASE_URL` |
| Disposable TEST dump / restore | `HAVENLY_PRICING_TEST_DATABASE_URL` |

Set in the **current process** only, for example:

```powershell
$env:HAVENLY_PROD_DATABASE_URL = "<paste URI>"
# … run approved script …
Remove-Item Env:HAVENLY_PROD_DATABASE_URL
```

URI validation (fail closed before any tool runs):

- Scheme `postgresql` / `postgres`
- Hostname must be approved Supabase:
  - `db.<project-ref>.supabase.co` (direct), or
  - `*.pooler.supabase.com` (pooler; username must be `postgres.<project-ref>`)
- If both hostname and username carry a project ref, they must **match**
- Password required in URI userinfo (then moved to `PGPASSWORD` for the tool invocation only)
- Query must not override `host` / `hostaddr`
- Resolved ref must equal the expected Production or TEST ref for the chosen `-Target`

Prefer **direct** host `db.<ref>.supabase.co:5432` for URI-based dumps. For **interactive TEST**, Session pooler (`*.pooler.supabase.com:5432` + `postgres.<ref>`) is required by the script. **Transaction** pooler (often port `6543`) is rejected for interactive TEST — it is unsuitable for `pg_dump`.

### 1.3 Disk location & ACL

- Default output: `C:\backups\havenly\<target>\<yyyyMMdd-HHmmss>\`
- Must be **outside** `C:\projects1`
- NTFS **DACL-only** updates (preserve owner/SACL; no `SeSecurityPrivilege` required for a normal user):
  - Shared root `C:\backups\havenly` is restricted **only when newly created** (not re-ACL’d every run)
  - Each run directory and dump artifacts (`.dump`, `.sha256`, `MANIFEST.txt`) get **current user only**, inheritance **disabled** so open ancestors cannot keep access
  - Verification is **fail-closed** (inheritance off, no foreign Allow ACEs, no leftover inherited rules)
- **ACL ≠ encryption.** Full-disk encryption is separate. Dump files contain personal data (order names/phones, etc.)

### 1.4 Operator checklist before first live dump

- [ ] `Test-HavenlyPgClientTools.ps1` OK  
- [ ] `Test-HavenlyBackupOffline.ps1` OK  
- [ ] Process-scoped URI set for the **intended** target only  
- [ ] Dashboard backup/PITR status recorded (runbook §5.1)  
- [ ] Storage gap + non-`public` schema incompleteness acknowledged  

---

## 2) Coverage vs gaps

### Covers (default)

- `public` schema definitions and row data (orders, services, pricing tables when present)
- Functions/triggers/indexes in dumped schemas
- Local integrity: size, SHA-256 sidecar, optional `pg_restore --list`

### Incomplete / not covered

| Area | Limitation |
|---|---|
| **Roles & privileges** | `--no-owner --no-acl`; re-apply grants from migration SQL if needed |
| **Auth (`auth.*`)** | Not in default dump; restoring Auth into another project is fragile |
| **Storage bytes** | Not in SQL dump — see Storage plan |
| **Storage/auth schemas** | Omitted unless `-IncludeSchemas` expanded (still no object bytes) |
| **Extensions** | Restore may fail if TEST lacks the same extensions |
| **Dashboard config** | API keys, providers, secrets — not in `pg_dump` |
| **PITR** | Local dump is a single point in time only |
| **Platform daily backup** | Separate; verify Free-plan restore UX in dashboard |

---

## 3) Backup procedure (logical dump)

### 3.1 Production (owner-approved only)

```powershell
cd C:\projects1
$env:HAVENLY_PROD_DATABASE_URL = "<paste URI in this process only>"
.\scripts\backup\Invoke-HavenlyPgDump.ps1 -Target Production -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
Remove-Item Env:HAVENLY_PROD_DATABASE_URL
```

### 3.2 Disposable TEST (preferred: interactive Session pooler)

Uses masked `Read-Host -AsSecureString` for the password. Builds a validated connection from discrete fields (no password-bearing URI). Requires Session pooler host `*.pooler.supabase.com`, port **5432**, username **`postgres.avyerjnzfsqgaascltqi`**. Production identity is rejected. `PG*` process env is cleared in `finally`.

```powershell
cd C:\projects1
.\scripts\backup\Invoke-HavenlyPgDump.ps1 `
  -Target Test `
  -Interactive `
  -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

Operator prompts: host → port `[5432]` → username → database `[postgres]` → type `YES` → masked password.

### 3.3 Disposable TEST (alternate: Process-scoped URI)

```powershell
$env:HAVENLY_PRICING_TEST_DATABASE_URL = "<paste URI in this process only>"
.\scripts\backup\Invoke-HavenlyPgDump.ps1 -Target Test -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
Remove-Item Env:HAVENLY_PRICING_TEST_DATABASE_URL
```

### 3.4 Integrity check (offline)

```powershell
.\scripts\backup\Get-HavenlyDumpIntegrity.ps1 `
  -DumpPath "C:\backups\havenly\production\<folder>\havenly-....dump" `
  -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

---

## 4) Restore verification

### 4.1 Preferred: LOCAL restore drill (no Supabase)

Restores a verified `.dump` into a **new uniquely named** local database only. Aborts if that name already exists. Never drops existing DBs. Host must be `127.0.0.1` / `localhost` / `::1`.

**Prerequisite:** a running local PostgreSQL **17 server** (not only client tools in `C:\Program Files\PostgreSQL\17\bin`).

Native tools are invoked via `HavenlyNativeCommand.ps1` so `pg_restore --verbose` stderr does not abort under PowerShell 5.1 `$ErrorActionPreference = 'Stop'`; failure is determined by exit code only.

Fresh local DBs already contain `public`; the drill **drops that empty `public` schema only after** verifying `current_database()` equals this run’s `havenly_restore_drill_*` name and public has zero tables — never on `postgres`/templates/pre-existing DBs.

Before `pg_restore`, the drill ensures cluster roles **`anon`** and **`authenticated`** exist as **NOLOGIN** stubs (no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/INHERIT) so RLS `CREATE POLICY … TO anon|authenticated` can succeed. Role ops only on **`127.0.0.1:5432`**. If a role already exists with elevated attributes, the script **fail-closes** and does **not** `ALTER` it. These roles are **cluster-wide** and **remain after** the drill database is dropped.

```powershell
.\scripts\backup\Invoke-HavenlyLocalRestoreDrill.ps1 `
  -DumpPath "C:\backups\havenly\test\20261114-174629\havenly-avyerjnzfsqgaascltqi-20261114-174629.dump" `
  -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
```

### 4.2 Disposable-TEST Supabase restore (destructive — separate approval)

**Production restore destination is rejected.** Prefer §4.1 before any Supabase TEST restore.

```powershell
$env:HAVENLY_PRICING_TEST_DATABASE_URL = "<TEST URI only>"
.\scripts\backup\Restore-HavenlyDumpToTest.ps1 `
  -DumpPath "C:\backups\havenly\test\<folder>\havenly-....dump" `
  -IUnderstandThisOverwritesTestDatabase `
  -ConfirmTestProjectRef avyerjnzfsqgaascltqi `
  -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
Remove-Item Env:HAVENLY_PRICING_TEST_DATABASE_URL
```

Storage files remain unrestored unless the Storage plan is executed separately.

---

## 5) Phase 3B.1 alignment

Before Production pricing migration approval: complete runbook §5.1; optionally take a fresh local Production dump after offline tests pass; record path + SHA-256 in ops notes; accept Storage / non-`public` residual risk explicitly.

---

## 6) Forbidden

- Restoring into Production (including manual `pg_restore` against Production)
- Committing dumps or URIs
- Relying on User-scoped env vars for these scripts
- Assuming PITR on Free
- Treating SQL backup as complete DR for repair photos

---

## 7) Script index

| Script | Connects? | Purpose |
|---|---|---|
| `Test-HavenlyPgClientTools.ps1` | No | Client binaries present |
| `Test-HavenlyBackupOffline.ps1` | No | Identity / redaction / ACL unit tests |
| `Invoke-HavenlyPgDump.ps1` | Yes when run | Fail-closed logical dump (`-Interactive` = TEST Session pooler only) |
| `Get-HavenlyDumpIntegrity.ps1` | No | SHA-256 + archive list |
| `Restore-HavenlyDumpToTest.ps1` | Yes when run (TEST only) | Fail-closed TEST restore |
| `Invoke-HavenlyLocalRestoreDrill.ps1` | Local PG only | New empty local DB restore drill (not Supabase) |
| `HavenlyNativeCommand.ps1` | No | PS 5.1-safe native exe wrapper (stderr vs exit code) |
| `Test-HavenlyNativeCommandOffline.ps1` | No | Offline stderr/exit-code regression |
| `HavenlyBackupCommon.ps1` | No | Shared helpers |
