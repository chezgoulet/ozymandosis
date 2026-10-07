# Database backups: pg_dump (custom format, verified), encrypted with age to a
# public key (the private key never touches the server), copied off-site with
# rclone (Linode Object Storage or any S3-compatible store).
FROM postgres:17-alpine
RUN apk add --no-cache age rclone
COPY deploy/backup.sh deploy/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
