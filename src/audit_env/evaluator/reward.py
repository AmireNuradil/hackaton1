"""Private metric and final reward computation."""

from dataclasses import dataclass
from fractions import Fraction

from audit_env.evaluator.matcher import Match, match
from audit_env.schemas import AMOUNT_TOLERANCE_MINOR, validate_submission


@dataclass(frozen=True)
class Evaluation:
    precision: float
    recall: float
    f1: float
    reward: float
    tp: int
    fp: int
    fn: int
    inspection_steps: int
    status: str


def score(result: Match, inspection_steps, status="submitted"):
    tp, fp, fn = result.tp, result.fp, result.fn
    p = Fraction(tp, tp + fp) if tp + fp else Fraction(0)
    r = Fraction(tp, tp + fn) if tp + fn else Fraction(0)
    f1 = Fraction(2 * tp, 2 * tp + fp + fn) if tp + fp + fn else Fraction(1)
    reward = min(1, max(-1, 2 * f1 - 1 - Fraction(inspection_steps, 500)))
    if status in {"malformed", "truncated"}:
        reward = -1
    return Evaluation(float(p), float(r), float(f1), float(reward), tp, fp, fn, inspection_steps, status)


def evaluate(payload, episode_id, truth, public_evidence_ids, inspection_steps, *,
             truncated=False, tolerance_minor=AMOUNT_TOLERANCE_MINOR):
    if truncated:
        findings, status = [], "truncated"
    elif validate_submission(payload, episode_id):
        findings, status = payload["findings"], "submitted"
    else:
        findings, status = [], "malformed"
    return score(match(findings, truth, public_evidence_ids, tolerance_minor), inspection_steps, status)
