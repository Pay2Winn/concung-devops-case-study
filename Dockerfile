FROM scratch AS game
# BuildKit lấy đúng commit; không chạy script từ repo game.
ADD https://github.com/gabrielecirulli/2048.git#478b6ec346e3787f589e4af751378d06ded4cbbc /game

FROM nginx:stable-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311
ARG REVISION=local
LABEL org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.source="https://github.com/Pay2Winn/concung-devops-case-study" \
      io.case-study.game.revision="478b6ec346e3787f589e4af751378d06ded4cbbc"
ENV APP_REVISION=$REVISION APP_ENV=local
COPY --from=game /game/index.html /game/favicon.ico /game/LICENSE.txt /usr/share/nginx/html/
COPY --from=game /game/js/ /usr/share/nginx/html/js/
COPY --from=game /game/style/ /usr/share/nginx/html/style/
COPY --from=game /game/meta/ /usr/share/nginx/html/meta/
COPY nginx.conf /etc/nginx/nginx.conf.template
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-ec"]
CMD ["case \"$APP_ENV:$APP_REVISION\" in :*|*:|*[!a-zA-Z0-9._:-]*) exit 1;; esac; envsubst '${APP_ENV} ${APP_REVISION}' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf; exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
