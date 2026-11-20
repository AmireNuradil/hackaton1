from dataclasses import asdict

import pytest

from audit_env.env.audit_env import AuditEnv
from audit_env.env.tools import PublicRecords
from audit_env.evaluator.reward import evaluate
from audit_env.generator.world import GeneratorConfig, encode_public, generate


def finding(issue, **overrides):
    value = {"type": issue["type"], "affected_ids": issue["affected_ids"],
             "claimed_amount_minor": issue["expected_amount_minor"], "currency": issue["currency"],
             "evidence_ids": issue["acceptable_evidence_sets"][0], "explanation": "Public records reconcile."}
    value.update(overrides)
    return value


@pytest.fixture
def broken():
    return generate(52, GeneratorConfig(cases=("fx_mismatch", "unallocated_payment", "duplicate_invoice")))


def payload(episode, findings):
    return {"episode_id": episode.manifest["episode_id"], "findings": findings}


def grade(episode, findings, steps=0, **options):
    public = PublicRecords(encode_public(episode))
    return evaluate(payload(episode, findings), episode.manifest["episode_id"], episode.truth,
                    public.evidence_ids(), steps, **options)


def test_clean_silence_beats_false_positives(broken):
    clean = generate(52)
    assert grade(clean, []).reward == 1.0
    assert grade(clean, []).f1 == 1.0
    assert grade(clean, []).precision == grade(clean, []).recall == 0.0
    assert grade(clean, [finding(broken.truth[0])]).reward == -1.0


def test_evidence_beats_silence(broken):
    assert grade(broken, []).reward == -1.0
    result = grade(broken, [finding(issue) for issue in broken.truth], steps=9)
    assert (result.precision, result.recall, result.f1, result.reward) == (1, 1, 1, .982)


def test_repeat_gets_fp_and_only_one_tp(broken):
    correct = finding(broken.truth[0])
    duplicate = {**correct, "explanation": "Reworded.", "evidence_ids": correct["evidence_ids"][::-1]}
    result = grade(broken, [correct, duplicate])
    assert (result.tp, result.fp, result.fn) == (1, 1, 2)
    assert result.reward < grade(broken, [correct]).reward


def test_affected_ids_are_normalized(broken):
    issue = broken.truth[-1]
    reversed_repeat = issue["affected_ids"][::-1] + issue["affected_ids"][:1]
    assert grade(broken, [finding(issue, affected_ids=reversed_repeat)]).tp == 1


@pytest.mark.parametrize("change", [
    {"currency": "JPY"}, {"currency": "EUR"}, {"affected_ids": ["invented"]},
    {"evidence_ids": ["invented"]}, {"evidence_ids": []}, {"affected_ids": []}, {"claimed_amount_minor": -1},
    {"claimed_amount_minor": 0}, {"type": "cutoff_error"},
])
def test_match_requires_type_currency_affected_ids_amount_and_evidence(broken, change):
    result = grade(broken, [finding(broken.truth[0], **change)])
    assert (result.tp, result.fp, result.fn, result.reward) == (0, 1, 3, -1)


def test_complete_alternative_and_existing_ids_only(broken):
    issue = broken.truth[0]
    second = issue["acceptable_evidence_sets"][1]
    assert grade(broken, [finding(issue, evidence_ids=second)]).tp == 1
    assert grade(broken, [finding(issue, evidence_ids=second[:-1])]).tp == 0
    assert grade(broken, [finding(issue, evidence_ids=second + ["invented"])]).tp == 0


def test_exact_minor_tolerance_and_integer_types(broken):
    issue = broken.truth[0]
    amount = issue["expected_amount_minor"]
    assert grade(broken, [finding(issue, claimed_amount_minor=amount + 1)]).tp == 0
    assert grade(broken, [finding(issue, claimed_amount_minor=amount + 1)], tolerance_minor=1).tp == 1
    for bad in (True, str(amount), float(amount)):
        assert grade(broken, [finding(issue, claimed_amount_minor=bad)]).status == "malformed"


@pytest.mark.parametrize("clean", [False, True])
def test_timeout_discards_findings_and_cannot_earn_reward(broken, clean):
    episode = generate(22) if clean else broken
    result = grade(episode, [finding(issue) for issue in episode.truth], 100, truncated=True)
    assert result.status == "truncated" and result.tp == 0 and result.reward == -1.0
    assert result.fn == len(episode.truth)


@pytest.mark.parametrize(("field", "value"), [
    ("explanation", "a" * 1001), ("evidence_ids", ["id"] * 11), ("currency", "ZZ"), ("affected_ids", "inv"),
])
def test_malformed_field_gets_immediate_penalty_and_judge_diagnostic(broken, field, value):
    attempted = [finding(broken.truth[0], **{field: value})]
    env = AuditEnv(encode_public(broken))
    env.reset()
    assert env.step({"action": "submit", "findings": payload(broken, attempted)})[1:4] == (-1, True, False)
    result = grade(broken, attempted)
    assert result.reward == -1 and asdict(result)["status"] == "malformed"


def test_finding_count_limit(broken):
    result = grade(broken, [finding(broken.truth[0])] * 31)
    assert result.status == "malformed" and result.reward == -1


def test_matching_is_maximum_cardinality_not_greedy(broken):
    issue = broken.truth[0]
    a, b = issue["acceptable_evidence_sets"]
    truth = [{**issue, "acceptable_evidence_sets": [a, b]}, {**issue, "acceptable_evidence_sets": [a]}]
    findings = [finding(issue, evidence_ids=a), finding(issue, evidence_ids=b)]
    result = evaluate(payload(broken, findings), broken.manifest["episode_id"], truth, set(a + b), 0)
    assert (result.tp, result.fp, result.fn) == (2, 0, 0)
