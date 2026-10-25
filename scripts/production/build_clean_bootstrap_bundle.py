#!/usr/bin/env python3
"""Build the portable, Storage-safe part of a clean Supabase bootstrap.

The source dumps are produced from the final database in the isolated
full-chain rehearsal.  A raw dump of both ``public`` and ``storage`` is useful
as evidence, but is not a valid hosted Supabase migration: the ``storage``
schema is operated by Supabase and its internal shape changes independently
from the application.  This program deliberately keeps only application-owned
Storage configuration (buckets and policies on ``storage.objects``).

It never reads production credentials and never connects to a database.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def public_schema_without_schema_creation(source: str) -> str:
    """Remove dump controls that would conflict after the controlled reset."""
    if re.search(r"(?mi)^CREATE SCHEMA storage;|^CREATE TABLE storage\\.", source):
        raise ValueError("public dump contains managed storage DDL; use pg_dump --schema=public")
    kept: list[str] = []
    for line in source.splitlines(keepends=True):
        normalized = line.strip().lower()
        if normalized in {
            "create schema public;",
            "alter schema public owner to postgres;",
        }:
            continue
        # PostgreSQL 17 emits these per-dump random restriction tokens.  They
        # are not schema and make a content-addressed artifact non-deterministic.
        if re.match(r"^\\(?:un\\)?restrict ", line):
            continue
        kept.append(line)
    result = "".join(kept)
    if "CREATE SCHEMA public;" in result:
        raise ValueError("public dump still creates public schema")
    return result


def storage_object_policies(storage_dump: str) -> list[tuple[str, str]]:
    """Extract only policy statements explicitly owned by this application."""
    # pg_dump separates objects by a comment block and every policy statement
    # ends with a semicolon.  Storage policies can contain nested SQL
    # expressions, so do not attempt to parse the expression itself.
    pattern = re.compile(
        r"(?ms)^CREATE POLICY\s+\"([^\"]+)\"\s+ON\s+storage\.objects\b.*?;\s*$"
    )
    policies = [(match.group(1), match.group(0).strip()) for match in pattern.finditer(storage_dump)]
    if not policies:
        raise ValueError("no application policies for storage.objects found in storage dump")
    names = [name for name, _ in policies]
    if len(names) != len(set(names)):
        raise ValueError("duplicate storage.objects policy name in storage dump")
    return policies


def bucket_values(manifest: str) -> list[str]:
    values: list[str] = []
    for raw_line in manifest.splitlines():
        if not raw_line.strip():
            continue
        parts = raw_line.split("\t")
        if len(parts) != 4:
            raise ValueError(f"invalid bucket manifest row: {raw_line!r}")
        bucket_id, is_public, size_limit, mime_types = parts
        if is_public not in {"t", "f"}:
            raise ValueError(f"invalid public value for bucket {bucket_id!r}")
        size_sql = size_limit if size_limit else "NULL"
        mime_sql = "NULL"
        if mime_types:
            mime_sql = "ARRAY[" + ", ".join(sql_literal(mime) for mime in mime_types.split(",")) + "]::text[]"
        values.append(
            f"({sql_literal(bucket_id)}, {sql_literal(bucket_id)}, {'true' if is_public == 't' else 'false'}, {size_sql}, {mime_sql})"
        )
    if not values:
        raise ValueError("bucket manifest is empty")
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--public-dump", type=Path, required=True)
    parser.add_argument("--storage-dump", type=Path, required=True)
    parser.add_argument("--bucket-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    public_sql = public_schema_without_schema_creation(args.public_dump.read_text())
    policies = storage_object_policies(args.storage_dump.read_text())
    buckets = bucket_values(args.bucket_manifest.read_text())

    (output_dir / "clean-public-schema.sql").write_text(public_sql)

    storage_lines = [
        "-- Generated from the isolated full-chain rehearsal.",
        "-- This file intentionally does not create, alter, or drop the managed storage schema.",
        "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)",
        "values",
        ",\n".join(f"  {value}" for value in buckets),
        "on conflict (id) do update set",
        "  name = excluded.name,",
        "  public = excluded.public,",
        "  file_size_limit = excluded.file_size_limit,",
        "  allowed_mime_types = excluded.allowed_mime_types;",
        "",
        "alter table storage.objects enable row level security;",
        "",
    ]
    for name, _ in policies:
        storage_lines.append(f'drop policy if exists "{name}" on storage.objects;')
    storage_lines.append("")
    storage_lines.extend(statement + "\n" for _, statement in policies)
    (output_dir / "storage-configuration.sql").write_text("\n".join(storage_lines))

    # psql meta-commands are intentional: this entrypoint makes the exact
    # destructive boundary and its fail-closed preconditions reviewable.
    (output_dir / "apply-clean-bootstrap.sql").write_text(
        """\\set ON_ERROR_STOP on
-- Run only with psql against the approved Production project, after the
-- external backup/restore evidence has been accepted and legacy Auth users
-- and Storage objects have been removed through their supported APIs.
begin;

do $$
begin
  if exists (select 1 from storage.objects) then
    raise exception 'refusing clean bootstrap: storage.objects is not empty';
  end if;
  if exists (select 1 from auth.users) then
    raise exception 'refusing clean bootstrap: auth.users is not empty';
  end if;
end $$;

drop schema if exists public cascade;
drop schema if exists legacy_archive_20261023 cascade;
create schema public;
\\i clean-public-schema.sql
\\i storage-configuration.sql
commit;
"""
    )


if __name__ == "__main__":
    main()
