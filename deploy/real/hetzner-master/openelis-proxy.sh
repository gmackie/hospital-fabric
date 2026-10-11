#!/bin/sh
set -eu
resolver=$(awk '/^nameserver / {print $2; exit}' /etc/resolv.conf)
[ -n "$resolver" ]
sed "s/__DNS__/$resolver/" /hf-nginx.conf > /tmp/hf-nginx.conf
exec nginx -c /tmp/hf-nginx.conf -g 'daemon off;'
