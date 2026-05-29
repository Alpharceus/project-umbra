"""Conductor — Network utilities."""

import socket


def get_local_ip() -> str:
    """Best-effort LAN IP of this machine (the default-route interface)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def list_local_ipv4() -> list[str]:
    """All usable LAN IPv4 addresses (every connected NIC), for join URLs (§3.6).

    Multi-homed machines (e.g. Wi-Fi + a direct Ethernet link) have more than one
    address; the right one depends on how the other device is connected, so we
    surface them all. Loopback and link-local (APIPA 169.254.x) are excluded.
    """
    ips: list[str] = []

    def add(ip: str):
        if (ip and not ip.startswith("127.")
                and not ip.startswith("169.254.") and ip not in ips):
            ips.append(ip)

    try:
        add(get_local_ip())
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            add(ip)
    except Exception:
        pass
    return ips or ["127.0.0.1"]


_WILDCARD = ("0.0.0.0", "::", "")


def join_ips(bind_host: str) -> list[str]:
    """Reachable join IPs given the bind host. If bound to a specific interface,
    that's the only reachable address; if bound to all (0.0.0.0), list every NIC."""
    if bind_host and bind_host not in _WILDCARD:
        return [bind_host]
    return list_local_ipv4()


def self_host(bind_host: str) -> str:
    """The address the host machine should use to reach its own server. When
    bound to a specific IP, localhost isn't listening — use that IP instead."""
    if bind_host and bind_host not in _WILDCARD:
        return bind_host
    return "localhost"
