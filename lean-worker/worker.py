#!/usr/bin/env python3
"""
lean-worker: HTTP server wrapping the Lean 4 kernel.

Endpoints:
  GET  /health           → {"status": "ok", "policies_loaded": N}
  POST /verify           → {"result": "proved"|"refuted"|"error", "trace": "...", "latency_us": N}
  POST /compile-policy   → {"success": true|false, "error": "..."}
"""

import json
import os
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

POLICY_ENV_DIR = Path("/app/PolicyEnv")
POLICY_LEAN_DIR = POLICY_ENV_DIR / "PolicyEnv"
ELAN_BIN = "/root/.elan/bin"

# Augment PATH so subprocess can find lake/lean
_env = {**os.environ, "PATH": f"{ELAN_BIN}:{os.environ.get('PATH', '')}"}


def count_policies() -> int:
    """Count compiled policy modules (excludes Basic.lean, the core lib)."""
    if not POLICY_LEAN_DIR.exists():
        return 0
    return len([
        f for f in POLICY_LEAN_DIR.glob("*.lean")
        if f.name != "Basic.lean"
    ])


def run_lean(conjecture: str) -> tuple[str, str, int]:
    """
    Write conjecture to a temp file, elaborate it with `lake env lean`.
    Returns (result, trace, latency_us) where result ∈ {"proved","refuted","error"}.
    """
    start_ns = time.monotonic_ns()
    tmp = tempfile.NamedTemporaryFile(suffix=".lean", dir="/tmp", mode="w", delete=False)
    try:
        tmp.write(conjecture)
        tmp.flush()
        tmp.close()

        proc = subprocess.run(
            ["lake", "env", "lean", tmp.name],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(POLICY_ENV_DIR),
            env=_env,
        )
        latency_us = (time.monotonic_ns() - start_ns) // 1000
        trace = (proc.stdout + proc.stderr).strip()

        if proc.returncode == 0:
            return "proved", trace, latency_us

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
            return "refuted", trace, latency_us

        return "error", trace, latency_us

    finally:
        os.unlink(tmp.name)


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
            result, trace, latency_us = run_lean(conjecture)
        except subprocess.TimeoutExpired:
            self.send_json(200, {
                "result": "error",
                "trace": "lean timed out after 30s",
                "latency_us": 30_000_000,
            })
            return
        except Exception as exc:
            self.send_json(200, {
                "result": "error",
                "trace": str(exc),
                "latency_us": 0,
            })
            return

        self.send_json(200, {
            "result": result,
            "trace": trace,
            "latency_us": latency_us,
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
        policy_file = POLICY_LEAN_DIR / f"{safe_id}.lean"

        policy_file.write_text(lean_code)

        success, output = lake_build()
        if success:
            self.send_json(200, {"success": True, "error": None})
        else:
            # Roll back the bad file so the project remains buildable
            policy_file.unlink(missing_ok=True)
            lake_build()  # rebuild to restore clean state
            self.send_json(200, {"success": False, "error": output})


# ---------------------------------------------------------------------------- main

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 9000))
    server = HTTPServer(("0.0.0.0", port), WorkerHandler)
    print(f"lean-worker listening on :{port}", flush=True)
    server.serve_forever()
