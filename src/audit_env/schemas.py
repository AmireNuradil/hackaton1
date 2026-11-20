"""Shared, JSON-safe schema and accounting conventions."""

import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Context, Decimal, ROUND_HALF_EVEN, localcontext

VERSION = "1.0.0"
CURRENCY_EXPONENTS = {"JPY": 0, "KZT": 2, "USD": 2}
ISSUE_TYPES = ("duplicate_invoice", "unallocated_payment", "fx_mismatch", "cutoff_error")
TABLES = {"ledger": "row_id", "invoices": "invoice_id", "payments": "payment_id", "fx": "rate_id"}
PUBLIC_FILES = ("manifest.json", "policy.json", "ledger.csv", "invoices.jsonl", "payments.jsonl", "fx.csv")
LEDGER_FIELDS = ("row_id", "timestamp", "account", "debit_minor", "credit_minor", "currency",
                 "entity_id", "invoice_id", "payment_id")
FX_FIELDS = ("date", "source_currency", "target_currency", "rate")
MAX_STEPS = 100
MAX_SECONDS = 60
MAX_FINDINGS = 30
MAX_EVIDENCE = 10
MAX_EXPLANATION = 1000
MAX_MINOR = 10**18 - 1
AMOUNT_TOLERANCE_MINOR = 0

_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}", re.ASCII)
_CURRENCY_CODE = re.compile(r"[A-Z]{3}", re.ASCII)
_OFFSET = re.compile(r"([+-])(0[0-9]|1[0-4]):([0-5][0-9])")
_FINDING_KEYS = {"type", "affected_ids", "claimed_amount_minor", "currency", "evidence_ids", "explanation"}


def json_text(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(",", ":"))


def parse_time(value):
    if not isinstance(value, str) or "T" not in value:
        raise ValueError("invalid_timestamp")
    result = datetime.fromisoformat(value)
    if result.utcoffset() is None:
        raise ValueError("invalid_timestamp")
    return result


def parse_offset(value):
    match = _OFFSET.fullmatch(value) if isinstance(value, str) else None
    if match is None or (match[2] == "14" and match[3] != "00"):
        raise ValueError("invalid_timezone")
    minutes = 60 * int(match[2]) + int(match[3])
    return timezone(timedelta(minutes=minutes if match[1] == "+" else -minutes))


def fx_id(record, episode_id):
    return f"{episode_id}:{record['source_currency']}:{record['target_currency']}:{record['date']}"


def convert_minor(amount, source, target, rate):
    """Rate is target major units per source major unit."""
    if type(amount) is not int or not isinstance(rate, str) or not re.fullmatch(r"[0-9]{1,18}(?:\.[0-9]{1,18})?", rate):
        raise ValueError("invalid_money")
    decimal_rate = Decimal(rate)
    if decimal_rate <= 0 or abs(amount) > MAX_MINOR:
        raise ValueError("invalid_money")
    with localcontext(Context(prec=64, rounding=ROUND_HALF_EVEN)):
        difference = CURRENCY_EXPONENTS[target] - CURRENCY_EXPONENTS[source]
        return int((Decimal(amount) * decimal_rate).scaleb(difference).to_integral_value())


def valid_id(value):
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def canonical_ids(values):
    return tuple(sorted(set(values)))


def _ids(value, limit=None):
    return isinstance(value, list) and (limit is None or len(value) <= limit) and all(map(valid_id, value))


def validate_submission(payload, episode_id):
    if not isinstance(payload, dict) or payload.keys() != {"episode_id", "findings"}:
        return False
    findings = payload["findings"]
    if payload["episode_id"] != episode_id or not isinstance(findings, list) or len(findings) > MAX_FINDINGS:
        return False
    for finding in findings:
        if not isinstance(finding, dict) or finding.keys() != _FINDING_KEYS:
            return False
        currency = finding["currency"]
        amount = finding["claimed_amount_minor"]
        explanation = finding["explanation"]
        if not (
            finding["type"] in ISSUE_TYPES and isinstance(currency, str) and _CURRENCY_CODE.fullmatch(currency)
            and type(amount) is int
            and _ids(finding["affected_ids"]) and _ids(finding["evidence_ids"], MAX_EVIDENCE)
            and isinstance(explanation, str) and len(explanation) <= MAX_EXPLANATION
        ):
            return False
    return True
