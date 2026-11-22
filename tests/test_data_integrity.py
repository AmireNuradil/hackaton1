from collections import defaultdict
from copy import deepcopy
from datetime import date
from decimal import Decimal

import pytest

from audit_env.generator.permuter import permute
from audit_env.generator.world import CASE_TYPES, COMBINATIONS, GeneratorConfig, encode_public, generate
from audit_env.policies.flag_all_policy import FlagAllAttack
from audit_env.policies.oracle_policy import OraclePolicy
from audit_env.policies.random_policy import RandomExplorer
from audit_env.policies.recon_policy import SimpleReconciler
from audit_env.runner import run_episode
from audit_env.schemas import ISSUE_TYPES, TABLES, fx_id, parse_offset, parse_time


def by_evidence(episode):
    result = {}
    for table, records in episode.tables.items():
        for row in records:
            key = fx_id(row, episode.manifest["episode_id"]) if table == "fx" else row.get("doc_id", row[TABLES[table]])
            assert key not in result
            result[key] = row
    return result


def restore_clean(episode):
    originals = {
        table: {record[TABLES[table]]: record for record in deepcopy(records)}
        for table, records in episode.tables.items() if table != "fx"
    }
    for change in reversed(episode.provenance["changes"]):
        for patch in reversed(change["patches"]):
            table = patch["table"]
            key = patch["after"][TABLES[table]]
            assert originals[table][key] == patch["after"]
            originals[table][key] = patch["before"]
    return originals


def assert_clean_relationships(episode):
    clean = restore_clean(episode)
    ledger = list(clean["ledger"].values())
    balance = defaultdict(int)
    for row in ledger:
        balance[row["currency"]] += row["debit_minor"] - row["credit_minor"]
    assert balance and all(value == 0 for value in balance.values())
    assert episode.provenance["clean_balances_minor"] == balance
    tz = parse_offset(episode.policy["timezone"])
    start, end = (parse_time(episode.policy[key]) for key in ("period_start", "period_end"))
    fx = {(r["source_currency"], r["date"]): Decimal(r["rate"]) for r in episode.tables["fx"]}

    def base(amount, currency, stamp):
        if currency == "KZT":
            return amount
        rate = fx[currency, parse_time(stamp).astimezone(tz).date().isoformat()]
        return int(round(amount * rate * (100 if currency == "JPY" else 1)))

    for invoice in clean["invoices"].values():
        rows = [r for r in ledger if r["invoice_id"] == invoice["invoice_id"] and r["payment_id"] is None]
        assert sum(r["debit_minor"] for r in rows) == sum(r["credit_minor"] for r in rows)
        assert sum(r["debit_minor"] for r in rows) == base(
            invoice["total_minor"], invoice["currency"], invoice["issued_at"])
        assert start <= parse_time(invoice["issued_at"]) < end
        assert parse_time(invoice["due_at"]) > parse_time(invoice["issued_at"])
        assert sum(item["line_total_minor"] for item in invoice["line_items"]) == invoice["total_minor"]
    for payment in clean["payments"].values():
        rows = [r for r in ledger if r["payment_id"] == payment["payment_id"]]
        assert sum(r["debit_minor"] for r in rows) == sum(r["credit_minor"] for r in rows)
        assert sum(r["debit_minor"] for r in rows) == base(
            abs(payment["amount_minor"]), payment["currency"], payment["timestamp"])
        assert sum(r["allocated_minor"] for r in payment["invoice_refs"]) == payment["amount_minor"]
        assert all(r["invoice_id"] in clean["invoices"] for r in payment["invoice_refs"])
    assert all(start <= parse_time(row["timestamp"]) < end for row in ledger)
    assert len({(inv["entity_id"], inv["line_items"][0]["source_ref"]) for inv in clean["invoices"].values()}) \
        == len(clean["invoices"])


