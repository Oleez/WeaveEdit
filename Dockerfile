FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:web

FROM node:20-alpine AS runtime
WORKDIR /app

RUN npm install -g serve

COPY --from=build /app/dist/web ./dist/web

EXPOSE 8080

CMD ["sh", "-c", "serve -s dist/web -l ${PORT:-8080}"]
