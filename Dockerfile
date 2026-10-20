FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
