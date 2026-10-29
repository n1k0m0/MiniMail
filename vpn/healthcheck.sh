#!/bin/sh
set -eu
pgrep -x openvpn >/dev/null
ip -o addr show dev tun0 | grep -q 'inet '
for target in $(node /proxy.mjs --ips); do ip route get "$target" | grep -q 'dev tun0'; done
node --input-type=module -e 'import net from "node:net"; const socket=net.connect(3128,"127.0.0.1",()=>{socket.end();});socket.setTimeout(2000,()=>process.exit(1));socket.on("error",()=>process.exit(1));'
