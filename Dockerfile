FROM --platform=linux/amd64 node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=linux/amd64 node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Expose port 80 (ALB forwards HTTP here)
EXPOSE 80
# Install curl for health checks
RUN apk add --no-cache curl
COPY --from=build /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
