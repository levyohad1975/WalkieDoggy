"""Unit tests for the clean-bootstrap privilege restoration.

Run: python3 -m unittest discover -s scripts/production -p 'test_*.py'
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from public_privileges import parse_manifest, privileges_sql  # noqa: E402

BASE = "\n".join(
    [
        "schema\tpublic\tanon\tUSAGE",
        "schema\tpublic\tauthenticated\tUSAGE",
        "schema\tpublic\tservice_role\tUSAGE",
    ]
)


class ParseManifestTests(unittest.TestCase):
    def test_requires_schema_usage_for_every_api_role(self) -> None:
        with self.assertRaisesRegex(ValueError, "service_role"):
            parse_manifest("schema\tpublic\tanon\tUSAGE\nschema\tpublic\tauthenticated\tUSAGE\n")

    def test_rejects_empty_manifest(self) -> None:
        with self.assertRaisesRegex(ValueError, "empty"):
            parse_manifest("\n")

    def test_rejects_unexpected_grantee(self) -> None:
        with self.assertRaisesRegex(ValueError, "grantee"):
            parse_manifest(BASE + "\ntable\tpublic.families\tpostgres\tSELECT\n")

    def test_rejects_privilege_not_valid_for_kind(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid privileges"):
            parse_manifest(BASE + "\nfunction\tpublic.whoami()\tauthenticated\tSELECT\n")

    def test_rejects_other_schemas_and_injection(self) -> None:
        for row in (
            "table\tstorage.objects\tanon\tSELECT",
            "table\tpublic.x; drop table y\tanon\tSELECT",
            "function\tpublic.f(); drop schema public\tanon\tEXECUTE",
            "column\tpublic.users|a; drop\tanon\tSELECT",
            "default_tables\tsupabase_admin\tanon\tSELECT",
            "schema\tauth\tanon\tUSAGE",
        ):
            with self.subTest(row=row), self.assertRaises(ValueError):
                parse_manifest(BASE + "\n" + row + "\n")

    def test_rejects_malformed_rows(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid privilege manifest row"):
            parse_manifest(BASE + "\ntable\tpublic.families\tanon\n")


class PrivilegesSqlTests(unittest.TestCase):
    def render(self, extra: str) -> str:
        return privileges_sql(BASE + "\n" + extra + "\n")

    def test_resets_before_granting(self) -> None:
        sql = self.render("table\tpublic.families\tauthenticated\tDELETE,INSERT,SELECT,UPDATE")
        revoke = sql.index("revoke all on all tables in schema public")
        grant = sql.index("grant DELETE, INSERT, SELECT, UPDATE on table public.families to \"authenticated\";")
        self.assertLess(revoke, grant)
        self.assertIn('revoke all on schema public from PUBLIC, "anon", "authenticated", "service_role";', sql)
        self.assertIn("revoke all on all routines in schema public", sql)

    def test_restores_schema_usage(self) -> None:
        sql = self.render("")
        for role in ("anon", "authenticated", "service_role"):
            self.assertIn(f'grant USAGE on schema public to "{role}";', sql)

    def test_function_grants_use_routine_and_public_keyword(self) -> None:
        sql = self.render(
            "function\tpublic.whoami()\tauthenticated\tEXECUTE\n"
            "function\tpublic.touch(p_id uuid, p_at timestamp with time zone)\tPUBLIC\tEXECUTE"
        )
        self.assertIn('grant EXECUTE on routine public.whoami() to "authenticated";', sql)
        self.assertIn(
            "grant EXECUTE on routine public.touch(p_id uuid, p_at timestamp with time zone) to PUBLIC;",
            sql,
        )

    def test_column_and_sequence_and_default_grants(self) -> None:
        sql = self.render(
            'column\tpublic.users|"Display"\tauthenticated\tSELECT,UPDATE\n'
            "sequence\tpublic.audit_id_seq\tauthenticated\tSELECT,USAGE\n"
            "default_functions\tpostgres\tservice_role\tEXECUTE"
        )
        self.assertIn('grant SELECT ("Display"), UPDATE ("Display") on table public.users to "authenticated";', sql)
        self.assertIn('grant SELECT, USAGE on sequence public.audit_id_seq to "authenticated";', sql)
        self.assertIn(
            'alter default privileges for role "postgres" in schema public grant EXECUTE on functions to "service_role";',
            sql,
        )

    def test_deterministic(self) -> None:
        manifest = BASE + "\ntable\tpublic.families\tanon\tSELECT\n"
        self.assertEqual(privileges_sql(manifest), privileges_sql(manifest))


class BundleTests(unittest.TestCase):
    def test_bundle_applies_privileges_inside_the_bootstrap_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "public.sql").write_text("CREATE TABLE public.families (id uuid);\n")
            (tmp_path / "storage.sql").write_text(
                'CREATE POLICY "own" ON storage.objects FOR SELECT USING (true);\n'
            )
            (tmp_path / "buckets.tsv").write_text("avatars\tf\t\t\n")
            (tmp_path / "acl.tsv").write_text(BASE + "\ntable\tpublic.families\tauthenticated\tSELECT\n")
            out = tmp_path / "out"
            subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(HERE / "build_clean_bootstrap_bundle.py"),
                    "--public-dump", str(tmp_path / "public.sql"),
                    "--storage-dump", str(tmp_path / "storage.sql"),
                    "--bucket-manifest", str(tmp_path / "buckets.tsv"),
                    "--acl-manifest", str(tmp_path / "acl.tsv"),
                    "--walk-reminder-url", "http://127.0.0.1:9/functions/v1/send-walk-reminders",
                    "--output-dir", str(out),
                ],
                check=True,
            )
            apply_sql = (out / "apply-clean-bootstrap.sql").read_text()
            schema = apply_sql.index("\\i clean-public-schema.sql")
            privileges = apply_sql.index("\\i public-privileges.sql")
            commit = apply_sql.index("commit;")
            self.assertLess(schema, privileges)
            self.assertLess(privileges, commit)
            self.assertIn(
                'grant SELECT on table public.families to "authenticated";',
                (out / "public-privileges.sql").read_text(),
            )

    def test_bundle_refuses_without_acl_manifest(self) -> None:
        result = subprocess.run(
            [sys.executable, "-B", str(HERE / "build_clean_bootstrap_bundle.py"), "--help"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertIn("--acl-manifest", result.stdout)


if __name__ == "__main__":
    unittest.main()
