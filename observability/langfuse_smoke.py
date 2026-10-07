#!/usr/bin/env python3
"""Langfuse observability smoke test for this repo (stdlib only, Python 3.9+).

What it proves, end to end:
  1. .env has LANGFUSE_* and LLM_* (exit 2 if not -> run the fetch helper, see docs/observability/LANGFUSE.md)
  2. one real LLM call through the LiteLLM gateway (LLM_BASE_URL) succeeds
  3. a trace with that generation + one custom span + one score is ingested into this repo's
     Langfuse project
  4. the trace is READ BACK from the Langfuse API (exit 1 if it never shows up)

Run from the repo root:   python observability/langfuse_smoke.py
Never prints secret values.
"""
import base64, datetime, json, os, subprocess, sys, time, urllib.error, urllib.request, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "rakazo"
REQUIRED = ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LLM_BASE_URL", "LLM_API_KEY"]


def load_env():
    for name in (".env", ".env.local"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.removeprefix("export ").split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def req(method, url, body=None, headers=None, timeout=120):
    h = {"Content-Type": "application/json", "User-Agent": "langfuse-smoke/1.0"}
    h.update(headers or {})
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as f:
            return f.status, json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]
    except Exception as e:  # network error
        return 0, str(e)[:300]


def main():
    load_env()
    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        print("FAIL: missing env vars:", ", ".join(missing))
        print("Fix: python %USERPROFILE%/.langfuse-onboarding/fetch_secrets.py .   (see docs/observability/LANGFUSE.md)")
        return 2
    host = os.environ["LANGFUSE_HOST"].rstrip("/")
    auth = {"Authorization": "Basic " + base64.b64encode(
        (os.environ["LANGFUSE_PUBLIC_KEY"] + ":" + os.environ["LANGFUSE_SECRET_KEY"]).encode()).decode()}
    try:
        sha = subprocess.run(["git", "-C", ROOT, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    except Exception:
        sha = ""
    release = os.environ.get("LANGFUSE_RELEASE") or sha or "unknown"
    env_name = os.environ.get("LANGFUSE_TRACING_ENVIRONMENT", "development")
    model = os.environ.get("LLM_MODEL", "MiniMax-M3")
    trace_id = uuid.uuid4().hex
    session_id = "smoke-" + time.strftime("%Y%m%d")
    tags = ["repo:" + REPO, "smoke-test", "env:" + env_name]

    # 1) real LLM call via the gateway (LiteLLM also auto-traces it, using the same trace id)
    t0, start = time.time(), now()
    messages = [{"role": "user", "content": "Reply with exactly the word: pong"}]
    st, b = req("POST", os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions",
                {"model": model, "max_tokens": 600, "messages": messages,
                 "metadata": {"trace_id": trace_id, "trace_name": "langfuse-smoke", "generation_name": "gateway-" + model,
                              "session_id": session_id, "trace_user_id": "smoke-test", "trace_release": release,
                              "tags": tags, "repo": REPO}},
                {"Authorization": "Bearer " + os.environ["LLM_API_KEY"]}, timeout=180)
    latency = time.time() - t0
    if st != 200 or not isinstance(b, dict):
        print(f"FAIL: LLM gateway call -> HTTP {st}: {b}")
        return 1
    text = (b["choices"][0]["message"].get("content") or "").strip()
    usage = b.get("usage") or {}
    answer = text.split("</think>")[-1].strip()
    llm_ok = bool(answer)
    print(f"LLM ok: model={b.get('model')} latency={latency:.1f}s tokens={usage.get('total_tokens')} reply={answer[:40]!r}")

    # 2) our own trace + generation + custom span + score, straight into this repo's project
    end = now()
    batch = [
        {"id": uuid.uuid4().hex, "timestamp": start, "type": "trace-create", "body": {
            "id": trace_id, "name": "langfuse-smoke", "userId": "smoke-test", "sessionId": session_id,
            "release": release, "environment": env_name, "tags": tags,
            "metadata": {"repo": REPO, "purpose": "first-task observability check"},
            "input": messages, "output": answer}},
        {"id": uuid.uuid4().hex, "timestamp": start, "type": "generation-create", "body": {
            "id": uuid.uuid4().hex, "traceId": trace_id, "name": "smoke-llm-call", "model": model,
            "startTime": start, "endTime": end, "input": messages, "output": text, "environment": env_name,
            "usageDetails": {"input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0)},
            "metadata": {"latency_s": round(latency, 3)}}},
        {"id": uuid.uuid4().hex, "timestamp": end, "type": "span-create", "body": {
            "id": uuid.uuid4().hex, "traceId": trace_id, "name": "custom-step:validate-reply",
            "startTime": end, "endTime": now(), "environment": env_name,
            "input": {"reply": answer[:200]}, "output": {"non_empty": llm_ok}}},
        {"id": uuid.uuid4().hex, "timestamp": now(), "type": "score-create", "body": {
            "id": uuid.uuid4().hex, "traceId": trace_id, "name": "smoke_ok", "value": 1 if llm_ok else 0,
            "dataType": "NUMERIC", "environment": env_name, "comment": "reply non-empty"}},
    ]
    st, b = req("POST", host + "/api/public/ingestion", {"batch": batch}, auth)
    errs = b.get("errors") if isinstance(b, dict) else b
    if st not in (200, 207) or errs:
        print(f"FAIL: Langfuse ingestion -> HTTP {st}: {errs}")
        return 1

    # 3) read it back
    for _ in range(30):
        time.sleep(4)
        st, t = req("GET", f"{host}/api/public/traces/{trace_id}", headers=auth)
        if st == 200 and isinstance(t, dict) and len(t.get("observations", [])) >= 2 and t.get("scores"):
            obs = t["observations"]
            names = sorted({o.get("name") or "" for o in obs})
            gateway = any((o.get("name") or "").startswith("gateway-") or o.get("name") == "litellm-acompletion" for o in obs) or len(obs) > 2
            pid = os.environ.get("LANGFUSE_PROJECT_ID", "<project-id>")
            print(f"Langfuse ok: trace={trace_id} observations={len(obs)} {names} scores={[s.get('name') for s in t['scores']]}")
            print(f"Gateway auto-trace into this project (LiteLLM key-level logging): {'yes' if gateway else 'not seen'}")
            print(f"View: {host}/project/{pid}/traces/{trace_id}")
            print("PASS" if llm_ok else "FAIL: empty LLM reply")
            return 0 if llm_ok else 1
    print(f"FAIL: trace {trace_id} not readable from {host} after 120s (last HTTP {st})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
