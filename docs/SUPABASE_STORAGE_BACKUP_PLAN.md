# HAVENLY — Supabase Storage backup plan (separate from DB dumps)

**Database `pg_dump` does not back up actual uploaded file contents.**

| Field | Value |
|---|---|
| Production project ref | `mwlvxyszksogsyflxvuv` |
| Disposable TEST project ref | `avyerjnzfsqgaascltqi` |
| Primary app bucket | `repair-order-photos` (private) |
| DB linkage | `projects1_orders` stores Storage **object paths** (not file bytes) |
| Preferred offline mirror root | `C:\backups\havenly\storage\` (outside git) |

**Do not paste service-role keys or signed URLs containing secrets into Git or chat logs.**

---

## 1) Why this is separate

| Layer | What a SQL dump captures | What it misses |
|---|---|---|
| Postgres | Bucket rows in `storage.buckets` / object metadata in `storage.objects` (if those schemas are dumped) | The **binary objects** in the Storage backend |
| App | Path strings on orders | Image bytes needed to re-send Telegram media or re-download photos |
| Platform | N/A | Object storage is not reconstructed by restoring `public` tables alone |

After a DB-only restore, order rows may list photo paths that **404** unless objects are restored too.

---

## 2) Current HAVENLY Storage footprint

- Bucket: `repair-order-photos` (created in booking-wizard migration; private; not for anon access).
- Upload path: `POST /api/order/photos` via `service_role`.
- Consumption: Telegram notify downloads objects server-side; cron/lazy cleanup may delete stale draft objects.
- Risk if lost: repair request photos for affected orders; text order data can still exist in Postgres.

---

## 3) Recommended backup approaches (choose later — do not run in this prep step)

### Option A — Dashboard / platform (if available on plan)

1. Check Supabase dashboard for any Storage backup or project backup that includes Storage.
2. Record whether Free tier includes Storage in daily backups (often **limited or absent** — verify, do not assume).
3. Note retention and restore procedure in ops notes.

### Option B — Offline object mirror (operator-controlled)

High-level procedure (implementation can be a future script; **not created as an auto-runner here**):

1. Use **service_role** only in a local session (env var, never committed).
2. List objects under `repair-order-photos` (paginated).
3. Download each object to  
   `C:\backups\havenly\storage\<project-ref>\<yyyyMMdd-HHmmss>\repair-order-photos\<object-path>`
4. Write a manifest CSV/JSON with: object path, size, content-type, SHA-256 of file bytes, download UTC time.
5. Confirm object count vs `storage.objects` (or vs order path arrays) and store checksums **outside** the repo.
6. Encrypt or restrict NTFS ACL on `C:\backups\havenly\storage` — files may contain customer images (personal data).

### Option C — Rely on short retention + Telegram copies

Not a real backup: photos already sent to Telegram may exist in the admin chat, but that is incomplete, hard to re-attach, and must not be treated as DR.

---

## 4) Restore plan (Storage) — TEST first

1. Restore or recreate bucket `repair-order-photos` with the same privacy settings (private, MIME/size limits per migration).
2. Upload mirrored files to **TEST** project only first (`avyerjnzfsqgaascltqi`), preserving object keys/paths.
3. Verify a sample order path downloads successfully with service_role.
4. Only after a successful TEST drill, document a Production Storage restore runbook under a **separate owner approval** (not Phase 3B.1 SQL apply).

**Never** bulk-upload Production customer photos into TEST without a privacy review (TEST may have wider access). Prefer synthetic fixtures for drills when possible.

---

## 5) Git / privacy rules

- Mirror directories stay under `C:\backups\havenly\storage\` (outside `C:\projects1`).
- Do not commit images, manifests with customer paths tied to PII, or service-role keys.
- Repo ignore rules cover `/backups/` and common archive patterns as a belt-and-suspenders measure.
- Treat Storage mirrors as **personal data backups** (access control, retention, deletion policy).
- When implementing a mirror script later, apply the same **current-user NTFS ACL** fail-closed pattern used by DB dump tooling (`Restrict-HavenlySensitivePath`). **ACL is not encryption at rest.**
- Database dumps (even with `storage` schema included) still do **not** contain object bytes — this plan remains mandatory for photo DR.

---

## 6) Phase 3B.1 implication

For pricing migration (schema/seed), Storage loss is not the primary rollback path — order **monetary** fingerprints matter more.  
Default DB dumps cover **`public` only** — incomplete for Auth/Storage metadata as well as object bytes.

For overall Production DR readiness before calling backups “complete,” record explicitly:

- [ ] DB logical dump and/or platform DB backup verified
- [ ] PITR status verified (likely off on Free)
- [ ] Non-`public` schema coverage decision recorded (default: incomplete / accepted)
- [ ] Storage object backup status: **done / deferred / accepted residual risk**

If Storage mirror is deferred, state the residual risk in the Phase 3B.1 approval notes.
