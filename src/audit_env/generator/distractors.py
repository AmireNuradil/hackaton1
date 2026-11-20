"""Ordinary transactions that resemble common audit errors."""

from audit_env.generator.world import World


def add_distractors(world: World):
    vendor = world.entities[0]
    amount = world.rng.randrange(20000, 80000)
    recurring_a, _ = world.invoice(event=world.at(2), entity=vendor, amount=amount)
    recurring_b, _ = world.invoice(event=world.at(9), entity=vendor, amount=amount)
    split = amount // 3
    world.payment(recurring_a, event=world.at(4), amount=split)
    world.payment(recurring_a, event=world.at(5), amount=amount - split)
    world.payment(recurring_b, event=world.at(12), amount=amount)
    world.payment(recurring_a, event=world.at(15), amount=-(split // 2))
