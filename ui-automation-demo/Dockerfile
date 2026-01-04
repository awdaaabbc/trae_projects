FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build frontend (dist/client) and backend (dist/server)
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Expose port
EXPOSE 3002

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Start the server
CMD ["node", "dist/server/index.js"]
