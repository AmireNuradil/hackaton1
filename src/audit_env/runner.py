"""Offline fixture generation, policy rollout and private evaluation."""

import argparse
import json
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path
from statistics import mean
from time import perf_counter

from audit_env.env.isolation import read_public_files
from audit_env.evaluator.session import EvaluatedAuditEnv
from audit_env.generator.world import CASE_TYPES, GeneratorConfig, generate, write_episode
from audit_env.policies.flag_all_policy import FlagAllAttack
from audit_env.policies.oracle_policy import OraclePolicy
from audit_env.policies.random_policy import RandomExplorer
from audit_env.policies.recon_policy import SimpleReconciler
from audit_env.schemas import TABLES, json_text

SPLITS = ("train", "dev")
POLICIES = (RandomExplorer, SimpleReconciler, FlagAllAttack)
DATASET_VERSION = "1.0.0"
_CASES = ((), *((case,) for case in CASE_TYPES), (),
          ("duplicate_invoice", "unallocated_payment", "fx_mismatch", "cutoff_error"),
          ("foreign_payment_cutoff", "foreign_duplicate_fx", "cutoff_error", "fx_mismatch") * 2)


def episode_configs():
    for split_index, split in enumerate(SPLITS):
        for index, cases in enumerate(_CASES, 1):
            max_dev = split == "dev" and index == 10
            seed = 231701 + split_index * 104729 + index * 37
            config = GeneratorConfig(
                rows=2000 if max_dev else 200 + index * 17 + split_index * 4,
                documents=200 if max_dev else 22 + index * 3 + split_index,
                first_day="2026-11-01" if split == "dev" else "2026-10-01",
                timezone="-07:30" if split == "dev" else "+05:00",
                cases=cases,
            )
            yield split, f"{index:02d}", seed, config


def build_data(data):
    for split, label, seed, config in episode_configs():
        write_episode(generate(seed, config), data / split / "public" / label, data / split / "private" / label)
    (data / "dataset_version.json").write_text(
        json_text({"dataset_version": DATASET_VERSION, "splits": {name: len(_CASES) for name in SPLITS}}) + "\n",
        encoding="utf-8",
    )


def rollout(env, policy):
    initial, _ = env.reset()
    policy.reset(initial)
    episode_id = initial["manifest"]["episode_id"]
    trace = [{"episode_id": episode_id, "step": 0, "action": None, "observation": initial,
              "reward": 0.0, "terminated": False, "truncated": False}]
    observation = initial
    step = 0
    while True:
        step += 1
        action = policy.act(observation)
        observation, public_reward, terminated, truncated, _ = env.step(action)
        trace.append({"episode_id": episode_id, "step": step, "action": action, "observation": observation,
                      "reward": public_reward, "terminated": terminated, "truncated": truncated})
        if terminated or truncated:
            return trace


def run_episode(files, truth, policy):
    started = perf_counter()
    with EvaluatedAuditEnv(files, truth) as env:
        trace = rollout(env, policy)
        result = env.evaluation
    last = trace[-1]
    last["reward"] = result.reward
    metrics = {**asdict(result), "episode_id": last["episode_id"], "policy": type(policy).__name__,
               "steps": last["step"], "seconds": perf_counter() - started}
    return trace, metrics


def read_episode(data, split, label):
    files = read_public_files(data / split / "public" / label)
    truth_path = data / split / "private" / label / "truth.json"
    return files, json.loads(truth_path.read_text(encoding="utf-8"))


def benchmark(data, trajectory_path, judge_log=None):
    if judge_log is not None and data.resolve() in judge_log.resolve().parents:
        raise ValueError("judge log must be outside the generated data tree")
    metrics = []
    with trajectory_path.open("w", encoding="utf-8", newline="\n") as output:
        for split, label, _, _ in episode_configs():
            files, truth = read_episode(data, split, label)
            for policy in (*(new() for new in POLICIES), OraclePolicy(truth)):
                trace, result = run_episode(files, truth, policy)
                metrics.append({"split": split, "label": label, **result})
                if not isinstance(policy, OraclePolicy):
                    for step in trace:
                        output.write(json_text({"split": split, "policy": result["policy"], **step}) + "\n")
    if judge_log is not None:
        judge_log.write_text("".join(json_text(row) + "\n" for row in metrics), encoding="utf-8")
    return metrics


