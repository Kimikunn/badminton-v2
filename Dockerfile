FROM node:22-alpine

WORKDIR /app

# Backend dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Backend source
COPY server/src/ ./server/src/

# Frontend build (already built)
ARG BUILD_DIR=dist
COPY client/${BUILD_DIR}/ ./client/dist/

# Uploads directory
RUN mkdir -p /app/server/uploads /app/server/database

WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/server.js"]
