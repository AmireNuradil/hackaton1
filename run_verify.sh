#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"

audit_python=${PYTHON:-python3.11}
"$audit_python" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else "Python 3.11 is required.")'
(cd vendor && sha256sum -c SHA256SUMS)

audit_path="$PWD/src"
for audit_wheel in "$PWD"/vendor/*.whl; do
    audit_path="$audit_path:$audit_wheel"
done
export PYTHONPATH="$audit_path"
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONDONTWRITEBYTECODE=1

"$audit_python" -m pytest -q -p no:cacheprovider
exec "$audit_python" -m audit_env.runner verify "$@"
