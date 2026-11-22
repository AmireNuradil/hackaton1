"""Evaluator-side reset/step adapter for blind runs and open training."""

from audit_env.env.isolation import IsolatedAuditEnv
from audit_env.env.tools import PublicRecords
from audit_env.evaluator.reward import evaluate


class EvaluatedAuditEnv:
    """Keep this adapter with the evaluator. Give policies only reset/step results."""

    def __init__(self, public_files, truth, *, training=False, limits=None):
        public = PublicRecords(public_files)
        self._episode_id = public.manifest["episode_id"]
        self._evidence_ids = public.evidence_ids()
        self._tolerance = public.policy["amount_tolerance_minor"]
        self._truth = truth
        self._training = training
        self._env = IsolatedAuditEnv(public_files=public_files, limits=limits)
        self.evaluation = None

    def reset(self, config=None):
        result = self._env.reset(config=config)
        self.evaluation = None
        return result

    def step(self, action):
        observation, validation_reward, terminated, truncated, info = self._env.step(action)
        reward = 0.0
        if terminated or truncated:
            submission = action["findings"] if terminated and validation_reward == 0.0 else None
            self.evaluation = evaluate(
                submission, self._episode_id, self._truth, self._evidence_ids, self._env.inspection_steps,
                truncated=truncated, tolerance_minor=self._tolerance,
            )
            if self._training:
                reward = self.evaluation.reward
        return observation, reward, terminated, truncated, info

    def close(self):
        self._env.close()

    def __enter__(self):
        return self

    def __exit__(self, *_error):
        self.close()
