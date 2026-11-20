"""Reconstruct audit findings from documents, journal entries and public policy."""

from collections import defaultdict
from itertools import combinations

from audit_env.policies.base import Policy, finding
from audit_env.schemas import TABLES, convert_minor, parse_offset, parse_time


class SimpleReconciler(Policy):
    def reset(self, observation):
        super().reset(observation)
        self.manifest = observation["manifest"]
        self.policy = observation["policy"]
        self.tables = {table: [] for table in TABLES}
        self.pending = iter(TABLES)
        self.cursor = None
        self.table = next(self.pending)

    def act(self, observation):
        page = observation.get("result")
        if page and self.table == page["table"]:
            self.tables[self.table].extend(page["records"])
            self.cursor = page["next_cursor"]
            if self.cursor is None:
                self.table = next(self.pending, None)
        if self.table is None or observation["remaining_steps"] <= 1:
            return self.submit(self._reconcile()[:30])
        return {"action": "list_records", "table": self.table, "cursor": self.cursor, "limit": 50}

    def _reconcile(self):
        base = self.manifest["base_currency"]
        zone = parse_offset(self.policy["timezone"])
        start, end = (parse_time(self.policy[key]) for key in ("period_start", "period_end"))
        quotes = {(q["date"], q["source_currency"], q["target_currency"]): q for q in self.tables["fx"]}
        payable, bank = defaultdict(list), defaultdict(list)
        for row in self.tables["ledger"]:
            if row["account"] == "PAYABLE" and row["payment_id"] is None and row["credit_minor"]:
                payable[row["invoice_id"]].append(row)
            if row["account"] == "BANK" and row["payment_id"] is not None and row["credit_minor"]:
                bank[row["payment_id"]].append(row)

        found = []
        groups = defaultdict(list)
        for invoice in self.tables["invoices"]:
            inv_id = invoice["invoice_id"]
            currency = invoice["currency"]
            event = parse_time(invoice["issued_at"])
            groups[invoice["entity_id"], currency, tuple(item["source_ref"] for item in invoice["line_items"])].append(invoice)
            rows = payable[inv_id]
            if currency != base and len(rows) == 1 and rows[0]["currency"] == base:
                quote = quotes.get((event.astimezone(zone).date().isoformat(), currency, base))
                if quote:
                    row = rows[0]
                    expected = convert_minor(invoice["total_minor"], currency, base, quote["rate"])
                    gap = abs(expected - row["credit_minor"])
                    if gap:
                        found.append(finding("fx_mismatch", [inv_id], gap, base,
                                             [invoice["doc_id"], row["row_id"], quote["rate_id"]],
                                             "Payable differs from the document converted at the local event-date quote."))
            found.extend(_cutoff(inv_id, invoice["doc_id"], event, start, end, rows))

        for invoices in groups.values():
            for first, second in combinations(invoices, 2):
                if first["total_minor"] == second["total_minor"] and first["line_items"] == second["line_items"]:
                    found.append(finding("duplicate_invoice", [first["invoice_id"], second["invoice_id"]],
                                         first["total_minor"], first["currency"], [first["doc_id"], second["doc_id"]],
                                         "Supplier document reference and line items were booked twice."))

        for payment in self.tables["payments"]:
            pay_id = payment["payment_id"]
            allocated = sum(ref["allocated_minor"] for ref in payment["invoice_refs"])
            gap = abs(payment["amount_minor"] - allocated)
            if gap:
                found.append(finding("unallocated_payment", [pay_id], gap, payment["currency"], [payment["doc_id"]],
                                     "The signed allocations do not sum to the payment in its original currency."))
            event = parse_time(payment["timestamp"])
            found.extend(_cutoff(pay_id, payment["doc_id"], event, start, end, bank[pay_id]))
        return sorted(found, key=lambda row: (row["type"], row["affected_ids"]))


def _cutoff(identifier, doc_id, event, start, end, postings):
    return [
        finding("cutoff_error", [identifier], row["credit_minor"], row["currency"],
                [doc_id, row["row_id"]], "Source event and recorded posting fall on opposite sides of a period boundary.")
        for row in postings
        if (start <= event < end) != (start <= parse_time(row["timestamp"]) < end)
    ]
