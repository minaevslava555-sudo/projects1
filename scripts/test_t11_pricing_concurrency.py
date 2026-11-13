#!/usr/bin/env python3
"""
HAVENLY Phase 3B.1 — T11 concurrency (havenly-pricing-test ONLY).

Flow:
  1) Verify project ref from URI user/host (fail closed) + DB fingerprint
  2) Prep COMMIT: two complete temporary drafts (unique versions)
  3) Scenario A: concurrent activate → expect 55P03; both ROLLBACK (no COMMIT)
  4) Scenario B: incomplete v9001 validation alone, then FOR SHARE vs activate → 55P03
  5) Cleanup COMMIT in finally: delete only our temporary drafts (+ children)
  6) Final check: active v9002 @ €20, count=1, temp drafts gone

Env:
  HAVENLY_PRICING_TEST_DATABASE_URL — Postgres URI for havenly-pricing-test

Install:
  pip install "psycopg[binary]"

Never use Production credentials. Do not log password / full URI / raw exception text.
"""

from __future__ import annotations

import os
import sys
import uuid
from typing import Any
from urllib.parse import urlparse, unquote

import psycopg
from psycopg.errors import LockNotAvailable, RaiseException

EXPECTED_TEST_PROJECT_REF = "avyerjnzfsqgaascltqi"
EXPECTED_ACTIVE_VERSION = 9002
EXPECTED_ACTIVE_RATE = 20.00
INCOMPLETE_DRAFT_VERSION = 9001

# From projects1_pricing_validate_draft_for_publish (incomplete room plans).
# Default PL/pgSQL RAISE EXCEPTION → SQLSTATE P0001.
INCOMPLETE_DRAFT_SQLSTATE = "P0001"
INCOMPLETE_DRAFT_MSG_MARKER = "Draft must define valid plans for rooms 1"

CONNECT_TIMEOUT_SEC = 10
LOCK_TIMEOUT = "3s"
STATEMENT_TIMEOUT = "15s"

# Unique high versions for this process (committed prep only)
RUN_TAG = uuid.uuid4().hex[:8]
TEMP_VERSION_A = 920_000 + (int(RUN_TAG[:4], 16) % 10_000)
TEMP_VERSION_B = TEMP_VERSION_A + 1


def redact_database_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "?"
        port = f":{parsed.port}" if parsed.port else ""
        db = (parsed.path or "/").lstrip("/") or "?"
        user = unquote(parsed.username or "?")
        # Strip project-ref suffix from log user if present
        if "." in user:
            user = user.split(".", 1)[0] + ".***"
        return f"postgresql://{user}@***@{host}{port}/{db}"
    except Exception:
        return "(redacted)"


