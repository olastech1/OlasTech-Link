#!/usr/bin/env bash
# Run on the Omada host: sudo bash upgrade-controller.sh 6.3.0.111
set -Eeuo pipefail
version=${1:?Usage: upgrade-controller.sh VERSION}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use an explicit stable version'; exit 1; }
cd /opt/omada
exec 9>/var/lock/olastech-omada-upgrade.lock
flock -n 9 || { echo 'An upgrade is already running'; exit 1; }
backup="/root/omada-backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
old_image=$(docker inspect omada-controller --format '{{.Image}}')
docker inspect omada-controller > "$backup/container.json"
cp docker-compose.yml "$backup/docker-compose.yml"
docker tag "$old_image" "olastech/omada-rollback:$(basename "$backup")"
docker pull "mbentley/omada-controller:$version"
snapshot_ready=false
rollback() {
  trap - ERR
  echo "Upgrade failed. Backup retained at $backup; restoring the previous controller."
  docker compose stop -t 120 omada-controller || true
  if [[ "$snapshot_ready" != true ]]; then
    cp "$backup/docker-compose.yml" docker-compose.yml
    docker compose up -d --pull never omada-controller
    return
  fi
  # Restore to an empty directory so newer database files cannot survive rollback.
  mv data "$backup/failed-upgrade-data"
  tar -xzf "$backup/data.tar.gz" -C /opt/omada
  cp "$backup/docker-compose.yml" docker-compose.yml
  docker compose up -d --pull never omada-controller
}
trap 'rollback; exit 1' ERR
docker compose stop -t 120 omada-controller
tar -czf "$backup/data.tar.gz" data work
# The complete stopped data snapshot includes native voucher records and portal resources.
tar -tzf "$backup/data.tar.gz" >/dev/null
snapshot_ready=true
sed -i "s|image: mbentley/omada-controller:.*|image: mbentley/omada-controller:$version|" docker-compose.yml
docker compose config -q
docker compose up -d omada-controller
for ((attempt=0; attempt<180; attempt++)); do
  status=$(docker inspect omada-controller --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')
  info=$(curl -sk --max-time 5 https://127.0.0.1:8043/api/info || true)
  if [[ "$status" == healthy && "$info" == *"\"controllerVer\":\"$version\""* ]]; then
    trap - ERR
    echo "Omada $version is healthy. Backup: $backup"
    exit 0
  fi
  sleep 5
done
false
