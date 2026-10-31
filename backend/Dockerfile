FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
VOLUME /data
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:5001/health || exit 1
USER node
CMD ["node", "src/server.js"]
