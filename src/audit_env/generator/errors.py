"""Apply transaction-level mutations and retain their reversible provenance."""

from copy import deepcopy
from datetime import timedelta, timezone

from audit_env.schemas import convert_minor, fx_id, parse_time


def prepare_cases(world):
    slots = []
    for case in world.config.cases:
        event = world.at(world.rng.randrange(4, 24))
        currency = "USD" if case in {"fx_mismatch", "foreign_duplicate_fx"} else "KZT"
        if case == "cutoff_error":
            event = (world.end - timedelta(minutes=20)).astimezone(timezone.utc)
        invoice, rows = world.invoice(event=event, currency=currency)
        pair = None
        if case in {"duplicate_invoice", "foreign_duplicate_fx"}:
            pair = world.invoice(event=event + timedelta(hours=1), currency=currency, entity=invoice["entity_id"])
        elif case in {"unallocated_payment", "foreign_payment_cutoff"}:
            cross_currency = case == "foreign_payment_cutoff"
            payment_time = ((world.end - timedelta(minutes=10)).astimezone(timezone.utc)
                            if cross_currency else event + timedelta(days=1))
            if cross_currency:
                rate = world.quote("USD", payment_time)["rate"]
                # Choose a nonzero partial settlement below the KZT invoice face value.
                one_dollar = convert_minor(100, "USD", "KZT", rate)
                # Ensure at least one cent fits even for lower-value invoices.
                amount = max(1, invoice["total_minor"] * 30 // one_dollar)
            else:
                amount = invoice["total_minor"]
            pair = world.payment(invoice, event=payment_time, amount=amount,
                                 currency="USD" if cross_currency else "KZT")
        slots.append((case, (invoice, rows), pair))
    return slots


def _patch(table, row, **changes):
    before = deepcopy(row)
    row.update(deepcopy(changes))
    return {"table": table, "before": before, "after": deepcopy(row)}


def _issue(world, scenario, kind, affected, amount, currency, evidence, patches):
    issue_id = world.new_id("issue")
    world.truth.append({
        "issue_id": issue_id, "type": kind, "affected_ids": sorted(affected),
        "expected_amount_minor": amount, "currency": currency, "acceptable_evidence_sets": evidence,
    })
    world.changes.append({"issue_id": issue_id, "scenario": scenario, "patches": patches})


def _amount_patches(rows, amount):
    result = []
    for row in rows:
        field = "debit_minor" if row["credit_minor"] == 0 else "credit_minor"
        result.append(_patch("ledger", row, **{field: amount}))
    return result


def _duplicate(world, case, original, candidate):
    invoice, _ = original
    copy, copy_rows = candidate
    amount = invoice["total_minor"]
    stamp = parse_time(copy["issued_at"])
    patches = [_patch("invoices", copy, total_minor=amount, line_items=invoice["line_items"])]
    patches += _amount_patches(copy_rows, world.base_amount(amount, copy["currency"], stamp))
    _issue(world, case, "duplicate_invoice", [invoice["invoice_id"], copy["invoice_id"]], amount, copy["currency"],
           [[invoice["doc_id"], copy["doc_id"]]], patches)


def _fx(world, case, pair):
    invoice, rows = pair
    stamp = parse_time(invoice["issued_at"])
    currency = invoice["currency"]
    correct = world.quote(currency, stamp)
    wrong = world.quote(currency, stamp - timedelta(days=1))
    expected = convert_minor(invoice["total_minor"], currency, "KZT", correct["rate"])
    recorded = convert_minor(invoice["total_minor"], currency, "KZT", wrong["rate"])
    patches = _amount_patches(rows, recorded)
    quote_id = fx_id(correct, world.episode_id)
    _issue(world, case, "fx_mismatch", [invoice["invoice_id"]], abs(expected - recorded), "KZT",
           [[invoice["doc_id"], row["row_id"], quote_id] for row in rows], patches)


def _allocation(world, case, pair):
    payment, rows = pair
    amount = payment["amount_minor"]
    allocated = amount // 2 if case == "foreign_payment_cutoff" or world.rng.randrange(2) else 0
    gap = amount - allocated
    refs = [{**ref, "allocated_minor": allocated} for ref in payment["invoice_refs"]] if allocated else []
    patches = [_patch("payments", payment, invoice_refs=refs)]
    payable = rows[0]
    posted = world.base_amount(allocated, payment["currency"], parse_time(payment["timestamp"]))
    patches.append(_patch("ledger", payable, debit_minor=posted, invoice_id=payable["invoice_id"] if allocated else None))
    _issue(world, case, "unallocated_payment", [payment["payment_id"]], gap, payment["currency"],
           [[payment["doc_id"]]], patches)


def _cutoff(world, case, pair):
    document, rows = pair
    id_key = "payment_id" if "payment_id" in document else "invoice_id"
    posted = (world.end + timedelta(minutes=10)).astimezone(timezone.utc).isoformat()
    patches = [_patch("ledger", row, timestamp=posted) for row in rows]
    amount = rows[1]["credit_minor"]
    _issue(world, case, "cutoff_error", [document[id_key]], amount, "KZT",
           [[document["doc_id"], rows[1]["row_id"]]], patches)


def inject(world, slots):
    for case, original, pair in slots:
        if case in {"duplicate_invoice", "foreign_duplicate_fx"}:
            _duplicate(world, case, original, pair)
        if case in {"fx_mismatch", "foreign_duplicate_fx"}:
            _fx(world, case, pair if case == "foreign_duplicate_fx" else original)
        if case in {"unallocated_payment", "foreign_payment_cutoff"}:
            _allocation(world, case, pair)
        if case in {"cutoff_error", "foreign_payment_cutoff"}:
            _cutoff(world, case, pair if case == "foreign_payment_cutoff" else original)
