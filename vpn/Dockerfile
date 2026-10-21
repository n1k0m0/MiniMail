FROM node:24-alpine

RUN apk add --no-cache openvpn iproute2 iptables su-exec
COPY start.sh healthcheck.sh proxy.mjs /
RUN chmod 755 /start.sh /healthcheck.sh

EXPOSE 3128
CMD ["/start.sh"]
