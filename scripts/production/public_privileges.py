#!/usr/bin/env python3
"""Exact API-role privileges for the application-owned ``public`` schema.

Why this exists
---------------
The clean Production bootstrap rebuilds ``public`` with ``drop schema public
cascade; create schema public;`` and replays a ``pg_dump --no-privileges``
schema dump.  That reproduces every table, function, policy and trigger, but
none of the GRANTs that let Supabase's API roles (``anon``, ``authenticated``,
``service_role``) reach them.  The recreated schema is owned by ``postgres``
with a NULL ACL, so PostgREST answers every request with
``permission denied for schema public`` (HTTP 403).

This module turns a privilege manifest captured from the fully replayed,
rehearsed database into deterministic SQL that sets the ACL of every
``public`` object for exactly those roles (plus ``PUBLIC``):

* schema USAGE/CREATE,
* table, view and sequence privileges,
* column-level privileges,
* function EXECUTE (including the SECURITY DEFINER hardening of
  20261028110508, which is part of the replayed chain),
* default privileges for objects that future migrations create as
  ``postgres``.

It first resets those roles' privileges on every ``public`` object, then
grants exactly what the manifest lists, so the result is identical to the
rehearsed database regardless of the starting state.  It never touches the
owner's own privileges, any other schema, data, or credentials.

The manifest is produced by ``MANIFEST_SQL`` (run with psql ``-At -F '\\t'``).
"""

from __future__ import annotations

import re

API_ROLES = ("PUBLIC", "anon", "authenticated", "service_role")
DEFAULT_ACL_ROLE = "postgres"

# One row per (kind, object, grantee): privileges comma-separated, sorted.
MANIFEST_SQL = r"""
with objs(kind, name, acl) as (
  select 'schema', 'public', n.nspacl
  from pg_namespace n where n.nspname = 'public'
  union all
  select case when c.relkind = 'S' then 'sequence' else 'table' end,
         format('public.%I', c.relname), c.relacl
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  union all
  select 'column', format('public.%I|%I', c.relname, a.attname), a.attacl
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  union all
  select 'function', format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         coalesce(p.proacl, acldefault('f'::"char", p.proowner))
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
  union all
  select 'default_' || case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                              when 'f' then 'functions' when 'T' then 'types' else 'other' end,
         pg_get_userbyid(d.defaclrole), d.defaclacl
  from pg_default_acl d
  where d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) = 'postgres'
), grants as (
  select o.kind, o.name,
         case when e.grantee = 0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end as grantee,
         e.privilege_type
  -- A NULL ACL means the owner-only default (no API-role privilege), except
  -- for routines, whose NULL default is expanded above. aclexplode() rejects
  -- an empty array, so NULL ACLs are skipped rather than coalesced.
  from objs o, aclexplode(o.acl) e
  where o.acl is not null and cardinality(o.acl) > 0
)
-- COLLATE "C" keeps the manifest byte-identical across database locales, so
-- an artifact from CI can be diffed against a hosted project.
select kind, name, grantee, string_agg(privilege_type, ',' order by privilege_type collate "C")
from grants
where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by kind, name, grantee
order by kind collate "C", name collate "C", grantee collate "C";
""".strip()

_KINDS = {"schema", "table", "sequence", "column", "function",
          "default_tables", "default_sequences", "default_functions", "default_types"}
