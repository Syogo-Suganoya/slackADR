#!/bin/bash

# Render 起動スクリプト: SSH トンネルを確立してからアプリを起動する

# 1. SSH 秘密鍵の準備
# Render の環境変数 SSH_PRIVATE_KEY に鍵の内容を保存している想定
if [ -z "$SSH_PRIVATE_KEY" ]; then
  echo "Error: SSH_PRIVATE_KEY environment variable is not set."
  exit 1
fi

# 鍵ファイルを作成（Render の実行フラットフォームに合わせてパスを設定）
mkdir -p ~/.ssh
echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_rsa_xserver
chmod 600 ~/.ssh/id_rsa_xserver

# 既知のホストチェックをスキップするための設定（または事前にホストキーを登録）
cat <<EOF > ~/.ssh/config
Host xserver-tunnel
    HostName ${SSH_HOST:-sv10242.xserver.jp}
    User ${SSH_USER:-xs236571}
    Port 10022
    IdentityFile ~/.ssh/id_rsa_xserver
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF

# 2. SSH トンネルの起動 (バックグラウンド)
# -L 3307:[DBホスト]:3306
echo "Starting SSH tunnel to XServer MySQL..."
ssh -f -N -L 3307:${DB_HOST_REMOTE:-mysql10025.xserver.jp}:3306 xserver-tunnel

# トンネルが起動するまで少し待機
sleep 3

# 3. アプリケーションの起動
echo "Starting application..."
npm run start