def assert_public_proof(episode, issue, ids, records):
    proof = [records[key] for key in ids]
    affected = set(issue["affected_ids"])
    amount = issue["expected_amount_minor"]
    tz = parse_offset(episode.policy["timezone"])
    kind = issue["type"]
    if kind == "duplicate_invoice":
        original, copy = proof
        assert {original["invoice_id"], copy["invoice_id"]} == affected
        assert original["entity_id"] == copy["entity_id"]
        assert original["line_items"] == copy["line_items"]
        assert original["currency"] == copy["currency"] == issue["currency"]
        assert amount == copy["total_minor"] == original["total_minor"]
    elif kind == "unallocated_payment":
        payment, = proof
        assert affected == {payment["payment_id"]}
        assert payment["currency"] == issue["currency"]
        assert amount == payment["amount_minor"] - sum(r["allocated_minor"] for r in payment["invoice_refs"]) > 0
    elif kind == "fx_mismatch":
        invoice, posting, rate = proof
        assert affected == {invoice["invoice_id"]} == {posting["invoice_id"]}
        assert invoice["currency"] == rate["source_currency"]
        assert posting["currency"] == issue["currency"] == rate["target_currency"]
        assert parse_time(invoice["issued_at"]).astimezone(tz).date() == date.fromisoformat(rate["date"])
        expected = int(round(Decimal(rate["rate"]) * invoice["total_minor"]))
        assert amount == abs(expected - (posting["debit_minor"] or posting["credit_minor"])) > 0
    else:
        document, posting = proof
        id_key = "payment_id" if "payment_id" in document else "invoice_id"
        date_key = "timestamp" if id_key == "payment_id" else "issued_at"
        assert affected == {document[id_key]} == {posting[id_key]}
        event = parse_time(document[date_key]).astimezone(tz)
        recorded = parse_time(posting["timestamp"]).astimezone(tz)
        end = parse_time(episode.policy["period_end"])
        assert event.date() != recorded.date()
        assert event < end <= recorded
        assert posting["currency"] == issue["currency"]
        assert amount == posting["credit_minor"] > 0


@pytest.mark.parametrize("case", CASE_TYPES)
@pytest.mark.parametrize("seed", [2, 451])
def test_independent_public_evidence_and_reversible_mutations(case, seed):
    episode = generate(seed, GeneratorConfig(cases=(case,)))
    assert [issue["type"] for issue in episode.truth] == list(COMBINATIONS.get(case, (case,)))
    assert_clean_relationships(episode)
    records = by_evidence(episode)
    for issue in episode.truth:
        assert issue["acceptable_evidence_sets"]
        for evidence in issue["acceptable_evidence_sets"]:
            assert_public_proof(episode, issue, evidence, records)
    assert all(any(patch["before"] != patch["after"] for patch in change["patches"])
               for change in episode.provenance["changes"])


@pytest.mark.parametrize(("rows", "documents"), [(200, 20), (201, 100), (2000, 200)])
def test_clean_bounds_and_distractors(rows, documents):
    episode = generate(911, GeneratorConfig(rows=rows, documents=documents, timezone="-07:30"))
    assert_clean_relationships(episode)
    assert not episode.truth and not episode.provenance["changes"]
    assert len(episode.tables["ledger"]) == rows
    assert documents == sum(len(episode.tables[t]) for t in ("invoices", "payments"))
    recurring = defaultdict(list)
    for invoice in episode.tables["invoices"]:
        recurring[invoice["entity_id"], invoice["currency"], invoice["total_minor"]].append(invoice)
    assert any(len(invoices) >= 2 for invoices in recurring.values())
    payments = episode.tables["payments"]
    assert any(p["amount_minor"] < 0 for p in payments)
    assert len({p["invoice_refs"][0]["invoice_id"] for p in payments if p["amount_minor"] > 0}) < 3
    assert all(type(p["amount_minor"]) is int for p in payments)