_PRIVILEGES = {
    "schema": {"USAGE", "CREATE"},
    "table": {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"},
    "sequence": {"USAGE", "SELECT", "UPDATE"},
    "column": {"SELECT", "INSERT", "UPDATE", "REFERENCES"},
    "function": {"EXECUTE"},
    "default_tables": {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"},
    "default_sequences": {"USAGE", "SELECT", "UPDATE"},
    "default_functions": {"EXECUTE"},
    "default_types": {"USAGE"},
}
_OBJECT_NAME = re.compile(r'^public\.(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)$')
_FUNCTION_NAME = re.compile(r'^public\.(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)\([^;]*\)$')


def parse_manifest(
    text: str, *, require_schema_usage: bool = True
) -> list[tuple[str, str, str, tuple[str, ...]]]:
    """Validate and parse the tab-separated manifest (fail closed).

    ``require_schema_usage`` is disabled only when rendering a rollback from a
    snapshot of a (possibly broken) live database.
    """
    rows: list[tuple[str, str, str, tuple[str, ...]]] = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        parts = raw.split("\t")
        if len(parts) != 4:
            raise ValueError(f"invalid privilege manifest row: {raw!r}")
        kind, name, grantee, privs = parts
        if kind not in _KINDS:
            raise ValueError(f"unknown privilege kind {kind!r}")
        if grantee not in API_ROLES:
            raise ValueError(f"unexpected grantee {grantee!r}")
        privileges = tuple(sorted(p for p in privs.split(",") if p))
        if not privileges or not set(privileges) <= _PRIVILEGES[kind]:
            raise ValueError(f"invalid privileges {privs!r} for {kind} {name!r}")
        if kind == "schema" and name != "public":
            raise ValueError("only the public schema is managed here")
        if kind in {"table", "sequence"} and not _OBJECT_NAME.match(name):
            raise ValueError(f"invalid object name {name!r}")
        if kind == "column":
            table, _, column = name.partition("|")
            if not _OBJECT_NAME.match(table) or not column or ";" in column:
                raise ValueError(f"invalid column reference {name!r}")
        if kind == "function" and not _FUNCTION_NAME.match(name):
            raise ValueError(f"invalid function signature {name!r}")
        if kind.startswith("default_") and name != DEFAULT_ACL_ROLE:
            raise ValueError(f"default privileges are only managed for role {DEFAULT_ACL_ROLE}")
        rows.append((kind, name, grantee, privileges))
    if not rows and require_schema_usage:
        raise ValueError("privilege manifest is empty")
    if not require_schema_usage:
        return rows
    usage = {grantee for kind, _, grantee, privs in rows if kind == "schema" and "USAGE" in privs}
    missing = {"anon", "authenticated", "service_role"} - usage
    if missing:
        raise ValueError("manifest lacks USAGE on schema public for: " + ", ".join(sorted(missing)))
    return rows


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _grantee(role: str) -> str:
    return "PUBLIC" if role == "PUBLIC" else _ident(role)


def privileges_sql(manifest_text: str, *, require_schema_usage: bool = True) -> str:
    rows = parse_manifest(manifest_text, require_schema_usage=require_schema_usage)
    roles = ", ".join(_grantee(r) for r in API_ROLES)
    out = [
        "-- Generated by scripts/production/public_privileges.py from the privilege",
        "-- manifest of the fully replayed, rehearsed database. It resets and then",
        "-- grants the exact privileges of PUBLIC, anon, authenticated and",
        "-- service_role on application-owned public objects. It changes no data and",
        "-- never alters the object owner's privileges or any other schema.",
        "do $privileges_guard$",
        "begin",
        "  if to_regnamespace('public') is null then",
        "    raise exception 'public schema is missing';",
        "  end if;",
        "end",
        "$privileges_guard$;",
        "",
        f"revoke all on schema public from {roles};",
        f"revoke all on all tables in schema public from {roles};",
        f"revoke all on all sequences in schema public from {roles};",
        # FUNCTIONS excludes procedures; ROUTINES covers every routine kind.
        f"revoke all on all routines in schema public from {roles};",
        f"alter default privileges for role {_ident(DEFAULT_ACL_ROLE)} in schema public revoke all on tables from {roles};",
        f"alter default privileges for role {_ident(DEFAULT_ACL_ROLE)} in schema public revoke all on sequences from {roles};",
        f"alter default privileges for role {_ident(DEFAULT_ACL_ROLE)} in schema public revoke all on functions from {roles};",
        f"alter default privileges for role {_ident(DEFAULT_ACL_ROLE)} in schema public revoke all on types from {roles};",
        "",
    ]
    for kind, name, grantee, privs in rows:
        priv = ", ".join(privs)
        to = _grantee(grantee)
        if kind == "schema":
            out.append(f"grant {priv} on schema public to {to};")
        elif kind == "table":
            out.append(f"grant {priv} on table {name} to {to};")
        elif kind == "sequence":
            out.append(f"grant {priv} on sequence {name} to {to};")
        elif kind == "column":
            table, _, column = name.partition("|")
            cols = ", ".join(f"{p} ({column})" for p in privs)
            out.append(f"grant {cols} on table {table} to {to};")
        elif kind == "function":
            out.append(f"grant {priv} on routine {name} to {to};")
        else:
            target = kind[len("default_"):]
            out.append(
                f"alter default privileges for role {_ident(DEFAULT_ACL_ROLE)} in schema public "
                f"grant {priv} on {target} to {to};"
            )
    out.append("")
    return "\n".join(out)


def parse_catalog_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for raw in text.splitlines():
        if not raw.strip():
            continue
        key, _, value = raw.partition("\t")
        if not re.fullmatch(r"[a-z_]+", key) or not value.isdigit():
            raise ValueError(f"invalid catalog count row: {raw!r}")
        counts[key] = int(value)
    for key in ("public_tables", "public_functions"):
        if key not in counts:
            raise ValueError(f"catalog counts lack {key}")
    return counts


def remediation_sql(manifest_text: str, catalog_counts_text: str, source_commit: str) -> str:
    """Wrap ``privileges_sql`` for an already-bootstrapped live database.

    Adds fail-closed preflight guards (the live ``public`` catalog must match
    the rehearsed artifact) and post-conditions. Every statement must run in
    one transaction (``psql -1`` or the Supabase migration executor), so any
    failed guard leaves the database unchanged.
    """
    import hashlib

    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("source commit must be a full 40-character Git SHA")
    counts = parse_catalog_counts(catalog_counts_text)
    body = privileges_sql(manifest_text)
    digest = hashlib.sha256(manifest_text.encode("utf-8")).hexdigest()
    tables, functions = counts["public_tables"], counts["public_functions"]
    return f"""-- Production API-role privilege remediation.
-- Source commit: {source_commit}
-- public-acl-manifest.tsv sha256: {digest}
-- Changes privileges only. It does not read or modify any application row,
-- Auth user, Storage object, policy, function body or secret.
-- Run as ONE transaction: Supabase migration executor or `psql -1`.

do $preflight$
declare
  foreign_owned text;
begin
  if to_regnamespace('public') is null then
    raise exception 'preflight: public schema is missing';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'preflight: Supabase API roles are missing';
  end if;
  if (select count(*) from pg_tables where schemaname = 'public') <> {tables} then
    raise exception 'preflight: expected {tables} public tables, found %',
      (select count(*) from pg_tables where schemaname = 'public');
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> {functions} then
    raise exception 'preflight: expected {functions} public routines, found %',
      (select count(*) from pg_proc where pronamespace = 'public'::regnamespace);
  end if;
  select string_agg(name, ', ') into foreign_owned from (
    select format('relation %s owned by %s', c.oid::regclass, pg_get_userbyid(c.relowner)) as name
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and pg_get_userbyid(c.relowner) <> 'postgres'
    union all
    select format('routine %s owned by %s', p.oid::regprocedure, pg_get_userbyid(p.proowner))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and pg_get_userbyid(p.proowner) <> 'postgres'
  ) unexpected;
  if foreign_owned is not null then
    raise exception 'preflight: public objects not owned by postgres: %', foreign_owned;
  end if;
end
$preflight$;

{body}
do $postconditions$
declare
  unsafe text;
begin
  if not (has_schema_privilege('anon', 'public', 'USAGE')
      and has_schema_privilege('authenticated', 'public', 'USAGE')
      and has_schema_privilege('service_role', 'public', 'USAGE')) then
    raise exception 'postcondition: API roles lack USAGE on schema public';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into unsafe
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if unsafe is not null then
    raise exception 'postcondition: anon can execute SECURITY DEFINER routines: %', unsafe;
  end if;
  if has_schema_privilege('anon', 'public', 'CREATE')
      or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'postcondition: client roles may create objects in public';
  end if;
end
$postconditions$;
"""


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("manifest-sql", help="print the read-only manifest query")
    render = sub.add_parser("render", help="render public-privileges.sql from a manifest")
    render.add_argument("manifest")
    remediation = sub.add_parser(
        "remediation", help="render the guarded live-database remediation from a CI artifact"
    )
    remediation.add_argument("--manifest", required=True)
    remediation.add_argument("--catalog-counts", required=True)
    remediation.add_argument("--source-commit", required=True)
    rollback = sub.add_parser(
        "rollback", help="render SQL restoring a live privilege snapshot exactly"
    )
    rollback.add_argument("snapshot")
    args = parser.parse_args(argv)

    def read(path: str) -> str:
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    if args.command == "manifest-sql":
        sys.stdout.write(MANIFEST_SQL + "\n")
    elif args.command == "render":
        sys.stdout.write(privileges_sql(read(args.manifest)))
    elif args.command == "remediation":
        sys.stdout.write(
            remediation_sql(read(args.manifest), read(args.catalog_counts), args.source_commit)
        )
    else:
        sys.stdout.write(
            "-- Rollback: restores the API-role privileges captured in the snapshot,\n"
            "-- including a missing schema USAGE. Run as one transaction.\n"
            + privileges_sql(read(args.snapshot), require_schema_usage=False)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
