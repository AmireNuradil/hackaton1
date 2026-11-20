"""Bounded arithmetic. AST names represent original decimal lexemes."""

import ast
import io
import operator
import re
import tokenize
from decimal import Context, Decimal, DecimalException, ROUND_HALF_EVEN, localcontext

_OPERATORS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_SIGNS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_NUMBER = re.compile(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", re.ASCII)


def _decimal_tokens(expression):
    parts = []
    numbers = {}
    for token in tokenize.generate_tokens(io.StringIO(expression).readline):
        if token.type == tokenize.NUMBER and len(token.string) <= 48 and _NUMBER.fullmatch(token.string):
            name = f"n{len(numbers)}"
            numbers[name] = token.string
            parts.append(name)
        elif token.type == tokenize.OP and token.string in {"+", "-", "*", "/", "(", ")"}:
            parts.append(token.string)
        elif token.type not in {tokenize.ENDMARKER, tokenize.NEWLINE, tokenize.NL}:
            raise ValueError
    return ast.parse(" ".join(parts), mode="eval"), numbers


def _evaluate(node, numbers):
    if isinstance(node, ast.Name):
        return Decimal(numbers[node.id])
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SIGNS:
        return _SIGNS[type(node.op)](_evaluate(node.operand, numbers))
    if isinstance(node, ast.BinOp) and type(node.op) in _OPERATORS:
        return _OPERATORS[type(node.op)](_evaluate(node.left, numbers), _evaluate(node.right, numbers))
    raise ValueError


def calculate(expression):
    if not isinstance(expression, str) or len(expression) > 256 or not expression.isascii():
        raise ValueError("invalid_expression")
    try:
        tree, numbers = _decimal_tokens(expression.strip())
        if sum(1 for _ in ast.walk(tree)) > 128:
            raise ValueError
        with localcontext(Context(prec=60, Emax=256, Emin=-256, rounding=ROUND_HALF_EVEN)):
            value = _evaluate(tree.body, numbers)
        return format(value, "f")
    except (ValueError, SyntaxError, DecimalException, tokenize.TokenError, RecursionError):
        raise ValueError("invalid_expression") from None
