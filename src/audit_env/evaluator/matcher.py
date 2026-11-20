"""Maximum one-to-one matching between submissions and private issue records."""

from dataclasses import dataclass

from audit_env.schemas import AMOUNT_TOLERANCE_MINOR, canonical_ids


@dataclass(frozen=True)
class Match:
    pairs: tuple[tuple[int, int], ...]
    false_positives: tuple[int, ...]
    false_negatives: tuple[int, ...]

    @property
    def tp(self):
        return len(self.pairs)

    @property
    def fp(self):
        return len(self.false_positives)

    @property
    def fn(self):
        return len(self.false_negatives)


def match(findings, truth, public_evidence_ids, tolerance_minor=AMOUNT_TOLERANCE_MINOR):
    if type(tolerance_minor) is not int or tolerance_minor < 0:
        raise ValueError("invalid_amount_tolerance")
    graph = []
    seen = set()
    for finding in findings:
        evidence = set(finding["evidence_ids"])
        affected = canonical_ids(finding["affected_ids"])
        key = (finding["type"], affected, finding["currency"], finding["claimed_amount_minor"], frozenset(evidence))
        if key in seen:
            graph.append([])
            continue
        seen.add(key)
        graph.append([
            j for j, issue in enumerate(truth) if (
                finding["type"] == issue["type"] and finding["currency"] == issue["currency"]
                and affected == canonical_ids(issue["affected_ids"])
                and abs(finding["claimed_amount_minor"] - issue["expected_amount_minor"]) <= tolerance_minor
                and evidence <= public_evidence_ids
                and any(bool(options) and set(options) <= evidence for options in issue["acceptable_evidence_sets"])
            )
        ])
    owners = {}

    def augment(i, visited):
        for j in graph[i]:
            if j in visited:
                continue
            visited.add(j)
            if j not in owners or augment(owners[j], visited):
                owners[j] = i
                return True
        return False

    for i in range(len(graph)):
        augment(i, set())
    pairs = tuple(sorted((i, j) for j, i in owners.items()))
    matched = set(owners.values())
    return Match(pairs, tuple(i for i in range(len(findings)) if i not in matched),
                 tuple(j for j in range(len(truth)) if j not in owners))
