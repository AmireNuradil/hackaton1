"""Evaluator-only reference policy."""

from audit_env.policies.base import Policy, finding


class OraclePolicy(Policy):
    def __init__(self, truth):
        self.truth = truth

    def act(self, observation):
        return self.submit([
            finding(issue["type"], issue["affected_ids"], issue["expected_amount_minor"], issue["currency"],
                    issue["acceptable_evidence_sets"][0], "Reference finding with a sufficient public evidence set.")
            for issue in self.truth
        ])
