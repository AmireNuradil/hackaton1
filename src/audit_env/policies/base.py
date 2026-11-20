"""A policy receives observations and returns one JSON action at a time."""

from abc import ABC, abstractmethod


class Policy(ABC):
    def reset(self, observation):
        self.episode_id = observation["manifest"]["episode_id"]

    @abstractmethod
    def act(self, observation):
        """Return the next action in the public contract."""

    def submit(self, findings):
        return {"action": "submit", "findings": {"episode_id": self.episode_id, "findings": findings}}


def finding(kind, affected, amount, currency, evidence, explanation):
    return {"type": kind, "affected_ids": sorted(affected), "claimed_amount_minor": amount,
            "currency": currency, "evidence_ids": sorted(evidence), "explanation": explanation}