def demo(data):
    for label, description in (("06", "Cross-currency partial allocation at period close"),
                               ("01", "Clean books with split payments and a refund")):
        files, truth = read_episode(data, "dev", label)
        print(f"\nDev {label} • {description}")
        for policy in (*(new() for new in POLICIES), OraclePolicy(truth)):
            trace, result = run_episode(files, truth, policy)
            print("{policy:17}  P {precision:.3f}  R {recall:.3f}  F1 {f1:.3f}  "
                  "return {reward:+.3f}  steps {steps:2}  {seconds:.3f}s".format(**result))
            if isinstance(policy, SimpleReconciler):
                findings = trace[-1]["action"]["findings"]["findings"]
                for finding in findings:
                    print(f"  {finding['type']}  {finding['claimed_amount_minor']} minor {finding['currency']}")
                    print(f"  {finding['explanation']}")
                cited = {key for finding in findings for key in finding["evidence_ids"]}
                if cited:
                    print(f"  Period ends at {trace[0]['observation']['policy']['period_end']}")
                for step in trace[1:-1]:
                    page = step["observation"]["result"]
                    for record in page["records"]:
                        key = record.get("doc_id", record[TABLES[page["table"]]])
                        if key in cited:
                            print(f"  {page['table']} {json_text(record)}")


def summarize(metrics):
    print("split policy               P      R     F1 reward  steps mean_s  max_s  TP  FP  FN")
    for split in SPLITS:
        for policy in (*POLICIES, OraclePolicy):
            rows = [r for r in metrics if r["split"] == split and r["policy"] == policy.__name__]
            p, r, f1, reward, steps, seconds = (
                mean(item[key] for item in rows) for key in ("precision", "recall", "f1", "reward", "steps", "seconds")
            )
            max_s = max(item["seconds"] for item in rows)
            tp, fp, fn = (sum(item[key] for item in rows) for key in ("tp", "fp", "fn"))
            print(f"{split:5} {policy.__name__:17} {p:5.3f}  {r:5.3f}  {f1:5.3f} {reward:6.3f} "
                  f"{steps:6.1f} {seconds:6.3f} {max_s:6.3f} {tp:3d} {fp:3d} {fn:3d}")


def verify(data, judge_log=None):
    with tempfile.TemporaryDirectory(prefix="audit-verify-") as directory:
        fresh = Path(directory)
        build_data(fresh)
        metrics = benchmark(fresh, fresh / "trajectories.jsonl", judge_log)
        expected = {p.relative_to(fresh) for p in fresh.rglob("*") if p.is_file()}
        actual = {p.relative_to(data) for p in data.rglob("*") if p.is_file()}
        if actual != expected:
            raise ValueError("dataset file set differs from generated fixtures")
        for relative in sorted(expected):
            if (data / relative).read_bytes() != (fresh / relative).read_bytes():
                raise ValueError(f"non-reproducible fixture: {relative}")
        for row in metrics:
            if row["policy"] == "OraclePolicy" and (row["f1"] != 1.0 or row["reward"] != 1.0):
                raise ValueError("oracle failed")
            if row["policy"] == "FlagAllAttack" and row["reward"] >= 0.0:
                raise ValueError("flag-all escaped negative reward")
        return metrics


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("generate", "verify", "benchmark", "demo"))
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--trajectories", type=Path, help="Trajectory output (required for standalone benchmarking)")
    parser.add_argument("--judge-log", type=Path, help="Optional private per-episode JSONL diagnostics")
    args = parser.parse_args(argv)
    if args.command == "demo":
        demo(args.data)
        return 0
    if args.command == "generate":
        build_data(args.data)
        metrics = benchmark(args.data, args.data / "trajectories.jsonl", args.judge_log)
    elif args.command == "benchmark":
        if args.trajectories is None:
            parser.error("benchmark requires --trajectories")
        metrics = benchmark(args.data, args.trajectories, args.judge_log)
    else:
        try:
            metrics = verify(args.data, args.judge_log)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 1
        print("Dataset and trajectories reproduced byte for byte.")
    summarize(metrics)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
