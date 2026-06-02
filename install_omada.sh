#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
mkdir -p /opt/omada/data /opt/omada/work /opt/omada/logs
docker run -d \
  --name omada-controller \
  --restart unless-stopped \
  --net host \
  -e TZ=Africa/Lagos \
  -v /opt/omada/data:/opt/tplink/EAPController/data \
  -v /opt/omada/work:/opt/tplink/EAPController/work \
  -v /opt/omada/logs:/opt/tplink/EAPController/logs \
  mbentley/omada-controller:latest
