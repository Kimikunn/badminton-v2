FROM node:22-alpine

WORKDIR /app

# Backend dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Backend source
COPY server/src/ ./server/src/

# Frontend build (already built)
COPY client/dist/ ./client/dist/

# Uploads directory
RUN mkdir -p /app/server/uploads /app/server/database

WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/server.js"]
