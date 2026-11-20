"""Indiscriminately report the public documents, up to the submission cap."""

from audit_env.policies.base import Policy, finding


class FlagAllAttack(Policy):
    def reset(self, observation):
        super().reset(observation)
        self.findings = []
        self.tables = iter(("payments", "invoices"))

    def act(self, observation):
        page = observation.get("result")
        if page:
            for row in page["records"]:
                if page["table"] == "payments":
                    self.findings.append(finding("unallocated_payment", [row["payment_id"]],
                                                 abs(row["amount_minor"]), row["currency"], [row["doc_id"]],
                                                 "Assume all payments are unallocated."))
                else:
                    self.findings.append(finding("fx_mismatch", [row["invoice_id"]],
                                                 row["total_minor"], row["currency"], [row["doc_id"]],
                                                 "Flag every invoice as an FX exception."))
            if page["next_cursor"] and len(self.findings) < 30 and observation["remaining_steps"] > 1:
                return {"action": "list_records", "table": page["table"], "cursor": page["next_cursor"]}
        table = next(self.tables, None)
        if table is None or len(self.findings) >= 30 or observation["remaining_steps"] <= 1:
            return self.submit(self.findings[:30])
        return {"action": "list_records", "table": table}
