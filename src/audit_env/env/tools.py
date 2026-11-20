"""Read-only tools over the six public files."""

import csv
import io
import json
from copy import deepcopy
from datetime import date

from audit_env.schemas import (
    CURRENCY_EXPONENTS, FX_FIELDS, LEDGER_FIELDS, MAX_MINOR, PUBLIC_FILES, TABLES, VERSION,
    convert_minor, fx_id, parse_offset, parse_time, valid_id,
)

MANIFEST_KEYS = {"schema_version", "episode_id", "base_currency", "period_start", "period_end", "timezone",
                 "counts", "rounding_rules"}
POLICY_KEYS = {"fx_date", "period_bounds", "period_start", "period_end", "timezone", "rounding_rules",
               "payment_allocation", "invoice_identity", "amount_tolerance_minor"}
INVOICE_KEYS = {"doc_id", "invoice_id", "entity_id", "issued_at", "due_at", "currency", "total_minor", "line_items"}
PAYMENT_KEYS = {"doc_id", "payment_id", "timestamp", "currency", "amount_minor", "invoice_refs"}
ITEM_KEYS = {"sku", "quantity", "unit_price_minor", "line_total_minor", "source_ref"}
REF_KEYS = {"invoice_id", "allocated_minor"}
ACCOUNTS = {"EXPENSE", "PAYABLE", "BANK", "OPERATING_EXPENSE"}


class ToolError(ValueError):
    """The only permitted tool errors exposed to the agent."""


def _require(condition):
    if not condition:
        raise ValueError("invalid_public_episode")


def _csv(text, fields):
    reader = csv.DictReader(io.StringIO(text))
    _require(tuple(reader.fieldnames or ()) == fields)
    for row in reader:
        _require(row.keys() == set(fields) and all(value is not None for value in row.values()))
        yield row


def _jsonl(text):
    return [json.loads(line) for line in text.splitlines() if line]


def _minor(value, signed=False):
    return type(value) is int and (-MAX_MINOR if signed else 0) <= value <= MAX_MINOR


def _metadata(manifest, policy, tables):
    _require(manifest.keys() == MANIFEST_KEYS and policy.keys() == POLICY_KEYS)
    _require(manifest["schema_version"] == VERSION and valid_id(manifest["episode_id"]))
    _require(manifest["base_currency"] in CURRENCY_EXPONENTS)
    _require(manifest["counts"] == {table: len(records) for table, records in tables.items()})
    _require(200 <= len(tables["ledger"]) <= 2000 and 20 <= len(tables["invoices"]) + len(tables["payments"]) <= 200)
    _require(manifest["rounding_rules"] == {"mode": "ROUND_HALF_EVEN", "currency_exponents": CURRENCY_EXPONENTS})
    tz = parse_offset(manifest["timezone"])
    start, end = (parse_time(manifest[key]) for key in ("period_start", "period_end"))
    _require(start < end and start.utcoffset() == end.utcoffset() == tz.utcoffset(None))
    for key in ("period_start", "period_end", "rounding_rules", "timezone"):
        _require(policy[key] == manifest[key])
    _require(policy["fx_date"] == "source_event_in_company_timezone")
    _require(policy["period_bounds"] == "start_inclusive_end_exclusive")
    _require(policy["payment_allocation"] == "full_signed_payment_amount_in_payment_currency")
    _require(policy["invoice_identity"] == "entity_id_and_line_items_source_ref")
    tolerance = policy["amount_tolerance_minor"]
    _require(_minor(tolerance))


def _ledger(text):
    for row in _csv(text, LEDGER_FIELDS):
        row["debit_minor"] = int(row["debit_minor"])
        row["credit_minor"] = int(row["credit_minor"])
        for key in ("invoice_id", "payment_id"):
            row[key] = row[key] or None
            _require(row[key] is None or valid_id(row[key]))
        _require(valid_id(row["entity_id"]) and valid_id(row["row_id"]))
        _require(_minor(row["debit_minor"]) and _minor(row["credit_minor"]))
        _require(row["account"] in ACCOUNTS and row["currency"] in CURRENCY_EXPONENTS)
        parse_time(row["timestamp"])
        yield row


