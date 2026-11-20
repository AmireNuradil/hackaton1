from random import Random

from audit_env.policies.base import Policy
from audit_env.schemas import TABLES


class RandomExplorer(Policy):
    def __init__(self, seed=214):
        self.seed = seed

    def reset(self, observation):
        super().reset(observation)
        self.rng = Random(self.seed)
        self.cursors = {}
        self.inspections = 0

    def act(self, observation):
        if self.inspections >= 8 or observation["remaining_steps"] <= 1:
            return self.submit([])
        result = observation.get("result", {})
        if "next_cursor" in result:
            self.cursors[result["table"]] = result["next_cursor"]
        self.inspections += 1
        table = self.rng.choice((*TABLES, "calculator"))
        if table == "calculator":
            return {"action": table, "expression": f"{self.rng.randrange(100)} / 7"}
        return {"action": "list_records", "table": table,
                "cursor": self.cursors.get(table), "limit": self.rng.randrange(1, 11)}
