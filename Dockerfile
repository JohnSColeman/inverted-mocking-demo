# Multi-stage Dockerfile for Node.js Temporal Application

# Stage 1: Build stage
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript code
RUN npm run build

# Stage 2: Production stage
FROM node:20-slim

# Install runtime dependencies (curl for healthchecks)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 appuser && \
    useradd -r -u 1001 -g appuser appuser

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for ts-node)
RUN npm ci && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy TypeScript source for development (when using volume mounts)
COPY src ./src
COPY tsconfig.json ./

# Install ts-node for development mode
RUN npm install -g ts-node

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose application port (if needed)
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["node", "dist/temporal/main.js"]
