#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu server (tested on Ubuntu 22.04/24.04)
#
# Usage:
#   1. SSH into the server as root
#   2. Run: curl -sSL <raw-url-of-this-script> | bash
#      (or copy this script onto the server and run it)
#   3. Add the printed SSH public key as a deploy key on the GitHub repo
#   4. Then run: git clone git@github.com:$GITHUB_USER/$GITHUB_REPO.git /root/$GITHUB_REPO
#   5. Follow the remaining "Next steps" printed at the end
set -euo pipefail

# ── Configure these for your fork ──────────────────────────────────────────
GITHUB_USER="${GITHUB_USER:-npow}"
GITHUB_REPO="${GITHUB_REPO:-deeprecon}"
# ───────────────────────────────────────────────────────────────────────────

SERVER_IP=$(hostname -I | awk '{print $1}')
REPO_DIR="/root/${GITHUB_REPO}"

echo "==> Installing Docker"
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git

echo "==> Creating CLIProxyAPI auth directory"
mkdir -p /root/.cli-proxy-api

echo "==> Generating SSH key"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -C "github-deploy" -f /root/.ssh/id_ed25519 -N ""
  cat /root/.ssh/id_ed25519.pub >> /root/.ssh/authorized_keys
  echo "SSH key generated."
else
  echo "SSH key already exists, skipping."
fi

echo ""
echo "========================================="
echo "  Server setup complete!"
echo "========================================="
echo ""
echo "=== STEP 1: Add this PUBLIC key as a deploy key on the repo ==="
echo "   Go to: github.com/${GITHUB_USER}/${GITHUB_REPO}/settings/keys -> Add deploy key"
echo ""
cat /root/.ssh/id_ed25519.pub
echo ""
echo "=== STEP 2: Clone the repo ==="
echo "   git clone git@github.com:npow/recon.git ${REPO_DIR}"
echo ""
echo "=== STEP 3: Copy OAuth credentials from your local machine ==="
echo "   scp -r ~/.cli-proxy-api/ root@${SERVER_IP}:/root/.cli-proxy-api/"
echo "   scp /opt/homebrew/etc/cliproxyapi.conf root@${SERVER_IP}:${REPO_DIR}/cliproxyapi.conf"
echo ""
echo "=== STEP 4: Set up DNS ==="
echo "   Point your domain to ${SERVER_IP}"
echo ""
echo "=== STEP 5: Create .env (optional, CI writes this from secrets) ==="
echo "   cat > ${REPO_DIR}/.env <<EOF"
echo "   CLIPROXY_API_KEY=your-api-key-1"
echo "   GEMINI_API_KEY=your-gemini-key"
echo "   DOMAIN=deeprecon.app"
echo "   EOF"
echo ""
echo "=== STEP 6: First deploy ==="
echo "   cd ${REPO_DIR} && docker compose up -d --build"
echo ""
echo "=== STEP 7: Add these GitHub repo secrets (Settings > Secrets > Actions) ==="
echo ""
echo "   HETZNER_HOST     = ${SERVER_IP}"
echo "   HETZNER_USER     = root"
echo "   SSH_PRIVATE_KEY   = (the private key below)"
echo "   CLIPROXY_API_KEY  = your-api-key-1"
echo "   GEMINI_API_KEY    = your-gemini-key"
echo "   DOMAIN            = deeprecon.app"
echo ""
echo "--- SSH_PRIVATE_KEY (copy everything including BEGIN/END lines) ---"
cat /root/.ssh/id_ed25519
echo "--- end ---"
echo ""
echo "Once secrets are set, every push to main will: test -> SSH in -> git pull -> docker compose up."
