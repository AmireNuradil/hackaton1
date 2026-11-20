import json

import pytest

from audit_env.env.isolation import IsolatedAuditEnv
from audit_env.generator.permuter import permute
from audit_env.generator.world import encode_public, generate
from audit_env.policies.flag_all_policy import FlagAllAttack
from audit_env.policies.oracle_policy import OraclePolicy
from audit_env.policies.random_policy import RandomExplorer
from audit_env.policies.recon_policy import SimpleReconciler
from audit_env.runner import episode_configs, run_episode
from audit_env.schemas import TABLES, fx_id, json_text

FIXTURES = tuple(episode_configs())


def public_id(row, table, episode_id):
    return fx_id(row, episode_id) if table == "fx" else row[TABLES[table]]


def findings(trace):
    return trace[-1]["action"]["findings"]["findings"]


def canonical_findings(rows, mapping=None):
    mapping = {} if mapping is None else mapping
    return sorted((row["type"], tuple(sorted(mapping.get(key, key) for key in row["affected_ids"])),
                   row["claimed_amount_minor"], row["currency"],
                   tuple(sorted(mapping.get(key, key) for key in row["evidence_ids"]))) for row in rows)


def stable_metrics(metrics):
    return {key: value for key, value in metrics.items() if key not in {"seconds", "episode_id"}}


@pytest.mark.parametrize(("split", "label", "seed", "config"), FIXTURES,
                         ids=[f"{split}-{label}" for split, label, _, _ in FIXTURES])
def test_twenty_id_and_row_permutation_pairs(split, label, seed, config):
    original = generate(seed, config)
    renamed, mapping = permute(original, seed + 1)
    assert permute(original, seed + 1) == (renamed, mapping)
    assert set(mapping).isdisjoint(mapping.values())
    for table in TABLES:
        before = [public_id(row, table, original.manifest["episode_id"]) for row in original.tables[table]]
        after = [public_id(row, table, renamed.manifest["episode_id"]) for row in renamed.tables[table]]
        translated = [mapping[key] for key in before]
        assert set(after) == set(translated)
        assert after != translated

    for policy in (OraclePolicy, SimpleReconciler):
        original_policy = policy(original.truth) if policy is OraclePolicy else policy()
        renamed_policy = policy(renamed.truth) if policy is OraclePolicy else policy()
        trace_a, grade_a = run_episode(encode_public(original), original.truth, original_policy)
        trace_b, grade_b = run_episode(encode_public(renamed), renamed.truth, renamed_policy)
        assert stable_metrics(grade_a) == stable_metrics(grade_b)
        assert grade_a["f1"] == 1.0
        if policy is OraclePolicy:
            assert canonical_findings(findings(trace_a), mapping) == canonical_findings(findings(trace_b))


def test_regenerated_bytes_and_replayed_actions_are_identical():
    _, _, seed, config = FIXTURES[8]
    first, second = generate(seed, config), generate(seed, config)
    assert encode_public(first) == encode_public(second)
    assert json_text(first.truth) == json_text(second.truth)
    assert json_text(first.provenance) == json_text(second.provenance)
    actions = [
        {"action": "list_records", "table": "payments"},
        {"action": "calculator", "expression": "0.100 + 0.202"},
        {"action": "get_document", "doc_id": "nonexistent"},
        {"action": "submit", "findings": {"episode_id": first.manifest["episode_id"], "findings": []}},
    ]

    def replay(episode):
        with IsolatedAuditEnv(public_files=encode_public(episode)) as env:
            return env.reset(), [env.step(action) for action in actions]

    assert replay(first) == replay(second)
    trace_a, grade_a = run_episode(encode_public(first), first.truth, RandomExplorer(33))
    trace_b, grade_b = run_episode(encode_public(second), second.truth, RandomExplorer(33))
    assert json_text(trace_a) == json_text(trace_b)
    assert stable_metrics(grade_a) == stable_metrics(grade_b)


@pytest.mark.parametrize("index", [0, 2, 9, 19])
def test_public_baselines_and_reward_stay_bounded(index):
    _, _, seed, config = FIXTURES[index]
    episode = generate(seed, config)
    files = encode_public(episode)
    recon, good = run_episode(files, episode.truth, SimpleReconciler())
    flags, bad = run_episode(files, episode.truth, FlagAllAttack())
    assert good["steps"] <= 100 and bad["steps"] <= 100
    assert good["reward"] > 0.9 and bad["reward"] < 0.0
    assert good["tp"] == len(episode.truth) and good["fp"] == 0
    for step in recon + flags:
        public = json_text(step["observation"])
        assert not any(field in public for field in ('"seed"', "provenance", "acceptable_evidence_sets", "expected_amount_minor"))
        assert all(issue["issue_id"] not in public for issue in episode.truth)
        assert json.loads(json_text(step)) == step
