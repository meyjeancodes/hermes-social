"""Two-agent conversation test.

Boots a second social server on another port with its own identity directory,
then has the two agents exchange signed messages for real over HTTP. Also
asserts the security properties actually hold: forged signatures, spoofed
addresses, stale timestamps and replays must all be rejected.
"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import time

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A_URL = "http://127.0.0.1:8731"   # the already-running agent
B_PORT = 8742
B_URL = f"http://127.0.0.1:{B_PORT}"


def wait(url, n=40):
    for _ in range(n):
        try:
            requests.get(url + "/a2a/identity", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def main():
    home = tempfile.mkdtemp(prefix="agent-b-")
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
        print(f"agent A {a['address']}  ({a['name']})")
        print(f"agent B {b['address']}  ({b['name']})")
        assert a["address"] != b["address"], "agents must have distinct identities"

        # A → B
        r = requests.post(A_URL + "/a2a/send", json={
            "to": b["address"], "url": B_URL,
            "body": "Hello from agent A — can you hear me?"}, timeout=15).json()
        assert r.get("ok"), f"A→B send failed: {r}"
        thread = r["thread"]
        print(f"A→B sent, thread {thread}")

        # B sees it, and it is marked unread
        tb = requests.get(B_URL + "/a2a/threads", timeout=5).json()
        assert tb["unread"] == 1, f"B should have 1 unread, got {tb['unread']}"
        got = tb["threads"][0]["messages"][0]
        assert got["body"] == "Hello from agent A — can you hear me?"
        assert got["from"] == a["address"]
        print(f"B received: {got['body']!r} from {got['from']}")

        # B replies in the same thread. B learned A's URL from the signed
        # reply_to, so this must work without adding a peer by hand.
        r2 = requests.post(B_URL + "/a2a/send", json={
            "to": a["address"], "thread": thread,
            "body": "Loud and clear, A. B here."}, timeout=15).json()
        assert r2.get("ok"), f"B→A reply failed (auto-peer broken?): {r2}"
        print("B→A replied using auto-learned peer URL")

        ta = requests.get(A_URL + "/a2a/threads", timeout=5).json()
        conv = next(t for t in ta["threads"] if t["thread"] == thread)
        assert len(conv["messages"]) == 2, f"A should see both messages, got {len(conv['messages'])}"
        assert [m["dir"] for m in conv["messages"]] == ["out", "in"]
        print(f"A's thread has {len(conv['messages'])} messages in order: "
              + " → ".join(m["body"][:22] for m in conv["messages"]))

        # mark-read clears the badge
        requests.post(B_URL + "/a2a/read", json={"thread": thread}, timeout=5)
        assert requests.get(B_URL + "/a2a/threads", timeout=5).json()["unread"] == 0
        print("mark-read cleared B's unread count")

        # ── security properties ──────────────────────────────────────────────
        good = requests.post(A_URL + "/a2a/send", json={
            "to": b["address"], "url": B_URL, "body": "baseline"}, timeout=15).json()
        assert good.get("ok")

        sys.path.insert(0, REPO)
        from social import a2a as mod
        base = mod.new_message(b["address"], "tampered probe")

        def rejects(label, msg):
            resp = requests.post(B_URL + "/a2a/inbox", json=msg, timeout=5).json()
            assert not resp.get("ok"), f"{label} was ACCEPTED — security hole"
            print(f"  rejected {label}: {resp.get('error')}")

        tampered = copy.deepcopy(base); tampered["body"] = "rewritten after signing"
        rejects("tampered body", tampered)

        spoof = copy.deepcopy(base); spoof["from"] = "hx_somebodyelse01"
        rejects("spoofed sender address", spoof)

        stale = mod.new_message(b["address"], "stale"); stale["ts"] = time.time() - 9999
        stale = mod.sign_message({k: v for k, v in stale.items() if k != "sig"})
        rejects("stale timestamp", stale)

        nosig = copy.deepcopy(base); nosig.pop("sig", None)
        rejects("missing signature", nosig)

        # replay: same id twice must not duplicate
        replay = mod.new_message(b["address"], "replay me")
        requests.post(B_URL + "/a2a/inbox", json=replay, timeout=5)
        second = requests.post(B_URL + "/a2a/inbox", json=replay, timeout=5).json()
        assert second.get("duplicate"), f"replay not deduped: {second}"
        print("  deduped replayed message")

        # honest message still gets through after all that
        fine = mod.new_message(b["address"], "still working")
        assert requests.post(B_URL + "/a2a/inbox", json=fine, timeout=5).json().get("ok")
        print("  valid message still accepted")

        print("\nOK — two agents held a signed conversation and all forgeries were rejected")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
