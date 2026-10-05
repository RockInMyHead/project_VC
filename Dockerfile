FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BOKOBOK_HOST=0.0.0.0 \
    BOKOBOK_DB_PATH=/data/bokobok.db

WORKDIR /app

COPY backend ./backend
COPY db ./db
COPY tests ./tests
COPY *.html *.js *.css ./

RUN addgroup -S bokobok && adduser -S -G bokobok -u 10001 bokobok \
    && mkdir -p /data && chown -R bokobok:bokobok /app /data

USER bokobok
EXPOSE 5188

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5188/api/health', timeout=3)"

CMD ["python", "backend/server.py", "5188"]
