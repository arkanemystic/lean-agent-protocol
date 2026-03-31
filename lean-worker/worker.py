#!/usr/bin/env python3
"""
lean-worker: HTTP server wrapping the Lean 4 kernel.

Endpoints:
  GET  /health           → {"status": "ok", "policies_loaded": N}
  GET  /modules          → {"modules": ["PolicyEnv.Basic", ...]}
  POST /verify           → {"result": "proved"|"refuted"|"error", "trace": "...", "latency_us": N}
  POST /compile-policy   → {"success": true|false, "error": "...", "module_name": "..."}
"""

import json
import os
import re
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

POLICY_ENV_DIR  = Path("/app/PolicyEnv")
POLICY_LEAN_DIR = POLICY_ENV_DIR / "PolicyEnv"
ROOT_MODULE_FILE = POLICY_ENV_DIR / "PolicyEnv.lean"
ELAN_BIN = "/root/.elan/bin"

# Augment PATH so subprocess can find lake/lean
_env = {**os.environ, "PATH": f"{ELAN_BIN}:{os.environ.get('PATH', '')}"}

LAKE_BUILD_DIR = POLICY_ENV_DIR / ".lake" / "build" / "lib" / "lean"



def _build_lean_env() -> dict:
    if LAKE_BUILD_DIR.exists():
        existing = _env.get("LEAN_PATH", "")
        lean_path = f"{LAKE_BUILD_DIR}:{existing}" if existing else str(LAKE_BUILD_DIR)
        return {**_env, "LEAN_PATH": lean_path}
    return _env


_lean_env_cache: dict = {}


def _refresh_lean_env() -> None:
    global _lean_env_cache
    _lean_env_cache = _build_lean_env()


_refresh_lean_env()  # populate at import time

PROFILER_OPTIONS = "set_option profiler true\nset_option profiler.threshold 0\n"


def count_policies() -> int:
    """Count compiled policy modules (excludes Basic.lean, the core lib)."""
    if not POLICY_LEAN_DIR.exists():
        return 0
    return len([
        f for f in POLICY_LEAN_DIR.glob("*.lean")
        if f.name != "Basic.lean"
    ])


def get_imported_modules() -> list[str]:
    """
    Parse PolicyEnv.lean and return all 'import X' module names.
    e.g. ["PolicyEnv.Basic", "PolicyEnv.CAP001", ...]
    """
    if not ROOT_MODULE_FILE.exists():
        return []
    modules = []
    for line in ROOT_MODULE_FILE.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("import "):
            module = stripped[len("import "):].strip()
            if module:
                modules.append(module)
    return modules


def _inject_profiler(conjecture: str) -> str:
    """
    Insert profiler set_option lines AFTER all import statements.

    Lean 4 requires `import` to be the very first commands in a file —
    no `set_option` may precede them.
    """
    lines = conjecture.split("\n")
    last_import_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("import "):
            last_import_idx = i
        elif stripped and not stripped.startswith("--") and not stripped.startswith("/-"):
            # First non-import, non-comment, non-blank line — stop scanning
            break

    if last_import_idx >= 0:
        # Insert profiler options right after the last import line
        before = lines[: last_import_idx + 1]
        after = lines[last_import_idx + 1 :]
        return "\n".join(before) + "\n" + PROFILER_OPTIONS + "\n".join(after)
    else:
        # No imports found — safe to prepend
        return PROFILER_OPTIONS + conjecture


def _parse_elab_us(trace: str) -> int | None:
    """
    Parse elaboration time from Lean profiler output.
    Looks for 'elaboration took X.XXms' in the cumulative section.
    """
    # Match "elaboration took 1.17ms" style lines
    matches = re.findall(r'elaboration\s+(\d+(?:\.\d+)?)(ms|µs|s)\b', trace)
    if not matches:
        return None
    # Take the last match — cumulative total
    val_str, unit = matches[-1]
    val = float(val_str)
    if unit == 'ms':
        return int(val * 1000)
    if unit == 'µs':
        return int(val)
    return int(val * 1_000_000)


def run_lean(conjecture: str) -> tuple[str, str, int, int | None]:
    """
    Write conjecture to a temp file, elaborate it with direct `lean`.
    Returns (result, trace, latency_us, elab_us) where:
      result   ∈ {"proved","refuted","error"}
      elab_us  is the pure kernel elaboration time parsed from profiler output,
               or None when the profiler line is absent.
    """
    instrumented = _inject_profiler(conjecture)
    start_ns = time.monotonic_ns()

    with tempfile.NamedTemporaryFile(suffix=".lean", dir="/tmp", mode="w", delete=False) as tmp:
        tmp.write(instrumented)
        tmp_path = tmp.name

    try:
        proc = subprocess.run(
            ["lean", tmp_path],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(POLICY_ENV_DIR),
            env=_lean_env_cache,
        )
        latency_us = (time.monotonic_ns() - start_ns) // 1000
        trace = (proc.stdout + proc.stderr).strip()

        elab_us = _parse_elab_us(trace)

        if proc.returncode == 0:
            return "proved", trace, latency_us, elab_us

        # Distinguish refuted (false proposition) from syntax/import errors.
        # Lean 4's `decide` emits "proved that the proposition … is false"
        # when the proposition is decidably false.
        refuted_markers = [
            "decide tactic failed",
            "native_decide tactic failed",
            "is false",          # decide proved the negation
            "type mismatch",
            "application type mismatch",
        ]
        if any(m in trace for m in refuted_markers):
            return "refuted", trace, latency_us, elab_us

        return "error", trace, latency_us, elab_us

    finally:
        os.unlink(tmp_path)


