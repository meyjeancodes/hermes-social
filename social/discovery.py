"""Agent discovery over mDNS/Bonjour — find peers without a directory server.

Handing addresses around by hand does not scale, but a central directory would
undo the point of the peer-to-peer design. mDNS threads that needle: agents
announce themselves on the local network and discover each other automatically,
with no server, no registration and no account.

Advertised as _hermes-a2a._tcp.local. with the agent's address, public key and
display name in the TXT record. Discovery is passive; you still choose who to
talk to, and an announcement proves nothing on its own — the first real message
from a peer is signature-checked like any other, so a machine can advertise any
name it likes and still cannot forge messages from another agent's address.

Scope is the local network by design. Two agents across the internet exchange
addresses out of band and use /a2a/peers, exactly as before.
"""

from __future__ import annotations

import socket
import threading
import time
from typing import Any, Dict, List

try:  # optional dependency — discovery degrades to "off" without it
    from zeroconf import ServiceListener as _Base
except Exception:  # pragma: no cover
    _Base = object

from . import a2a

SERVICE = "_hermes-a2a._tcp.local."

_zc = None            # Zeroconf instance
_browser = None
_info = None          # our own ServiceInfo
_found: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
_error = ""


def _lan_ip() -> str:
    """Best-guess LAN IP. The UDP connect is routing-only; nothing is sent."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def reachable_host(bind_host: str) -> str:
    """The address other agents should actually connect to.

    Advertising the LAN IP while the server is bound to loopback produces a
    discoverable peer that refuses every connection, which is worse than not
    advertising at all. So the advertised host follows the bind: loopback stays
    loopback (same-machine agents only), and a real LAN bind advertises the LAN
    IP.
    """
    if bind_host in ("0.0.0.0", "::", ""):
        return _lan_ip()
    if bind_host in ("127.0.0.1", "localhost", "::1"):
        return "127.0.0.1"
    return bind_host


class _Listener(_Base):
    def _update(self, zc, type_, name: str) -> None:
        try:
            info = zc.get_service_info(type_, name, timeout=2000)
        except Exception:
            return
        if not info:
            return
        txt = {
            k.decode(): (v or b"").decode(errors="replace")
            for k, v in (info.properties or {}).items()
        }
        addr = txt.get("addr", "")
        if not addr or addr == a2a.address():
            return  # ignore ourselves
        host = ""
        if info.parsed_addresses():
            host = info.parsed_addresses()[0]
        with _lock:
            _found[addr] = {
                "address": addr,
                "name": txt.get("name", "") or name.split(".")[0],
                "public_key": txt.get("pk", ""),
                "url": f"http://{host}:{info.port}" if host else "",
                "scope": txt.get("scope", "lan"),
                "seen": time.time(),
            }

    # zeroconf calls these
    def add_service(self, zc, type_, name):
        self._update(zc, type_, name)

    def update_service(self, zc, type_, name):
        self._update(zc, type_, name)

    def remove_service(self, zc, type_, name):
        with _lock:
            for k, v in list(_found.items()):
                if v.get("_svc") == name:
                    _found.pop(k, None)


def start(port: int = 8731, bind_host: str = "127.0.0.1") -> Dict[str, Any]:
    """Advertise this agent and start browsing for others."""
    global _zc, _browser, _info, _error
    if _zc is not None:
        return {"ok": True, "already": True}
    try:
        from zeroconf import ServiceBrowser, ServiceInfo, Zeroconf
    except Exception as e:
        _error = f"zeroconf not available: {e}"
        return {"ok": False, "error": _error}
    try:
        me = a2a.identity()
        ip = reachable_host(bind_host)
        loopback = ip == "127.0.0.1"
        # Service name must be unique on the network; the address suffix does it.
        safe = me["address"].replace("_", "-")
        _info = ServiceInfo(
            SERVICE,
            f"{safe}.{SERVICE}",
            addresses=[socket.inet_aton(ip)],
            port=port,
            properties={
                "addr": me["address"],
                "pk": me["public_key"],
                "name": me["name"],
                # Tells other agents whether this announcement is reachable from
                # another machine, or only from this one.
                "scope": "loopback" if loopback else "lan",
            },
            server=f"{safe}.local.",
        )
        _zc = Zeroconf()
        _zc.register_service(_info, allow_name_change=True)
        _browser = ServiceBrowser(_zc, SERVICE, _Listener())
        _error = ""
        return {"ok": True, "advertising": me["address"], "ip": ip, "port": port,
                "scope": "loopback" if loopback else "lan"}
    except Exception as e:
        _error = str(e)
        _zc = None
        return {"ok": False, "error": _error}


def stop() -> Dict[str, Any]:
    global _zc, _browser, _info
    try:
        if _zc and _info:
            _zc.unregister_service(_info)
        if _zc:
            _zc.close()
    except Exception:
        pass
    _zc, _browser, _info = None, None, None
    with _lock:
        _found.clear()
    return {"ok": True}


def peers() -> Dict[str, Any]:
    """Agents seen on the LAN, newest sighting first."""
    known = {p["address"] for p in a2a._read(a2a.PEERS_PATH, [])}
    with _lock:
        items = sorted(_found.values(), key=lambda p: p["seen"], reverse=True)
    for p in items:
        p["known"] = p["address"] in known
    return {
        "ok": True,
        "running": _zc is not None,
        "error": _error,
        "me": a2a.address(),
        "peers": items,
    }


def status() -> Dict[str, Any]:
    return peers()