def _validate_documents(invoices, payments):
    for invoice in invoices:
        _require(invoice.keys() == INVOICE_KEYS and invoice["currency"] in CURRENCY_EXPONENTS)
        _require(all(valid_id(invoice[key]) for key in ("doc_id", "invoice_id", "entity_id")))
        _require(_minor(invoice["total_minor"]))
        _require(parse_time(invoice["issued_at"]) <= parse_time(invoice["due_at"]))
        _require(isinstance(invoice["line_items"], list) and 1 <= len(invoice["line_items"]) <= 100)
        for item in invoice["line_items"]:
            _require(item.keys() == ITEM_KEYS and valid_id(item["sku"]) and valid_id(item["source_ref"]))
            _require(all(_minor(item[key]) for key in ("quantity", "unit_price_minor", "line_total_minor")))
    for payment in payments:
        _require(payment.keys() == PAYMENT_KEYS and payment["currency"] in CURRENCY_EXPONENTS)
        _require(valid_id(payment["doc_id"]) and valid_id(payment["payment_id"]))
        _require(_minor(payment["amount_minor"], signed=True))
        parse_time(payment["timestamp"])
        _require(isinstance(payment["invoice_refs"], list) and len(payment["invoice_refs"]) <= 100)
        for ref in payment["invoice_refs"]:
            _require(ref.keys() == REF_KEYS and valid_id(ref["invoice_id"]))
            _require(_minor(ref["allocated_minor"], signed=True))


class PublicRecords:
    def __init__(self, files):
        _require(isinstance(files, dict) and files.keys() == set(PUBLIC_FILES))
        self.manifest = json.loads(files["manifest.json"])
        self.policy = json.loads(files["policy.json"])
        self.tables = {"ledger": list(_ledger(files["ledger.csv"])),
                       "invoices": _jsonl(files["invoices.jsonl"]),
                       "payments": _jsonl(files["payments.jsonl"]),
                       "fx": list(_csv(files["fx.csv"], FX_FIELDS))}
        _metadata(self.manifest, self.policy, self.tables)
        _validate_documents(self.tables["invoices"], self.tables["payments"])
        for row in self.tables["fx"]:
            _require(date.fromisoformat(row["date"]).isoformat() == row["date"])
            convert_minor(0, row["source_currency"], row["target_currency"], row["rate"])
            row["rate_id"] = fx_id(row, self.manifest["episode_id"])
        self.indices = {
            table: {row[TABLES[table]]: row for row in records}
            for table, records in self.tables.items()
        }
        _require(all(len(self.indices[t]) == len(rows) for t, rows in self.tables.items()))
        documents = self.tables["invoices"] + self.tables["payments"]
        self.documents = {record["doc_id"]: record for record in documents}
        _require(len(self.documents) == len(documents))

    def _table(self, table):
        if not isinstance(table, str) or table not in self.tables:
            raise ToolError("unknown_table")
        return self.tables[table]

    def list_records(self, table, cursor=None, limit=50):
        rows = self._table(table)
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ToolError("invalid_limit")
        offset = 0
        if cursor is not None:
            if not isinstance(cursor, str) or len(cursor) > 32:
                raise ToolError("invalid_cursor")
            prefix, separator, index = cursor.partition(":")
            if prefix != table or not separator or not index.isascii() or not index.isdecimal():
                raise ToolError("invalid_cursor")
            offset = int(index)
            if str(offset) != index or not 0 <= offset < len(rows):
                raise ToolError("invalid_cursor")
        end = offset + limit
        return {"table": table, "records": deepcopy(rows[offset:end]),
                "next_cursor": f"{table}:{end}" if end < len(rows) else None}

    def get_record(self, table, identifier):
        self._table(table)
        return self._lookup(self.indices[table], identifier)

    def get_document(self, identifier):
        return self._lookup(self.documents, identifier)

    @staticmethod
    def _lookup(index, identifier):
        if not valid_id(identifier) or identifier not in index:
            raise ToolError("unknown_id")
        return deepcopy(index[identifier])

    def evidence_ids(self):
        return set(self.documents) | self.indices["ledger"].keys() | self.indices["fx"].keys()
