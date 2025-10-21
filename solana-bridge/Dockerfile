# AABC Labs Solana Bridge Service - upgraded to Node 22 for Solana Agent Kit compatibility
FROM node:22-alpine

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    linux-headers \
    eudev-dev \
    libusb-dev \
    curl

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with fallback to npm install if ci fails
RUN npm ci --only=production || npm install --only=production

# Copy application code
COPY . .

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the service with entrypoint
CMD ["sh", "entrypoint.sh"]
