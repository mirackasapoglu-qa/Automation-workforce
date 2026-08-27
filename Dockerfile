FROM node:22-alpine

WORKDIR /app

# Install root dependencies
COPY package*.json ./
RUN npm ci

# Install site dependencies
COPY site/package*.json ./site/
WORKDIR /app/site
RUN npm install
WORKDIR /app

# Copy all source files
COPY . .

# Build site
WORKDIR /app/site
RUN npm run build
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PANEL_PORT=3000
ENV LANDING_PORT=4321

EXPOSE 3000

CMD ["node", "scripts/up.mjs"]
