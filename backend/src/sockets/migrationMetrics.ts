/** Lightweight counters for Redis migration observability (scraped via /metrics/json). */

let redisSaveFailures = 0;
let postgresBackupFailures = 0;
let lockAcquisitionFailures = 0;

export function recordRedisSaveFailure(): void {
  redisSaveFailures += 1;
}

export function recordPostgresBackupFailure(): void {
  postgresBackupFailures += 1;
}

export function recordLockFailure(): void {
  lockAcquisitionFailures += 1;
}

export function getMigrationMetrics(): {
  redis_save_failures: number;
  postgres_backup_failures: number;
  lock_acquisition_failures: number;
} {
  return {
    redis_save_failures: redisSaveFailures,
    postgres_backup_failures: postgresBackupFailures,
    lock_acquisition_failures: lockAcquisitionFailures,
  };
}

/** Test-only reset. */
export function resetMigrationMetrics(): void {
  redisSaveFailures = 0;
  postgresBackupFailures = 0;
  lockAcquisitionFailures = 0;
}
