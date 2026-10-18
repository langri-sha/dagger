FROM nginx:1.31-alpine

ENV PORT=8080
ENV RESOLVER=127.0.0.1
ENV UPSTREAM_HOST=upstream.invalid

COPY site.conf.template /etc/nginx/templates/default.conf.template
COPY html /usr/share/nginx/html

EXPOSE 8080
