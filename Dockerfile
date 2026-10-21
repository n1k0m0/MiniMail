FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
RUN apk add --no-cache openssl ca-certificates curl
WORKDIR /app
RUN mkdir -p /app/geoip && \
    curl -fsSL https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz -o /tmp/dbip-city.mmdb.gz && \
    echo "c839d407f85a1e0bddba354cef16b2c398182d1c34ed8d985555dce134b36b14  /tmp/dbip-city.mmdb.gz" | sha256sum -c - && \
    gunzip -c /tmp/dbip-city.mmdb.gz > /app/geoip/dbip-city-lite.mmdb && \
    rm /tmp/dbip-city.mmdb.gz && apk del curl
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
