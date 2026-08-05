"""Discovery test: two agents find each other over mDNS, with no shared config.

The point of discovery is that nothing is exchanged by hand, so this test never
passes agent B's URL to agent A. A must learn it from the mDNS announcement and
then successfully deliver a message to it.
"""
import os
import subprocess
import sys
import tempfile
import time

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A_URL = "http://127.0.0.1:8731"
B_PORT = 8744
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
    home = tempfile.mkdtemp(prefix="agent-b-disc-")
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

        # Make sure both are advertising (A may predate this feature).
        requests.post(A_URL + "/a2a/discover", json={}, timeout=10)
        da = requests.get(A_URL + "/a2a/discover", timeout=5).json()
        if not da.get("running"):
            print("discovery not running on A: " + str(da.get("error")))
            return 1
        print("both agents advertising on _hermes-a2a._tcp.local.")

        # A must SEE B without ever being told about it.
        seen = None
        for i in range(40):
            time.sleep(1)
            da = requests.get(A_URL + "/a2a/discover", timeout=5).json()
            seen = next((p for p in da.get("peers", []) if p["address"] == b["address"]), None)
            if seen:
                break
            if i and i % 10 == 0:
                print(f"  … browsing {i}s")
        if not seen:
            print("A never discovered B over mDNS.")
            print("  A sees: " + str([p['address'] for p in da.get('peers', [])]))
            print("  (some networks block multicast; this is environmental)")
            return 1
        print(f"A discovered B via mDNS: {seen['address']} at {seen['url']} ({seen['name']})")
        assert seen["public_key"] == b["public_key"], "advertised key must match B's real key"
        print("advertised public key matches B's real identity ✓")

        # A must not discover itself.
        assert not any(p["address"] == a["address"] for p in da["peers"]), "agent discovered itself"
        print("A does not list itself ✓")

        # Deliver using ONLY the discovered URL — the real proof.
        r = requests.post(A_URL + "/a2a/send", json={
            "to": b["address"], "url": seen["url"],
            "body": "Found you over mDNS — no addresses exchanged by hand."}, timeout=20).json()
        assert r.get("ok"), f"send to discovered peer failed: {r}"
        tb = requests.get(B_URL + "/a2a/threads", timeout=5).json()
        bodies = [m["body"] for t in tb["threads"] for m in t["messages"]]
        assert any("mDNS" in x for x in bodies), "B never received the message"
        print("message delivered using only the discovered address ✓")

        print("\nOK — agents found each other on the LAN and talked, zero manual setup")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
