FROM node:18-alpine

# Install Python and dependencies
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy package files first
COPY package*.json ./
RUN npm install --production

# Copy Python requirements
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "server.js"]
