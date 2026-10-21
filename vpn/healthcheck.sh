#!/bin/sh
set -eu
pgrep -x openvpn >/dev/null
ip -o addr show dev tun0 | grep -q 'inet '
ip route get 192.0.2.10 | grep -q 'dev tun0'
pgrep -f '^node /proxy.mjs$' >/dev/null
