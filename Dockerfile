FROM node:24-alpine AS build
WORKDIR /app
ARG VERSION=development
ARG REVISION=0000000000000000000000000000000000000000
ARG BUILD_DATE=unknown
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build
RUN node -e "require('fs').writeFileSync('build-info.json', JSON.stringify({version:process.env.VERSION,revision:process.env.REVISION,builtAt:process.env.BUILD_DATE}))"

FROM build AS test
RUN apk add --no-cache openssl
COPY server ./server
COPY tests ./tests
COPY vpn ./vpn
COPY updater/public-key.pem ./updater/public-key.pem
CMD ["npm", "test"]

FROM node:24-alpine
ARG VERSION=development
ARG REVISION=0000000000000000000000000000000000000000
LABEL org.opencontainers.image.source="https://github.com/n1k0m0/minimail" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      io.minimail.schema="1" io.minimail.read-schema-min="1" io.minimail.read-schema-max="2"
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app
RUN mkdir -p /app/geoip
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-info.json ./build-info.json
COPY server ./server
COPY updater/public-key.pem ./updater/public-key.pem
COPY LICENSE NOTICE ./
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "server/healthcheck.js"]
CMD ["node", "server/index.js"]
