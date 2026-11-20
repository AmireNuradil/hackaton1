"""The worker-side Gymnasium-style environment, supplied public file contents only."""

import csv
from copy import deepcopy
from dataclasses import dataclass
from time import monotonic

from audit_env.env.calculator import calculate
from audit_env.env.tools import PublicRecords, ToolError
from audit_env.schemas import ISSUE_TYPES, MAX_SECONDS, MAX_STEPS, validate_submission


@dataclass(frozen=True)
class EnvConfig:
    max_steps: int = MAX_STEPS
    max_seconds: int = MAX_SECONDS

    def __post_init__(self):
        if type(self.max_steps) is not int or not 1 <= self.max_steps <= MAX_STEPS:
            raise ValueError("invalid_step_limit")
        if type(self.max_seconds) is not int or not 1 <= self.max_seconds <= MAX_SECONDS:
            raise ValueError("invalid_time_limit")


def _status(name):
    return {"status": name}


class AuditEnv:
    """The seed-bearing reset facade resides outside this process."""

    def __init__(self, public_files, *, clock=monotonic):
        try:
            self._public = PublicRecords(public_files)
        except (ValueError, KeyError, TypeError, AttributeError, OverflowError, RecursionError, csv.Error):
            raise ValueError("invalid_public_episode") from None
        self._clock = clock
        self._active = False

    def reset(self, seed=None, config=None):
        if seed is not None or (config is not None and not isinstance(config, EnvConfig)):
            raise ValueError("invalid_reset")
        self._config = config if config is not None else EnvConfig()
        self._steps = 0
        self.inspection_steps = 0
        self._deadline = self._clock() + self._config.max_seconds
        self._active = True
        return {
            "task": {"description": "Inspect accounting records and submit evidenced discrepancies.",
                     "issue_types": list(ISSUE_TYPES)},
            "manifest": deepcopy(self._public.manifest),
            "policy": deepcopy(self._public.policy),
            "remaining_steps": self._config.max_steps,
        }, _status("ready")

    def _truncate(self):
        self._active = False
        return {"remaining_steps": 0}, 0.0, False, True, _status("truncated")

    def step(self, action):
        if not self._active:
            return {"error": {"code": "episode_inactive"}}, 0.0, False, False, _status("inactive")
        if self._clock() >= self._deadline:
            return self._truncate()
        self._steps += 1
        name = action.get("action") if isinstance(action, dict) else None
        remaining = self._config.max_steps - self._steps
        if name == "submit":
            accepted = action.keys() == {"action", "findings"} and validate_submission(
                action["findings"], self._public.manifest["episode_id"],
            )
            if self._clock() >= self._deadline:
                return self._truncate()
            self._active = False
            return {"remaining_steps": remaining}, (0.0 if accepted else -1.0), True, False, _status("finished")
        self.inspection_steps += 1
        if not remaining:
            return self._truncate()
        observation = {"remaining_steps": remaining}
        try:
            observation["result"] = self._inspect(name, action)
        except ToolError as error:
            observation["error"] = {"code": str(error)}
        if self._clock() >= self._deadline:
            return self._truncate()
        return observation, 0.0, False, False, _status("active")

    def _inspect(self, name, action):
        if name == "list_records" and {"action", "table"} <= action.keys() <= {"action", "table", "cursor", "limit"}:
            return self._public.list_records(action["table"], action.get("cursor"), action.get("limit", 50))
        if name == "get_record" and action.keys() == {"action", "table", "id"}:
            return self._public.get_record(action["table"], action["id"])
        if name == "get_document" and action.keys() == {"action", "doc_id"}:
            return self._public.get_document(action["doc_id"])
        if name == "calculator" and action.keys() == {"action", "expression"}:
            try:
                return {"value": calculate(action["expression"])}
            except ValueError:
                raise ToolError("invalid_expression") from None
        raise ToolError("invalid_action")
