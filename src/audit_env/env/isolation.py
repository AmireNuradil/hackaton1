"""Controller/worker transport. The worker enters an empty filesystem before reset."""

import ctypes
import json
import os
import stat
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

from audit_env.env.audit_env import AuditEnv, EnvConfig
from audit_env.schemas import PUBLIC_FILES, json_text

_FILE_LIMIT = 2 * 1024 * 1024
# Thirty 1,000-character explanations can take 360 KB with ASCII JSON escapes.
_ACTION_LIMIT = 1024 * 1024
_WIRE_LIMIT = 64 * 1024 * 1024
_WORKER = (
    "import sys; sys.path.insert(0,sys.argv[1]); "
    "from audit_env.env.isolation import worker_main; worker_main(sys.argv[2], sys.argv[3] == 'drop')"
)


def read_public_files(directory):
    """Open only known, regular, non-symlink files via a read-only directory fd."""
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    files = {}
    try:
        for name in PUBLIC_FILES:
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            with os.fdopen(os.open(name, flags, dir_fd=descriptor), "rb") as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _FILE_LIMIT:
                    raise ValueError("invalid_public_episode")
                value = stream.read(_FILE_LIMIT + 1)
                if len(value) > _FILE_LIMIT:
                    raise ValueError("invalid_public_episode")
                files[name] = value.decode("utf-8")
    finally:
        os.close(descriptor)
    return files


class _CapHeader(ctypes.Structure):
    _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]


class _CapData(ctypes.Structure):
    _fields_ = [("effective", ctypes.c_uint32), ("permitted", ctypes.c_uint32), ("inheritable", ctypes.c_uint32)]


def _enter_jail(directory, drop_user=False):
    if os.listdir(directory):
        raise RuntimeError("isolation_unavailable")
    os.chdir(directory)
    os.chroot(".")
    os.chdir("/")
    if drop_user:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    libc = ctypes.CDLL(None, use_errno=True)
    header = _CapHeader(0x20080522, 0)  # Linux capability API v3, current process.
    capabilities = (_CapData * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(capabilities)) != 0:
        raise RuntimeError("isolation_unavailable")
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise RuntimeError("isolation_unavailable")


def _emit(value):
    sys.stdout.buffer.write(json_text(value).encode("ascii") + b"\n")
    sys.stdout.buffer.flush()


def worker_main(directory, drop_user=False):
    try:
        _enter_jail(directory, drop_user)
        _emit({"ready": True})
        for line in iter(lambda: sys.stdin.buffer.readline(_WIRE_LIMIT + 1), b""):
            if len(line) > _WIRE_LIMIT:
                raise ValueError
            packet = json.loads(line)
            if "public_files" in packet:
                env = AuditEnv(packet["public_files"])
                _emit({"result": env.reset(config=EnvConfig(**packet["config"])), "inspection_steps": 0})
            else:
                _emit({"result": env.step(packet["action"]), "inspection_steps": env.inspection_steps})
    except (Exception, KeyboardInterrupt):
        _emit({"error": "worker_unavailable"})


def _nobody_is_mapped():
    for name in ("uid_map", "gid_map"):
        ranges = Path("/proc/self", name).read_text(encoding="ascii").splitlines()
        if not any(start <= 65534 < start + length
                   for start, _, length in (map(int, row.split()) for row in ranges)):
            return False
    return True


class IsolatedAuditEnv:
    """Public JSON interface. Seed/config provisioning runs in the controller."""

    def __init__(self, public_dir=None, *, public_files=None, limits=None):
        if public_dir is not None and public_files is not None:
            raise ValueError("invalid_reset")
        try:
            self._files = read_public_files(public_dir) if public_dir is not None else public_files
        except (ValueError, OSError):
            raise ValueError("invalid_public_episode") from None
        self.limits = limits if limits is not None else EnvConfig()
        self._process = None
        self._jail = None
        self.inspection_steps = 0

    def _start(self):
        self._jail = tempfile.TemporaryDirectory(prefix="audit-worker-")
        try:
            source = Path(__file__).resolve().parents[2]
            root = os.geteuid() == 0
            user_mode = "drop" if root and _nobody_is_mapped() else "namespace"
            command = [sys.executable, "-I", "-B", "-S", "-c", _WORKER, str(source), self._jail.name, user_mode]
            if not root:
                command[:0] = ["unshare", "-Urn", "--"]
            self._process = subprocess.Popen(command, cwd=self._jail.name, env={"LC_ALL": "C"},
                                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                             stderr=subprocess.DEVNULL, close_fds=True)
            if self._receive().get("ready") is not True:
                raise RuntimeError("worker_unavailable")
        except (OSError, RuntimeError):
            self.close()
            raise RuntimeError("isolation_unavailable") from None

    def _receive(self):
        try:
            line = self._process.stdout.readline(_WIRE_LIMIT + 1)
            message = json.loads(line) if 0 < len(line) <= _WIRE_LIMIT else {}
        except (OSError, ValueError):
            message = {}
        if not isinstance(message, dict) or not ({"ready", "result"} & message.keys()):
            raise RuntimeError("worker_unavailable")
        return message

    def _exchange(self, packet):
        try:
            self._process.stdin.write(packet + b"\n")
            self._process.stdin.flush()
        except OSError:
            raise RuntimeError("worker_unavailable") from None
        result = self._receive()
        self.inspection_steps = result["inspection_steps"]
        return tuple(result["result"])

    def reset(self, seed=None, config=None):
        files, limits = self._files, self.limits
        if files is None:
            from audit_env.generator.world import GeneratorConfig, encode_public, generate

            if type(seed) is not int or (config is not None and not isinstance(config, GeneratorConfig)):
                raise ValueError("invalid_reset")
            files = encode_public(generate(seed, config))
        elif seed is not None or (config is not None and not isinstance(config, EnvConfig)):
            raise ValueError("invalid_reset")
        else:
            limits = config if config is not None else limits
        if self._process is None:
            self._start()
        try:
            return self._exchange(json_text({"public_files": files, "config": asdict(limits)}).encode("ascii"))
        except (RuntimeError, TypeError, ValueError, RecursionError):
            self.close()
            raise ValueError("invalid_public_episode") from None

    def step(self, action):
        if self._process is None:
            return {"error": {"code": "episode_inactive"}}, 0.0, False, False, {"status": "inactive"}
        try:
            payload = json_text({"action": action}).encode("ascii")
        except (TypeError, ValueError, RecursionError):
            payload = b""
        if not payload or len(payload) > _ACTION_LIMIT:
            is_submit = isinstance(action, dict) and action.get("action") == "submit"
            payload = b'{"action":{"action":"submit"}}' if is_submit else b'{"action":null}'
        return self._exchange(payload)

    def close(self):
        if self._process is not None:
            self._process.stdin.close()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()
            self._process.stdout.close()
            self._process = None
        if self._jail is not None:
            self._jail.cleanup()
            self._jail = None

    def __enter__(self):
        return self

    def __exit__(self, *_error):
        self.close()
