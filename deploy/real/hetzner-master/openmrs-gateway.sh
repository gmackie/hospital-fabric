#!/bin/sh
set -eu
# The official gateway hardcodes Docker's DNS (127.0.0.11); Podman supplies its own resolver.
resolver=$(awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf)
[ -n "$resolver" ]
sed -i "s/resolver 127.0.0.11 /resolver $resolver /" /etc/nginx/conf-templates/default.conf.template
exec /usr/local/bin/docker-entrypoint.sh nginx -g 'daemon off;'
