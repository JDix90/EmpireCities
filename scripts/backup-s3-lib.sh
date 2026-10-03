#!/usr/bin/env bash
# Shared by backup-databases.sh and backup-restore-check.sh: the off-site
# copy in DigitalOcean Spaces, or any S3-compatible store.
#
# Settings, read from .env.production:
#   BACKUP_S3_BUCKET             bucket name, e.g. borderfall-backups (unset = no off-site copy)
#   BACKUP_S3_ENDPOINT           e.g. https://nyc3.digitaloceanspaces.com (the bucket's region)
#   BACKUP_S3_ACCESS_KEY_ID      access key limited to that bucket
#   BACKUP_S3_SECRET_ACCESS_KEY  its secret
#   BACKUP_S3_PREFIX             folder inside the bucket (default: postgres)
#   BACKUP_S3_RETENTION_COUNT    off-site dumps to keep (default: 14)
#
# The AWS CLI runs in a throwaway container, so nothing is installed on the
# host. The image is pinned so a nightly pull cannot change behaviour under
# the job (about 140MB; the deploy's image prune may remove it, and the next
# run pulls it again). The keys reach it through the environment, never on
# the command line, so they do not show up in `ps`.

S3_PREFIX="${BACKUP_S3_PREFIX:-postgres}"
S3_RETENTION="${BACKUP_S3_RETENTION_COUNT:-14}"

# Exit with a clear message unless every setting the off-site copy needs is present.
s3_require_settings() {
  local missing=""
  for var in BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
    if [ -z "${!var:-}" ]; then missing="${missing} ${var}"; fi
  done
  if [ -n "$missing" ]; then
    echo "[s3] FATAL: missing in .env.production:${missing}" >&2
    exit 1
  fi
  if ! [[ "$S3_RETENTION" =~ ^[1-9][0-9]*$ ]]; then
    echo "[s3] FATAL: BACKUP_S3_RETENTION_COUNT must be a whole number of at least 1, not '${S3_RETENTION}'" >&2
    exit 1
  fi
}

# aws_cli <host dir mounted at /backups> <aws arguments...>
# The checksum settings keep newer AWS CLI releases compatible with Spaces,
# which does not accept the checksum headers those releases send by default.
aws_cli() {
  local host_dir="$1"
  shift
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}" \
  docker run --rm \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    -v "${host_dir}:/backups" \
    "${BACKUP_S3_IMAGE:-amazon/aws-cli:2.37.9}" \
    --endpoint-url "${BACKUP_S3_ENDPOINT:-}" "$@"
}

# Off-site dump names, oldest first. Names carry their timestamp, so sorting by
# name sorts by age. Only this script's postgres_YYYYMMDD_HHMMSS.dump files are
# ever listed, so anything else in the bucket is left alone. Empty when the
# listing fails (the CLI prints why) as well as when there are none: `s3 ls`
# exits 1 on an empty folder, so exit codes cannot tell the two apart.
s3_list_dumps() {
  local host_dir="$1"
  aws_cli "$host_dir" s3 ls "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/" \
    | awk '{print $4}' \
    | grep -E '^postgres_[0-9]{8}_[0-9]{6}\.dump$' \
    | sort || true
}
