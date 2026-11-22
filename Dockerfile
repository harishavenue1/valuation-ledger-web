# Render (or any Docker host): builds the web page, then runs the Python API + the built page from one small server (scripts/local_server.py).
FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json postcss.config.js tailwind.config.js ./
COPY src ./src
# (no public/ folder any more: its only content was the audio files)
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api ./api
COPY scripts/local_server.py ./scripts/local_server.py
COPY --from=web /app/dist ./dist
ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1
CMD ["python", "scripts/local_server.py"]
