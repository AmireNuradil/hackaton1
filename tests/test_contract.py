import json
import os
import subprocess
import sys

import pytest

from audit_env.env.audit_env import AuditEnv, EnvConfig
from audit_env.env.isolation import IsolatedAuditEnv
from audit_env.generator.world import GeneratorConfig, encode_public, generate, write_episode
from audit_env.schemas import PUBLIC_FILES, TABLES, json_text


@pytest.fixture
def episode():
    return generate(77, GeneratorConfig(cases=("foreign_duplicate_fx", "unallocated_payment")))


@pytest.fixture
def env(episode):
    return AuditEnv(encode_public(episode))


@pytest.fixture
def started(env):
    observation, _ = env.reset()
    return env, observation


def submit(episode_id, findings=None):
    return {"action": "submit", "findings": {"episode_id": episode_id, "findings": [] if findings is None else findings}}


def test_reset_contract(env):
    observation, info = env.reset()
    assert set(observation) == {"task", "manifest", "policy", "remaining_steps"}
    assert observation["remaining_steps"] == 100
    assert info == {"status": "ready"}
    assert json.loads(json_text(observation)) == observation


def test_reset_starts_new_state(started):
    env, before = started
    env.step({"action": "calculator", "expression": "2+2"})
    env.step(submit(before["manifest"]["episode_id"]))
    assert env.reset()[0] == before
    assert env.inspection_steps == 0


def test_mutating_returned_data_does_not_change_episode(started):
    env, initial = started
    initial["manifest"]["counts"]["ledger"] = 0
    action = {"action": "list_records", "table": "invoices", "limit": 1}
    a = env.step(action)[0]["result"]
    a["records"][0]["line_items"].clear()
    assert env.step(action)[0]["result"]["records"][0]["line_items"]
    assert env.reset()[0]["manifest"]["counts"]["ledger"] == 240


def test_stable_pagination_obeys_source_order(started, episode):
    env, _ = started
    cursor = None
    rows = []
    while True:
        action = {"action": "list_records", "table": "ledger", "cursor": cursor, "limit": 50}
        observation, reward, terminated, truncated, info = env.step(action)
        assert (reward, terminated, truncated, info) == (0.0, False, False, {"status": "active"})
        result = observation["result"]
        assert len(result["records"]) <= 50
        rows.extend(result["records"])
        cursor = result["next_cursor"]
        if cursor is None:
            break
    assert rows == episode.tables["ledger"]


@pytest.mark.parametrize(("action", "code"), [
    ({"action": "list_records", "table": "ledger", "limit": 51}, "invalid_limit"),
    ({"action": "list_records", "table": "ledger", "limit": True}, "invalid_limit"),
    ({"action": "list_records", "table": "ledger", "cursor": "invoices:1"}, "invalid_cursor"),
    ({"action": "list_records", "table": "ledger", "cursor": "ledger:240"}, "invalid_cursor"),
    ({"action": "list_records", "table": "ledger", "cursor": "ledger:01"}, "invalid_cursor"),
    ({"action": "list_records", "table": "../truth.json"}, "unknown_table"),
    ({"action": "get_record", "table": "ledger", "id": "does-not-exist"}, "unknown_id"),
    ({"action": "get_document", "doc_id": "../../provenance.json"}, "unknown_id"),
    ({"action": "calculator", "expression": "open('/truth.json')"}, "invalid_expression"),
    ({"action": "list_records", "table": []}, "unknown_table"),
    ({"action": "get_document", "doc_id": []}, "unknown_id"),
    ({"action": "calculator", "expression": "5", "extra": 0}, "invalid_action"),
    ({"action": []}, "invalid_action"),
    (None, "invalid_action"),
])
def test_invalid_action_is_bounded_and_costs_one_step(started, action, code):
    env, _ = started
    assert env.step(action) == (
        {"error": {"code": code}, "remaining_steps": 99}, 0.0, False, False, {"status": "active"},
    )
    assert env.inspection_steps == 1


@pytest.mark.parametrize("table", TABLES)
def test_records_and_evidence_can_be_reopened(started, table):
    env, _ = started
    row = env.step({"action": "list_records", "table": table, "limit": 1})[0]["result"]["records"][0]
    assert env.step({"action": "get_record", "table": table, "id": row[TABLES[table]]})[0]["result"] == row
    if "doc_id" in row:
        assert env.step({"action": "get_document", "doc_id": row["doc_id"]})[0]["result"] == row


def test_csv_null_is_json_null(started):
    env, _ = started
    page = env.step({"action": "list_records", "table": "ledger"})[0]["result"]
    assert any(row["payment_id"] is None for row in page["records"])


def test_calculator_output_is_string(started):
    env, _ = started
    assert env.step({"action": "calculator", "expression": "0.1+0.2"})[0]["result"] == {"value": "0.3"}


def test_submit_at_step_100_terminates_and_stays_done(started):
    env, before = started
    for _ in range(99):
        assert env.step({"action": "calculator", "expression": "0"})[1:4] == (0.0, False, False)
    assert env.step(submit(before["manifest"]["episode_id"])) == (
        {"remaining_steps": 0}, 0.0, True, False, {"status": "finished"},
    )
    assert env.inspection_steps == 99
    assert env.step(None)[0] == {"error": {"code": "episode_inactive"}}


