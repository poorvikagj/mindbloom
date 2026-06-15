FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY app.js ./
COPY config ./config
COPY public ./public
COPY scripts ./scripts
COPY utils ./utils
COPY views ./views

# Create uploads directory with proper permissions
RUN mkdir -p /app/public/uploads/courses

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 5000

CMD ["node", "app.js"]