def test_twelve_issues():
    cases = tuple(ISSUE_TYPES) * 3
    episode = generate(9, GeneratorConfig(cases=cases))
    assert len(episode.truth) == 12
    assert_clean_relationships(episode)
    with pytest.raises(ValueError, match="too many"):
        GeneratorConfig(cases=cases + ("cutoff_error",))


def test_compound_issues_share_the_same_transaction():
    payment = generate(12, GeneratorConfig(cases=("foreign_payment_cutoff",)))
    assert payment.truth[0]["affected_ids"] == payment.truth[1]["affected_ids"]
    assert payment.truth[0]["currency"] == "USD"
    assert payment.truth[1]["currency"] == "KZT"
    duplicate = generate(12, GeneratorConfig(cases=("foreign_duplicate_fx",)))
    assert set(duplicate.truth[1]["affected_ids"]) < set(duplicate.truth[0]["affected_ids"])


REHEARSAL_CASES = (
    ((),) * 5
    + (
        ("foreign_payment_cutoff", "fx_mismatch"),
        ("foreign_duplicate_fx", "unallocated_payment"),
        ("foreign_payment_cutoff", "foreign_duplicate_fx"),
        ("cutoff_error", "foreign_payment_cutoff", "foreign_payment_cutoff"),
        ("foreign_duplicate_fx", "duplicate_invoice", "foreign_payment_cutoff"),
    )
    + (
        ("unallocated_payment", "duplicate_invoice"),
        ("cutoff_error", "duplicate_invoice"),
        ("fx_mismatch", "fx_mismatch"),
        ("unallocated_payment", "unallocated_payment"),
        ("duplicate_invoice", "duplicate_invoice", "cutoff_error"),
        ("cutoff_error", "fx_mismatch", "unallocated_payment"),
        ("unallocated_payment", "cutoff_error") * 3,
        ("fx_mismatch", "duplicate_invoice") * 4,
        ("cutoff_error", "fx_mismatch", "duplicate_invoice") * 3,
        tuple(ISSUE_TYPES) * 3,
    )
)


@pytest.mark.parametrize("index", range(len(REHEARSAL_CASES)))
def test_judge_rehearsal_on_new_configs_and_id_order_pairs(index):
    cases = REHEARSAL_CASES[index]
    offsets = ("+14:00", "-11:00", "+05:45", "-03:30", "+00:00")
    dates = ("2026-12-15", "2028-02-01", "2027-01-31", "2027-04-21")
    config = GeneratorConfig(
        rows=2000 if index == 19 else 200 + index * 89,
        documents=200 if index == 19 else 20 + index * 9,
        first_day=dates[index % len(dates)], timezone=offsets[index % len(offsets)], cases=cases,
    )
    seed = 7919 + index * 1531
    episode = generate(seed, config)
    renamed, _ = permute(episode, seed + 1)
    for variant in (episode, renamed):
        assert_clean_relationships(variant)
        assert len(variant.truth) == sum(len(COMBINATIONS.get(case, (case,))) for case in cases)
        records = by_evidence(variant)
        for issue in variant.truth:
            assert issue["acceptable_evidence_sets"]
            for evidence in issue["acceptable_evidence_sets"]:
                assert_public_proof(variant, issue, evidence, records)
        _, oracle = run_episode(encode_public(variant), variant.truth, OraclePolicy(variant.truth))
        assert (oracle["reward"], oracle["tp"], oracle["fp"], oracle["fn"]) == (1.0, len(variant.truth), 0, 0)

    files = encode_public(episode)
    for policy in (SimpleReconciler(), RandomExplorer(), FlagAllAttack()):
        _, result = run_episode(files, episode.truth, policy)
        assert result["steps"] <= 100 and result["status"] == "submitted"
        if isinstance(policy, SimpleReconciler):
            assert (result["tp"], result["fp"], result["fn"]) == (len(episode.truth), 0, 0)
        elif isinstance(policy, FlagAllAttack):
            assert result["reward"] < 0
