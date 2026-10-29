FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM build AS test
RUN apk add --no-cache openssl
COPY server ./server
COPY tests ./tests
COPY vpn ./vpn
CMD ["npm", "test"]

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app
RUN mkdir -p /app/geoip
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "server/healthcheck.js"]
CMD ["node", "server/index.js"]
