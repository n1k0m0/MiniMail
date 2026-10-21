#!/bin/sh
set -eu

MAIL_IP=192.0.2.10
test -r /vpn/profile.ovpn
test -r /vpn/certs/key.pem
test -r /vpn/key.pass

# Only the unprivileged proxy process is restricted to the tunnel. OpenVPN
# keeps its own network path for the VPN server.
iptables -A OUTPUT -m owner --uid-owner 1000 -o lo -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -o tun0 -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -j REJECT

openvpn --cd /vpn --config /vpn/profile.ovpn --askpass /vpn/key.pass --route-nopull &
vpn_pid=$!

ready=0
for attempt in $(seq 1 120); do
  if ! kill -0 "$vpn_pid" 2>/dev/null; then
    wait "$vpn_pid"
    exit 1
  fi
  if ip -o addr show dev tun0 2>/dev/null | grep -q 'inet '; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo 'OpenVPN tunnel did not become ready' >&2
  exit 1
fi

ip route replace "$MAIL_IP/32" dev tun0
su-exec node node /proxy.mjs &
proxy_pid=$!

# A lost VPN or proxy process must restart the container.
while kill -0 "$vpn_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 5
done
kill "$proxy_pid" 2>/dev/null || true
kill "$vpn_pid" 2>/dev/null || true
exit 1
