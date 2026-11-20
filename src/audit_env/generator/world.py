"""Build a balanced source world before introducing any audit discrepancies."""

import csv
import io
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from random import Random

from audit_env.schemas import (
    AMOUNT_TOLERANCE_MINOR, CURRENCY_EXPONENTS, FX_FIELDS, ISSUE_TYPES, LEDGER_FIELDS,
    VERSION, convert_minor, json_text, parse_offset,
)

COMBINATIONS = {
    "foreign_payment_cutoff": ("unallocated_payment", "cutoff_error"),
    "foreign_duplicate_fx": ("duplicate_invoice", "fx_mismatch"),
}
CASE_TYPES = (*ISSUE_TYPES, *COMBINATIONS)


@dataclass(frozen=True)
class GeneratorConfig:
    rows: int = 240
    documents: int = 36
    first_day: str = "2026-10-01"
    timezone: str = "+05:00"
    cases: tuple[str, ...] = ()

    def __post_init__(self):
        if type(self.rows) is not int or not 200 <= self.rows <= 2000:
            raise ValueError("rows must be between 200 and 2000")
        if type(self.documents) is not int or not 20 <= self.documents <= 200:
            raise ValueError("documents must be between 20 and 200")
        if self.rows < 2 * self.documents:
            raise ValueError("each source document needs two ledger rows")
        if not isinstance(self.cases, (tuple, list)):
            raise ValueError("invalid cases")
        object.__setattr__(self, "cases", tuple(self.cases))
        if any(case not in CASE_TYPES for case in self.cases):
            raise ValueError("unknown case")
        if sum(len(COMBINATIONS.get(case, (case,))) for case in self.cases) > 12:
            raise ValueError("too many issues")
        needed = 6 + sum(1 if case in {"fx_mismatch", "cutoff_error"} else 2 for case in self.cases)
        if needed > self.documents:
            raise ValueError("insufficient documents for the selected cases")
        parse_offset(self.timezone)
        start = date.fromisoformat(self.first_day)
        if not 2 <= start.year <= 9998:
            raise ValueError("unsupported period year")


@dataclass
class Episode:
    manifest: dict
    policy: dict
    tables: dict
    truth: list
    provenance: dict


def ledger_balances(ledger):
    result = defaultdict(int)
    for row in ledger:
        result[row["currency"]] += row["debit_minor"] - row["credit_minor"]
    return dict(result)


class World:
    def __init__(self, seed, config):
        self.rng = Random(seed)
        self.config = config
        self.start = datetime.combine(date.fromisoformat(config.first_day), time(), parse_offset(config.timezone))
        self.end = self.start + timedelta(days=30)
        self.ids = set()
        self.episode_id = self.new_id("e")
        self.tables = {table: [] for table in ("ledger", "invoices", "payments", "fx")}
        self.rates = {}
        self.truth = []
        self.changes = []
        self.entities = [self.new_id("ent") for _ in range(12)]
        for day in range(-1, 31):
            for currency, major, scale in (("USD", 47000, 100), ("JPY", 275, 3)):
                amount = major + day * scale + self.rng.randrange(scale)
                rate = f"{amount // 100}.{amount % 100:02}"
                quote = {"date": (self.start + timedelta(days=day)).date().isoformat(),
                         "source_currency": currency, "target_currency": "KZT", "rate": rate}
                self.tables["fx"].append(quote)
                self.rates[currency, quote["date"]] = quote

    def new_id(self, prefix):
        while True:
            candidate = f"{prefix}-{self.rng.getrandbits(96):024x}"
            if candidate not in self.ids:
                self.ids.add(candidate)
                return candidate

    def at(self, day, hour=11):
        return self.start + timedelta(days=day, hours=hour)

    def base_amount(self, amount, currency, event):
        if currency == "KZT":
            return amount
        quote = self.quote(currency, event)
        return convert_minor(amount, currency, "KZT", quote["rate"])

    def quote(self, currency, event):
        return self.rates[currency, event.astimezone(self.start.tzinfo).date().isoformat()]

    def post(self, amount, stamp, left, right, entity, invoice=None, payment=None):
        rows = []
        for account, debit, credit in ((left, amount, 0), (right, 0, amount)):
            row = {"row_id": self.new_id("r"), "timestamp": stamp.isoformat(), "account": account,
                   "debit_minor": debit, "credit_minor": credit, "currency": "KZT", "entity_id": entity,
                   "invoice_id": invoice, "payment_id": payment}
            self.tables["ledger"].append(row)
            rows.append(row)
        return rows

    def invoice(self, *, event, currency="KZT", amount=None, entity=None):
        entity = entity or self.rng.choice(self.entities)
        amount = self.rng.randrange(20000, 800000) if amount is None else amount
        invoice = {
            "doc_id": self.new_id("doc"), "invoice_id": self.new_id("inv"), "entity_id": entity,
            "issued_at": event.isoformat(), "due_at": (event + timedelta(days=30)).isoformat(),
            "currency": currency, "total_minor": amount,
            "line_items": [{"sku": f"service-{self.rng.randrange(1, 16)}", "quantity": 1,
                            "unit_price_minor": amount, "line_total_minor": amount,
                            "source_ref": self.new_id("ref")}],
        }
        self.tables["invoices"].append(invoice)
        rows = self.post(self.base_amount(amount, currency, event), event, "EXPENSE", "PAYABLE",
                         entity, invoice=invoice["invoice_id"])
        return invoice, rows

    def payment(self, invoice, *, event, amount, currency="KZT"):
        payment = {
            "doc_id": self.new_id("doc"), "payment_id": self.new_id("pay"), "timestamp": event.isoformat(),
            "currency": currency, "amount_minor": amount,
            "invoice_refs": [{"invoice_id": invoice["invoice_id"], "allocated_minor": amount}],
        }
        self.tables["payments"].append(payment)
        refund = amount < 0
        rows = self.post(self.base_amount(abs(amount), currency, event), event,
                         "BANK" if refund else "PAYABLE", "EXPENSE" if refund else "BANK",
                         invoice["entity_id"], invoice=invoice["invoice_id"], payment=payment["payment_id"])
        return payment, rows

    def fill(self):
        while sum(len(self.tables[name]) for name in ("invoices", "payments")) < self.config.documents:
            self.invoice(event=self.at(self.rng.randrange(1, 27)), currency=self.rng.choice(tuple(CURRENCY_EXPONENTS)))
        ledger = self.tables["ledger"]
        while len(ledger) + 2 <= self.config.rows:
            amount = self.rng.randrange(100, 70000)
            self.post(amount, self.at(self.rng.randrange(30)), "OPERATING_EXPENSE", "BANK",
                      self.rng.choice(self.entities))
        if len(ledger) < self.config.rows:
            source = ledger[-2]  # A distractor or filler debit, outside all injection slots.
            amount = source["debit_minor"] // 2
            source["debit_minor"] -= amount
            ledger.append({**source, "row_id": self.new_id("r"), "debit_minor": amount})


