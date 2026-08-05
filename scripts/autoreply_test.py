"""Autonomous reply test: agent B answers with a real LLM, unprompted by a human.

Boots agent B with its own identity, enables auto-reply there, sends it a real
question from agent A, and waits for B's Hermes to compose and send back a
signed answer. Also proves the loop guards actually hold, since two auto-replying
agents would otherwise talk forever.
"""
import os
import subprocess
import sys
import tempfile
import time

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A_URL = "http://127.0.0.1:8731"
B_PORT = 8743
B_URL = f"http://127.0.0.1:{B_PORT}"


def wait(url, n=60):
    for _ in range(n):
        try:
            requests.get(url + "/a2a/identity", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def main():
    home = tempfile.mkdtemp(prefix="agent-b-auto-")
    env = {**os.environ, "HOME": home, "SOCIAL_A2A_URL": B_URL}
    proc = subprocess.Popen(
        [sys.executable, "-m", "social", "serve", "--port", str(B_PORT)],
        cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        if not wait(B_URL):
            print("agent B failed to start:\n" + (proc.stdout.read() if proc.stdout else ""))
            return 1
        a = requests.get(A_URL + "/a2a/identity", timeout=5).json()
        b = requests.get(B_URL + "/a2a/identity", timeout=5).json()
        print(f"agent A {a['address']}   agent B {b['address']}")

        # Off by default — that matters, so assert it before enabling.
        assert not requests.get(B_URL + "/a2a/autoreply", timeout=5).json()["config"]["enabled"], \
            "auto-reply must be OFF by default"
        print("auto-reply is off by default ✓")

        # Not on the allowlist yet: B must stay silent.
        requests.post(B_URL + "/a2a/autoreply", json={"enabled": True, "allow_all": False, "allowed": []}, timeout=5)
        r = requests.post(A_URL + "/a2a/send", json={
            "to": b["address"], "url": B_URL, "body": "Are you there?"}, timeout=15).json()
        assert r.get("ok"), r
        time.sleep(2)
        assert len(requests.get(A_URL + "/a2a/threads", timeout=5).json()
                   ["threads"][0]["messages"]) == 1, "B replied despite empty allowlist"
        print("allowlist enforced: no reply to a stranger ✓")

        # Now allow A and ask a real question.
        requests.post(B_URL + "/a2a/autoreply", json={
            "enabled": True, "allowed": [a["address"]], "max_turns": 2,
            "persona": "You are a terse robotics engineer. Answer in one or two sentences."}, timeout=5)

        q = "In one sentence: what's the main advantage of mecanum wheels over standard wheels?"
        r = requests.post(A_URL + "/a2a/send", json={
            "to": b["address"], "url": B_URL, "body": q}, timeout=15).json()
        thread = r["thread"]
        print(f"A asked: {q}")
        print("waiting for B's agent to think (this calls a real model)…")

        reply = None
        for i in range(60):
            time.sleep(3)
            ta = requests.get(A_URL + "/a2a/threads", timeout=5).json()
            conv = next((t for t in ta["threads"] if t["thread"] == thread), None)
            if conv:
                inbound = [m for m in conv["messages"] if m.get("dir") == "in"]
                if inbound:
                    reply = inbound[-1]
                    break
            if i and i % 5 == 0:
                print(f"  … {i*3}s")

        if not reply:
            log = requests.get(B_URL + "/a2a/autoreply", timeout=5).json().get("log", [])
            print("NO REPLY. agent B autoreply log:")
            for ln in log:
                print("   " + ln)
            return 1

        print(f"\nB's agent replied autonomously:\n  {reply['body']}\n")
        assert reply.get("auto"), "reply should be flagged auto"
        assert reply["from"] == b["address"]
        print("reply is signed, flagged auto, and attributed to B ✓")

        # Turn cap: B was set to max_turns=2 and has used 1.
        for n in range(4):
            requests.post(A_URL + "/a2a/send", json={
                "to": b["address"], "url": B_URL, "thread": thread,
                "body": f"follow-up {n}"}, timeout=15)
            time.sleep(1)
        deadline = time.time() + 150
        while time.time() < deadline:
            ta = requests.get(A_URL + "/a2a/threads", timeout=5).json()
            conv = next(t for t in ta["threads"] if t["thread"] == thread)
            autos = [m for m in conv["messages"] if m.get("dir") == "in" and m.get("auto")]
            if len(autos) >= 2:
                break
            time.sleep(3)
        ta = requests.get(A_URL + "/a2a/threads", timeout=5).json()
        conv = next(t for t in ta["threads"] if t["thread"] == thread)
        autos = [m for m in conv["messages"] if m.get("dir") == "in" and m.get("auto")]
        assert len(autos) <= 2, f"turn cap breached: {len(autos)} auto replies for max_turns=2"
        print(f"turn cap held: {len(autos)} auto-replies with max_turns=2 ✓")
        print("\nOK — agent B answered on its own and every loop guard held")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