def extract_project_ref_from_url(url: str) -> str | None:
    """
    Pooler username: postgres.<project_ref>
    Direct host:     db.<project_ref>.supabase.co
    Returns None if ref cannot be confirmed from user/host.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return None

    user = unquote(parsed.username or "")
    if user.startswith("postgres.") and len(user) > len("postgres."):
        ref = user.split(".", 1)[1].strip()
        if ref and all(c.isalnum() or c == "-" for c in ref):
            return ref

    host = (parsed.hostname or "").lower()
    # db.<ref>.supabase.co
    if host.startswith("db.") and host.endswith(".supabase.co"):
        mid = host[len("db.") : -len(".supabase.co")]
        if mid and "." not in mid:
            return mid

    return None


def require_test_database_url() -> str:
    url = (os.environ.get("HAVENLY_PRICING_TEST_DATABASE_URL") or "").strip()
    if not url:
        print(
            "FAIL: set HAVENLY_PRICING_TEST_DATABASE_URL "
            "(havenly-pricing-test Postgres URI only).",
            file=sys.stderr,
        )
        sys.exit(2)

    ref = extract_project_ref_from_url(url)
    if ref is None:
        print(
            "FAIL: cannot confirm project ref from URI username/hostname "
            f"(need postgres.{EXPECTED_TEST_PROJECT_REF} or "
            f"db.{EXPECTED_TEST_PROJECT_REF}.supabase.co). No SQL executed.",
            file=sys.stderr,
        )
        sys.exit(2)

    if ref != EXPECTED_TEST_PROJECT_REF:
        print(
            f"FAIL: project ref mismatch (got confirmed ref, expected "
            f"{EXPECTED_TEST_PROJECT_REF}). No SQL executed.",
            file=sys.stderr,
        )
        sys.exit(2)

    return url


def set_timeouts(cur: psycopg.Cursor) -> None:
    cur.execute(f"SET lock_timeout = '{LOCK_TIMEOUT}'")
    cur.execute(f"SET statement_timeout = '{STATEMENT_TIMEOUT}'")


def rollback_quiet(conn: psycopg.Connection | None) -> None:
    if conn is None or conn.closed:
        return
    try:
        conn.rollback()
    except Exception:
        print("WARN: rollback failed")


def close_quiet(conn: psycopg.Connection | None) -> None:
    if conn is None or conn.closed:
        return
    try:
        conn.close()
    except Exception:
        print("WARN: connection close failed")


def expect_lock_timeout(exc: BaseException) -> None:
    if isinstance(exc, LockNotAvailable):
        print("PASS: SQLSTATE 55P03 (lock_not_available)")
        return
    sqlstate = getattr(exc, "sqlstate", None)
    if sqlstate == "55P03":
        print("PASS: SQLSTATE 55P03 (lock_not_available)")
        return
    raise AssertionError(
        f"expected SQLSTATE 55P03, got sqlstate={sqlstate!r} "
        f"type={type(exc).__name__}"
    ) from None


def _exception_primary_message(exc: BaseException) -> str:
    """Best-effort primary message without logging it."""
    diag = getattr(exc, "diag", None)
    if diag is not None:
        primary = getattr(diag, "message_primary", None)
        if isinstance(primary, str) and primary:
            return primary
    # Fallback for drivers that only expose args[0]
    if exc.args and isinstance(exc.args[0], str):
        return exc.args[0]
    return ""


def expect_incomplete_draft_validation(exc: BaseException) -> None:
    """
    Incomplete v9001 must fail validate_draft_for_publish room-plan check:
    SQLSTATE P0001 + known message marker (message not printed).
    """
    sqlstate = getattr(exc, "sqlstate", None)

    if sqlstate == "55P03" or isinstance(exc, LockNotAvailable):
        raise AssertionError(
            "B1 FAIL: got 55P03 without competing lock "
            "(expected incomplete-draft validation P0001)"
        ) from None

    # Bare RAISE EXCEPTION → RaiseException with sqlstate P0001 in psycopg3
    if not isinstance(exc, RaiseException) and sqlstate != INCOMPLETE_DRAFT_SQLSTATE:
        raise AssertionError(
            f"B1 FAIL: expected RaiseException/{INCOMPLETE_DRAFT_SQLSTATE}, "
            f"got sqlstate={sqlstate!r} type={type(exc).__name__}"
        ) from None

    if sqlstate is not None and sqlstate != INCOMPLETE_DRAFT_SQLSTATE:
        raise AssertionError(
            f"B1 FAIL: expected SQLSTATE {INCOMPLETE_DRAFT_SQLSTATE}, "
            f"got {sqlstate!r}"
        ) from None

    primary = _exception_primary_message(exc)
    if INCOMPLETE_DRAFT_MSG_MARKER not in primary:
        raise AssertionError(
            "B1 FAIL: validation error without incomplete room-plan "
            f"message marker (type={type(exc).__name__})"
        ) from None

    print(
        f"PASS B1: incomplete-draft validation "
        f"(sqlstate={INCOMPLETE_DRAFT_SQLSTATE}, marker ok)"
    )


def fetch_active(cur: psycopg.Cursor) -> tuple[Any, int, float]:
    cur.execute(
        """
        select id, version, cleaning_hourly_rate_euro::float8
        from public.projects1_pricing_config
        where status = 'active'
        """
    )
    rows = cur.fetchall()
    if len(rows) != 1:
        raise AssertionError(f"expected exactly 1 active row, got {len(rows)}")
    active_id, version, rate = rows[0]
    return active_id, int(version), float(rate)


def assert_fingerprint(cur: psycopg.Cursor, label: str) -> Any:
    """active v9002 @ €20, count=1, draft v9001 exists. Returns active id."""
    active_id, version, rate = fetch_active(cur)
    cur.execute(
        """
        select count(*)::int
        from public.projects1_pricing_config
        where status = 'active'
        """
    )
    (n_active,) = cur.fetchone()
    if n_active != 1:
        raise AssertionError(f"{label}: active count={n_active}, expected 1")
    if version != EXPECTED_ACTIVE_VERSION:
        raise AssertionError(
            f"{label}: active version={version}, expected {EXPECTED_ACTIVE_VERSION}"
        )
    if abs(rate - EXPECTED_ACTIVE_RATE) > 1e-9:
        raise AssertionError(
            f"{label}: active rate={rate}, expected {EXPECTED_ACTIVE_RATE}"
        )

    cur.execute(
        """
        select id, status
        from public.projects1_pricing_config
        where version = %s
        """,
        (INCOMPLETE_DRAFT_VERSION,),
    )
    row = cur.fetchone()
    if row is None:
        raise AssertionError(
            f"{label}: draft version {INCOMPLETE_DRAFT_VERSION} not found"
        )
    if row[1] != "draft":
        raise AssertionError(
            f"{label}: version {INCOMPLETE_DRAFT_VERSION} status={row[1]!r}, "
            "expected draft"
        )

    print(
        f"PASS {label}: active v{version} rate={rate}; "
        f"draft v{INCOMPLETE_DRAFT_VERSION} present"
    )
    return active_id


def insert_complete_draft(
    cur: psycopg.Cursor,
    *,
    version: int,
    active_id: Any,
    rate: float,
    note: str,
) -> Any:
    cur.execute(
        """
        insert into public.projects1_pricing_config (
          version, status, cleaning_hourly_rate_euro, note, created_by
        ) values (%s, 'draft', %s, %s, 'pricing_test_t11')
        returning id
        """,
        (version, rate, note),
    )
    (draft_id,) = cur.fetchone()

    cur.execute(
        """
        insert into public.projects1_cleaning_room_plans (
          pricing_config_id, rooms, hours, workers
        )
        select %s, p.rooms, p.hours, p.workers
        from public.projects1_cleaning_room_plans p
        where p.pricing_config_id = %s
        """,
        (draft_id, active_id),
    )
    if cur.rowcount != 6:
        raise AssertionError(f"expected 6 cleaning plans, got {cur.rowcount}")

    cur.execute(
        """
        insert into public.projects1_massage_prices (
          pricing_config_id, minutes, price_euro, is_active
        )
        select %s, m.minutes, m.price_euro, m.is_active
        from public.projects1_massage_prices m
        where m.pricing_config_id = %s
        """,
        (draft_id, active_id),
    )
    if cur.rowcount != 3:
        raise AssertionError(f"expected 3 massage rows, got {cur.rowcount}")

    return draft_id


def delete_draft_tree(cur: psycopg.Cursor, draft_id: Any) -> None:
    """Delete only the given draft config and its children (must stay draft)."""
    cur.execute(
        """
        select status, version
        from public.projects1_pricing_config
        where id = %s
        for update
        """,
        (draft_id,),
    )
    row = cur.fetchone()
    if row is None:
        return
    status, version = row
    if status != "draft":
        raise AssertionError(
            f"cleanup refused: id={draft_id} status={status!r} "
            f"version={version} (not draft)"
        )

    cur.execute(
        """
        delete from public.projects1_cleaning_room_plans
        where pricing_config_id = %s
        """,
        (draft_id,),
    )
    cur.execute(
        """
        delete from public.projects1_massage_prices
        where pricing_config_id = %s
        """,
        (draft_id,),
    )
    cur.execute(
        """
        delete from public.projects1_pricing_config
        where id = %s and status = 'draft'
        """,
        (draft_id,),
    )
    if cur.rowcount != 1:
        raise AssertionError(f"cleanup: draft row not deleted id={draft_id}")


def prep_temp_drafts(
    conn: psycopg.Connection, active_id: Any, rate: float
) -> tuple[Any, Any]:
    """
    COMMIT allowed only after both complete drafts succeed.
    Any error → ROLLBACK (no partial committed prep).
    """
    try:
        with conn.cursor() as cur:
            set_timeouts(cur)
            cur.execute(
                """
                select version
                from public.projects1_pricing_config
                where version in (%s, %s)
                order by version
                """,
                (TEMP_VERSION_A, TEMP_VERSION_B),
            )
            clash = [int(r[0]) for r in cur.fetchall()]
            if clash:
                raise AssertionError(
                    f"temp version conflict with existing rows: {clash}"
                )

            id_a = insert_complete_draft(
                cur,
                version=TEMP_VERSION_A,
                active_id=active_id,
                rate=rate,
                note=f"T11 temp draft A tag={RUN_TAG}",
            )
            id_b = insert_complete_draft(
                cur,
                version=TEMP_VERSION_B,
                active_id=active_id,
                rate=rate,
                note=f"T11 temp draft B tag={RUN_TAG}",
            )

            # Own rows only — refuse unexpected status before commit
            cur.execute(
                """
                select id, version, status
                from public.projects1_pricing_config
                where id in (%s, %s)
                order by version
                """,
                (id_a, id_b),
            )
            owned = cur.fetchall()
            if len(owned) != 2:
                raise AssertionError("prep: expected exactly two new draft rows")
            for _id, ver, status in owned:
                if status != "draft":
                    raise AssertionError(
                        f"prep: refusing non-draft before commit "
                        f"version={ver} status={status!r}"
                    )
                if ver not in (TEMP_VERSION_A, TEMP_VERSION_B):
                    raise AssertionError("prep: unexpected version before commit")

        conn.commit()
        print(
            f"PASS prep: committed drafts "
            f"v{TEMP_VERSION_A}={id_a}, v{TEMP_VERSION_B}={id_b}"
        )
        return id_a, id_b
    except Exception:
        rollback_quiet(conn)
        raise


def cleanup_temp_drafts(conn: psycopg.Connection, draft_ids: list[Any]) -> None:
    """COMMIT allowed: delete only our temporary drafts."""
    with conn.cursor() as cur:
        set_timeouts(cur)
        for draft_id in draft_ids:
            if draft_id is None:
                continue
            delete_draft_tree(cur, draft_id)
    conn.commit()
    print(f"PASS cleanup: removed {len([d for d in draft_ids if d])} temp draft(s)")


def assert_temp_drafts_absent(cur: psycopg.Cursor, draft_ids: list[Any]) -> None:
    ids = [d for d in draft_ids if d is not None]
    if not ids:
        return
    cur.execute(
        """
        select version, status
        from public.projects1_pricing_config
        where id = any(%s)
        """,
        (ids,),
    )
    left = cur.fetchall()
    if left:
        raise AssertionError(
            f"temp drafts still present after cleanup: {left!r}"
        )
    cur.execute(
        """
        select version
        from public.projects1_pricing_config
        where version in (%s, %s)
        """,
        (TEMP_VERSION_A, TEMP_VERSION_B),
    )
    by_ver = cur.fetchall()
    if by_ver:
        raise AssertionError(
            f"temp versions still present: {by_ver!r}"
        )
    print("PASS: temporary drafts absent")


def scenario_a(
    conn1: psycopg.Connection,
    conn2: psycopg.Connection,
    draft_a: Any,
    draft_b: Any,
) -> None:
    """
    Concurrent activate of two pre-committed drafts.
    Both need FOR UPDATE on the same active v9002.
    Session 2 must see only 55P03. No COMMIT after activate.
    """
    print("--- Scenario A: concurrent activate ---")
    cur1 = conn1.cursor()
    cur2 = conn2.cursor()
    try:
        set_timeouts(cur1)
        set_timeouts(cur2)

        cur1.execute(
            "select public.projects1_activate_pricing_config(%s)",
            (draft_a,),
        )
        print("A: session1 activate(draft A) OK (uncommitted, holding locks)")

        try:
            cur2.execute(
                "select public.projects1_activate_pricing_config(%s)",
                (draft_b,),
            )
            raise AssertionError(
                "A FAIL: session2 activate succeeded while session1 holds locks"
            )
        except AssertionError:
            raise
        except Exception as exc:
            expect_lock_timeout(exc)

    finally:
        rollback_quiet(conn1)
        rollback_quiet(conn2)
        cur1.close()
        cur2.close()
        print("A: both sessions rolled back (no activate COMMIT)")


def scenario_b(conn1: psycopg.Connection, conn2: psycopg.Connection) -> None:
    """
    1) Alone: activate(incomplete v9001) → must NOT be 55P03 (validation).
    2) FOR SHARE on v9001 vs activate → must be 55P03.
    """
    print("--- Scenario B: incomplete draft + FOR SHARE vs FOR UPDATE ---")
    cur1 = conn1.cursor()
    cur2 = conn2.cursor()
    try:
        set_timeouts(cur1)
        set_timeouts(cur2)

        cur1.execute(
            """
            select id from public.projects1_pricing_config
            where version = %s and status = 'draft'
            """,
            (INCOMPLETE_DRAFT_VERSION,),
        )
        row = cur1.fetchone()
        if row is None:
            raise AssertionError(f"B: draft v{INCOMPLETE_DRAFT_VERSION} missing")
        (draft_id,) = row

        # --- B1: exact incomplete-draft validation (not any non-55P03) ---
        print(
            "B1: activate(v9001) alone — expect P0001 incomplete room-plan validation"
        )
        try:
            cur1.execute(
                "select public.projects1_activate_pricing_config(%s)",
                (draft_id,),
            )
            raise AssertionError(
                "B1 FAIL: activate(incomplete v9001) unexpectedly succeeded"
            )
        except AssertionError:
            raise
        except Exception as exc:
            expect_incomplete_draft_validation(exc)
        finally:
            rollback_quiet(conn1)

        # Fresh timeouts after rollback
        set_timeouts(cur1)
        set_timeouts(cur2)

        # --- B2: FOR SHARE held → activate must 55P03 ---
        print("B2: session1 FOR SHARE on v9001; session2 activate")
        cur1.execute(
            """
            select id
            from public.projects1_pricing_config
            where id = %s
            for share
            """,
            (draft_id,),
        )
        if cur1.fetchone() is None:
            raise AssertionError("B2 FAIL: FOR SHARE returned no row")
        print("B2: session1 holding FOR SHARE (no data mutation)")

        try:
            cur2.execute(
                "select public.projects1_activate_pricing_config(%s)",
                (draft_id,),
            )
            raise AssertionError(
                "B2 FAIL: activate succeeded while FOR SHARE held"
            )
        except AssertionError:
            raise
        except Exception as exc:
            expect_lock_timeout(exc)

    finally:
        rollback_quiet(conn1)
        rollback_quiet(conn2)
        cur1.close()
        cur2.close()
        print("B: both sessions rolled back")


def main() -> int:
    url = require_test_database_url()
    print(f"T11 target: {redact_database_url(url)}")
    print(f"T11 project_ref={EXPECTED_TEST_PROJECT_REF} (verified from URI)")
    print(
        f"timeouts: connect={CONNECT_TIMEOUT_SEC}s "
        f"lock={LOCK_TIMEOUT} statement={STATEMENT_TIMEOUT}"
    )
    print(f"temp versions: {TEMP_VERSION_A}, {TEMP_VERSION_B} tag={RUN_TAG}")

    conn_setup: psycopg.Connection | None = None
    conn1: psycopg.Connection | None = None
    conn2: psycopg.Connection | None = None
    conn_verify: psycopg.Connection | None = None

    draft_a: Any | None = None
    draft_b: Any | None = None
    cleanup_ok = False
    test_exc: BaseException | None = None

    try:
        conn_setup = psycopg.connect(
            url, autocommit=False, connect_timeout=CONNECT_TIMEOUT_SEC
        )
        conn1 = psycopg.connect(
            url, autocommit=False, connect_timeout=CONNECT_TIMEOUT_SEC
        )
        conn2 = psycopg.connect(
            url, autocommit=False, connect_timeout=CONNECT_TIMEOUT_SEC
        )
        conn_verify = psycopg.connect(
            url, autocommit=False, connect_timeout=CONNECT_TIMEOUT_SEC
        )

        with conn_setup.cursor() as cur:
            set_timeouts(cur)
            active_id = assert_fingerprint(cur, "preflight")
            _, _, rate = fetch_active(cur)
        conn_setup.rollback()

        draft_a, draft_b = prep_temp_drafts(conn_setup, active_id, rate)

        with conn_verify.cursor() as cur:
            set_timeouts(cur)
            assert_fingerprint(cur, "after prep")
        conn_verify.rollback()

        scenario_a(conn1, conn2, draft_a, draft_b)

        with conn_verify.cursor() as cur:
            set_timeouts(cur)
            assert_fingerprint(cur, "after A")
        conn_verify.rollback()

        scenario_b(conn1, conn2)

        with conn_verify.cursor() as cur:
            set_timeouts(cur)
            assert_fingerprint(cur, "after B")
        conn_verify.rollback()

        print("========================================")
        print("T11 concurrency assertions passed")
        print("========================================")
        return_code = 0

    except BaseException as exc:
        test_exc = exc
        return_code = 1
        print("========================================")
        print(f"T11 FAIL: {type(exc).__name__}")
        sqlstate = getattr(exc, "sqlstate", None)
        if sqlstate:
            print(f"sqlstate={sqlstate}")
        print("========================================")

    finally:
        # Always attempt cleanup of OUR temp drafts (COMMIT delete only)
        try:
            ids = [d for d in (draft_a, draft_b) if d is not None]
            if ids:
                if conn_setup is None or conn_setup.closed:
                    conn_setup = psycopg.connect(
                        url,
                        autocommit=False,
                        connect_timeout=CONNECT_TIMEOUT_SEC,
                    )
                rollback_quiet(conn_setup)
                cleanup_temp_drafts(conn_setup, ids)
            cleanup_ok = True
        except BaseException:
            cleanup_ok = False
            print("FAIL: cleanup of temporary drafts did not complete")

        # Final state check on a clean connection
        try:
            if conn_verify is None or conn_verify.closed:
                conn_verify = psycopg.connect(
                    url,
                    autocommit=False,
                    connect_timeout=CONNECT_TIMEOUT_SEC,
                )
            rollback_quiet(conn_verify)
            with conn_verify.cursor() as cur:
                set_timeouts(cur)
                assert_fingerprint(cur, "final")
                assert_temp_drafts_absent(
                    cur, [draft_a, draft_b]
                )
            conn_verify.rollback()
        except BaseException:
            cleanup_ok = False
            print("FAIL: final state verification did not pass")
            return_code = 1

        for conn in (conn1, conn2, conn_verify, conn_setup):
            rollback_quiet(conn)
            close_quiet(conn)

        if not cleanup_ok:
            return_code = 1
            print("T11 FAIL: cleanup/final verification")
        elif test_exc is None and return_code == 0:
            print(
                "T11 PASS: locks OK; active v9002 intact; temp drafts removed"
            )

    return return_code


if __name__ == "__main__":
    sys.exit(main())
