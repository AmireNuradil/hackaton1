import pytest

from audit_env.env.calculator import calculate
from audit_env.schemas import convert_minor, parse_time, validate_submission


@pytest.mark.parametrize(("expression", "answer"), [
    ("0.1 + 0.2", "0.3"), ("-(3 + .5) * +2", "-7.0"), ("(10-1)/4", "2.25"),
    ("10000000000000000000000000001 - 10000000000000000000000000000", "1"),
])
def test_exact_arithmetic(expression, answer):
    assert calculate(expression) == answer


@pytest.mark.parametrize("expression", [
    "open('secret')", "x", "(1).__class__", "1**2", "1//2", "1/0", "1e4",
    "True", "1 2", "1;2", "1_000", "0x2", "1 # comment", "'1'", "1+\x00", "9" * 300, None,
])
def test_forbidden_expression(expression):
    with pytest.raises(ValueError, match="^invalid_expression$"):
        calculate(expression)


def test_money_exponents_and_ties():
    assert convert_minor(125, "USD", "JPY", "10") == 12
    assert convert_minor(135, "USD", "JPY", "10") == 14
    assert convert_minor(3, "JPY", "KZT", "2.25") == 675
    with pytest.raises(ValueError):
        convert_minor(True, "JPY", "KZT", "1")


def test_aware_timestamp_and_submission():
    assert parse_time("2026-01-02T00:00:00+05:00").utcoffset().total_seconds() == 18000
    with pytest.raises(ValueError):
        parse_time("2026-01-02T00:00:00")
    assert validate_submission({"episode_id": "E", "findings": []}, "E")
    assert not validate_submission({"episode_id": "E", "findings": [], "path": "private"}, "E")
