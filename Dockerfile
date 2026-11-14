FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Production runtime. Keeps Secure/SameSite=None cookie semantics, hides
# stack traces in logs, and turns on production defaults even when the host
# dashboard does not inject NODE_ENV (the live API previously reported
# env=development). Override at run time only for a deliberate non-prod image.
ENV NODE_ENV=production

EXPOSE 8080/tcp

CMD ["node", "server.js"]