def test_step_100_without_submit_truncates(started):
    env, _ = started
    for _ in range(99):
        env.step(None)
    assert env.step(None) == ({"remaining_steps": 0}, 0.0, False, True, {"status": "truncated"})
    assert env.inspection_steps == 100


def test_clock_boundary_is_exclusive(episode):
    now = [0]
    env = AuditEnv(encode_public(episode), clock=lambda: now[0])
    observation, _ = env.reset(config=EnvConfig(max_seconds=1))
    now[0] = 1
    assert env.step(submit(observation["manifest"]["episode_id"]))[1:4] == (0.0, False, True)
    assert env.inspection_steps == 0


def test_expiration_during_step_discards_output(episode):
    now = iter((0, 0, 1))
    env = AuditEnv(encode_public(episode), clock=lambda: next(now))
    env.reset(config=EnvConfig(max_seconds=1))
    result = env.step({"action": "calculator", "expression": "9"})
    assert result == ({"remaining_steps": 0}, 0.0, False, True, {"status": "truncated"})


@pytest.mark.parametrize("config", [{"max_steps": 101}, {"max_seconds": 61}, {"max_steps": True}])
def test_hard_limits_on_config(config):
    with pytest.raises(ValueError):
        EnvConfig(**config)


@pytest.mark.parametrize("bad", [{"findings": []}, {"episode_id": "wrong", "findings": []}, None])
def test_malformed_submit_terminates_with_minus_one(started, bad):
    env, _ = started
    assert env.step({"action": "submit", "findings": bad})[1:5] == (-1.0, True, False, {"status": "finished"})


def test_rejects_private_fields_and_seed_in_worker(episode, env):
    with pytest.raises(ValueError, match="^invalid_reset$"):
        env.reset(seed=1234)
    files = encode_public(episode)
    files["truth.json"] = "SECRET"
    with pytest.raises(ValueError, match="^invalid_public_episode$"):
        AuditEnv(files)
    del files["truth.json"]
    manifest = json.loads(files["manifest.json"])
    manifest["secret_path"] = "/tmp/SECRET"
    files["manifest.json"] = json_text(manifest)
    with pytest.raises(ValueError, match="^invalid_public_episode$"):
        AuditEnv(files)


def test_process_gets_open_files_and_never_returns_private_fields(tmp_path, episode):
    public, private = tmp_path / "public", tmp_path / "judge-private"
    write_episode(episode, public, private)
    assert {file.name for file in public.iterdir()} == set(PUBLIC_FILES)
    with IsolatedAuditEnv(public) as env:
        initial, info = env.reset()
        action = submit(initial["manifest"]["episode_id"])
        observed = [initial, info]
        for table in TABLES:
            observed.append(env.step({"action": "list_records", "table": table}))
        observed.append(env.step({"action": "get_document", "doc_id": str(private / "truth.json")}))
        observed.append(env.step(action))
        output = json_text(observed)
        for token in ("acceptable_evidence_sets", "expected_amount_minor", "provenance", "judge-private", '"seed"'):
            assert token not in output
        assert all(issue["issue_id"] not in output for issue in episode.truth)
    assert json.loads((private / "truth.json").read_text()) == episode.truth


def test_public_allowlist_rejects_symlink(episode, tmp_path):
    public, private = tmp_path / "public", tmp_path / "private"
    write_episode(episode, public, private)
    (public / "ledger.csv").unlink()
    (public / "ledger.csv").symlink_to(private / "truth.json")
    with pytest.raises(ValueError, match="^invalid_public_episode$"):
        IsolatedAuditEnv(public)


def test_filesystem_boundary_denies_even_direct_open(tmp_path):
    jail = tmp_path / "empty"
    jail.mkdir()
    secret = tmp_path / "truth.json"
    secret.write_text("CANARY")
    code = """
import os, sys
from audit_env.env.isolation import _enter_jail
secret, jail = sys.argv[1:]
assert open(secret).read() == 'CANARY'
_enter_jail(jail)
assert os.listdir('/') == []
for path in (secret, '../truth.json', '/proc/1/root' + secret):
    try:
        open(path)
    except FileNotFoundError:
        pass
    else:
        raise AssertionError('private file reachable')
try:
    os.chroot('/')
except PermissionError:
    pass
else:
    raise AssertionError('chroot capability retained')
"""
    prefix = [] if os.geteuid() == 0 else ["unshare", "-Urn", "--"]
    subprocess.run([*prefix, sys.executable, "-c", code, str(secret), str(jail)],
                   env={**os.environ, "PYTHONPATH": os.path.abspath("src")}, check=True)


def test_controller_seed_is_deterministic_and_supports_reset():
    with IsolatedAuditEnv() as env:
        first = env.reset(seed=17)
        page = env.step({"action": "list_records", "table": "ledger", "limit": 1})
        assert env.reset(seed=17) == first
        assert env.step({"action": "list_records", "table": "ledger", "limit": 1}) == page
        assert env.reset(seed=18)[0]["manifest"]["episode_id"] != first[0]["manifest"]["episode_id"]