def lake_build() -> tuple[bool, str]:
    """Run `lake build` in POLICY_ENV_DIR. Returns (success, output)."""
    proc = subprocess.run(
        ["lake", "build"],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(POLICY_ENV_DIR),
        env=_env,
    )
    return proc.returncode == 0, (proc.stdout + proc.stderr).strip()


class WorkerHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # suppress default CLF access log
        pass

    # ------------------------------------------------------------------ helpers

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw)

    # ------------------------------------------------------------------ routes

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {
                "status": "ok",
                "policies_loaded": count_policies(),
            })
        elif self.path == "/modules":
            self.send_json(200, {"modules": get_imported_modules()})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/verify":
            self._handle_verify()
        elif self.path == "/compile-policy":
            self._handle_compile_policy()
        else:
            self.send_json(404, {"error": "not found"})

    def _handle_verify(self) -> None:
        body = self.read_body()
        conjecture = body.get("conjecture", "").strip()
        if not conjecture:
            self.send_json(400, {"error": "missing 'conjecture' field"})
            return

        try:
            result, trace, latency_us, elab_us = run_lean(conjecture)
        except subprocess.TimeoutExpired:
            self.send_json(200, {
                "result": "error",
                "trace": "lean timed out after 30s",
                "latency_us": 30_000_000,
                "elab_us": None,
            })
            return
        except Exception as exc:
            self.send_json(200, {
                "result": "error",
                "trace": str(exc),
                "latency_us": 0,
                "elab_us": None,
            })
            return

        self.send_json(200, {
            "result": result,
            "trace": trace,
            "latency_us": latency_us,
            "elab_us": elab_us,
        })

    def _handle_compile_policy(self) -> None:
        body = self.read_body()
        lean_code = body.get("lean_code", "").strip()
        policy_id = body.get("policy_id", "CUSTOM").strip()

        if not lean_code:
            self.send_json(400, {"error": "missing 'lean_code' field"})
            return

        # Sanitise policy_id to a safe filename (strip hyphens/spaces)
        safe_id = "".join(c for c in policy_id if c.isalnum() or c == "_")
        full_module_name = f"PolicyEnv.{safe_id}"
        policy_file = POLICY_LEAN_DIR / f"{safe_id}.lean"

        # ── Snapshot previous state for atomic rollback ──────────────────────
        prev_policy_exists  = policy_file.exists()
        prev_policy_content = policy_file.read_text() if prev_policy_exists else None
        prev_root_content   = ROOT_MODULE_FILE.read_text() if ROOT_MODULE_FILE.exists() else ""

        # ── Write new policy file ────────────────────────────────────────────
        policy_file.write_text(lean_code)

        # ── Add import to root module file if not already present ────────────
        import_line = f"import {full_module_name}"
        if import_line not in prev_root_content:
            new_root = prev_root_content.rstrip("\n") + f"\n{import_line}\n"
            ROOT_MODULE_FILE.write_text(new_root)

        # ── Build ────────────────────────────────────────────────────────────
        success, output = lake_build()

        if success:
            _refresh_lean_env()  # pick up newly compiled .olean files
            self.send_json(200, {
                "success": True,
                "error": None,
                "module_name": safe_id,
            })
        else:
            # ── Rollback both files, restore clean build state ───────────────
            if prev_policy_content is not None:
                policy_file.write_text(prev_policy_content)
            else:
                policy_file.unlink(missing_ok=True)
            ROOT_MODULE_FILE.write_text(prev_root_content)
            lake_build()  # rebuild to restore clean state
            self.send_json(200, {"success": False, "error": output, "module_name": None})


# ---------------------------------------------------------------------------- main

def _warmup() -> None:
    _refresh_lean_env()
    probes = [
        "import PolicyEnv.Basic\nexample : PolicyEnv.tradeWithinCapital 5000 400000 = true := by decide",
        "import PolicyEnv.Basic\nexample : PolicyEnv.tradeWithinCapital 50000 400000 = true := by decide",
    ]
    for i, probe in enumerate(probes, 1):
        try:
            result, _, latency_us, elab_us = run_lean(probe)
            elab_ms = f"{elab_us/1000:.2f}ms kernel" if elab_us is not None else "no profiler"
            print(
                f"lean-worker: warmup probe {i}/2 → {result} "
                f"({latency_us/1000:.1f}ms wall, {elab_ms})",
                flush=True,
            )
        except Exception as e:
            print(f"lean-worker: warmup probe {i}/2 failed: {e}", flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 9000))
    server = HTTPServer(("0.0.0.0", port), WorkerHandler)
    print(f"lean-worker listening on :{port}", flush=True)
    _warmup()
    server.serve_forever()