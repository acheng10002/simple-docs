# MULTI-STAGE BUILD FOR PRODUCTION-READY CONTAINER
# Stage 1: Builder - installs dependencies and builds native modules
FROM node:20-slim AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (layer caching optimization)
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies for Prisma generation)
RUN npm ci

# Generate Prisma Client (needs to happen before copying app code)
RUN npx prisma generate

# Copy application code
COPY . .

# Stage 2: Production - minimal runtime image
FROM node:20-slim

# Install LibreOffice, Chromium, and required fonts for document conversion
RUN apt-get update && apt-get install -y \
    libnss3 \                                                                        
    libatk-bridge2.0-0 \                                                             
    libdrm2 \                                                                        
    libxkbcommon0 \                                                                  
    libgbm1 \                                                                        
    libasound2 \   
    libreoffice \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu \
    chromium \
    chromium-sandbox \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create non-root user for security with groups needed by Chromium sandbox
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generated client from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy application code
COPY --chown=appuser:appuser . .

# Switch to non-root user
USER appuser

# Expose port (default 3000)
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "src/app.js"]
