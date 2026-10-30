FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/n1k0m0/minimail" org.opencontainers.image.licenses="Apache-2.0"

RUN apk add --no-cache openvpn iproute2 iptables su-exec
COPY vpn/start.sh vpn/healthcheck.sh vpn/proxy.mjs vpn/config.mjs /
COPY LICENSE NOTICE /usr/share/licenses/minimail/
RUN chmod 755 /start.sh /healthcheck.sh

EXPOSE 3128
CMD ["/start.sh"]