def generate(seed: int, config: GeneratorConfig | None = None) -> Episode:
    """Seed and config stay entirely on the generator/evaluator side."""
    from audit_env.generator.distractors import add_distractors
    from audit_env.generator.errors import inject, prepare_cases

    if type(seed) is not int:
        raise ValueError("seed must be an integer")
    config = config if config is not None else GeneratorConfig()
    world = World(seed, config)
    slots = prepare_cases(world)
    add_distractors(world)
    world.fill()
    balances = ledger_balances(world.tables["ledger"])
    if len(world.tables["ledger"]) != config.rows or any(balances.values()):
        raise ValueError("invalid clean world")
    inject(world, slots)
    for rows in world.tables.values():
        world.rng.shuffle(rows)

    rounding = {"mode": "ROUND_HALF_EVEN", "currency_exponents": dict(CURRENCY_EXPONENTS)}
    manifest = {"schema_version": VERSION, "episode_id": world.episode_id, "base_currency": "KZT",
                "period_start": world.start.isoformat(), "period_end": world.end.isoformat(),
                "timezone": config.timezone, "counts": {key: len(value) for key, value in world.tables.items()},
                "rounding_rules": rounding}
    policy = {"fx_date": "source_event_in_company_timezone",
              "period_bounds": "start_inclusive_end_exclusive",
              "period_start": manifest["period_start"], "period_end": manifest["period_end"],
              "timezone": config.timezone, "rounding_rules": rounding,
              "payment_allocation": "full_signed_payment_amount_in_payment_currency",
              "invoice_identity": "entity_id_and_line_items_source_ref",
              "amount_tolerance_minor": AMOUNT_TOLERANCE_MINOR}
    provenance = {"generator_version": VERSION, "seed": seed, "config": asdict(config),
                  "clean_balances_minor": balances, "changes": world.changes}
    return Episode(manifest, policy, world.tables, world.truth, provenance)


def encode_public(episode: Episode):
    files = {"manifest.json": json_text(episode.manifest) + "\n", "policy.json": json_text(episode.policy) + "\n"}
    for table, fields in (("ledger", LEDGER_FIELDS), ("fx", FX_FIELDS)):
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(episode.tables[table])
        files[f"{table}.csv"] = stream.getvalue()
    for table in ("invoices", "payments"):
        files[f"{table}.jsonl"] = "".join(json_text(row) + "\n" for row in episode.tables[table])
    return files


def write_episode(episode: Episode, public: Path, private: Path):
    public.mkdir(parents=True, exist_ok=True)
    private.mkdir(parents=True, exist_ok=True)
    for name, contents in encode_public(episode).items():
        (public / name).write_text(contents, encoding="utf-8", newline="\n")
    for name, data in (("truth.json", episode.truth), ("provenance.json", episode.provenance)):
        (private / name).write_text(json_text(data) + "\n", encoding="utf-8", newline="\n")
