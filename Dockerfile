# One image definition for every Node service; docker compose picks a target per service.
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/store/package.json apps/store/
COPY apps/sim/package.json apps/sim/
COPY apps/gatekeeper/package.json apps/gatekeeper/
COPY packages/shared/package.json packages/shared/
COPY packages/sg-cli/package.json packages/sg-cli/
RUN npm ci
COPY . .

FROM base AS store
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @switch-gear/store
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@switch-gear/store"]

FROM base AS sim
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@switch-gear/sim"]

FROM base AS gatekeeper
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "@switch-gear/gatekeeper"]
