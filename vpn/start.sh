#!/bin/sh
set -eu

test -r /vpn/profile.ovpn
targets=$(node /proxy.mjs --ips)
test -n "$targets"

# Even established proxy sockets may only use the tunnel; the VPN process runs as root.
iptables -A OUTPUT -m owner --uid-owner 1000 -o lo -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -o tun0 -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -j REJECT

set -- --cd /vpn --config /vpn/profile.ovpn --dev tun0 --dev-type tun --route-nopull --script-security 1
if [ -r /vpn/key.pass ]; then set -- "$@" --askpass /vpn/key.pass; fi
openvpn "$@" &
vpn_pid=$!
proxy_pid=
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$proxy_pid" ]; then kill "$proxy_pid" 2>/dev/null || true; fi
  kill "$vpn_pid" 2>/dev/null || true
  wait "$vpn_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' INT TERM
ready=0
for attempt in $(seq 1 120); do
  kill -0 "$vpn_pid" 2>/dev/null || exit 1
  if ip -o addr show dev tun0 2>/dev/null | grep -q 'inet '; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then echo 'OpenVPN tunnel did not become ready' >&2; exit 1; fi
for target in $targets; do ip route replace "$target/32" dev tun0; done
su-exec node node /proxy.mjs &
proxy_pid=$!
while kill -0 "$vpn_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do sleep 5; done
exit 1
