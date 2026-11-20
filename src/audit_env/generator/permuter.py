"""Change opaque identifiers and row order while preserving accounting semantics."""

from random import Random

from audit_env.generator.world import Episode
from audit_env.schemas import fx_id

_ID_FIELDS = {"episode_id", "row_id", "entity_id", "invoice_id", "payment_id", "doc_id", "source_ref", "issue_id"}


def _identifiers(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _ID_FIELDS and isinstance(item, str):
                yield item
            else:
                yield from _identifiers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _identifiers(item)


def _substitute(value, mapping):
    if isinstance(value, dict):
        return {key: _substitute(item, mapping) for key, item in value.items()}
    if isinstance(value, list):
        return [_substitute(item, mapping) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value


def permute(episode: Episode, seed: int):
    rng = Random(seed)
    inputs = (episode.manifest, episode.tables, episode.truth, episode.provenance)
    old_ids = sorted({item for value in inputs for item in _identifiers(value)})
    used = set(old_ids)
    mapping = {}
    for old in old_ids:
        while True:
            candidate = f"{old.split('-', 1)[0]}-{rng.getrandbits(96):024x}"
            if candidate not in used:
                break
        used.add(candidate)
        mapping[old] = candidate
    old_episode = episode.manifest["episode_id"]
    for quote in episode.tables["fx"]:
        mapping[fx_id(quote, old_episode)] = fx_id(quote, mapping[old_episode])
    result = Episode(*(_substitute(value, mapping) for value in (
        episode.manifest, episode.policy, episode.tables, episode.truth, episode.provenance,
    )))
    for records in result.tables.values():
        order = list(records)
        rng.shuffle(records)
        if len(records) > 1 and records == order:
            records.append(records.pop(0))
    rng.shuffle(result.truth)
    result.provenance["permutation_seed"] = seed
    return result, mapping
