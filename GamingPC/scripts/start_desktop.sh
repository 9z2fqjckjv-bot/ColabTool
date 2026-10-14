#!/bin/bash
# ==============================================================================
# start_desktop.sh - Start Xfce4, Virtual Audio, VNC, noVNC & Tunnel
# ==============================================================================
set -e

CRD_CODE="$1"
CRD_PIN="${2:-123456}"

echo "=================================================="
echo "  🖥️ デスクトップ環境 & リモート接続の起動"
echo "=================================================="

# 1. 仮想オーディオ (PulseAudio) の起動
echo ">> [1/4] 仮想オーディオ (PulseAudio) を初期化中..."
pulseaudio -D --exit-idle-time=-1 2>/dev/null || true
pactl load-module module-null-sink sink_name=VirtualSink sink_properties=device.description=VirtualSink 2>/dev/null || true
pactl set-default-sink VirtualSink 2>/dev/null || true

# 2. Xvfb 仮想ディスプレイ (:1, 1920x1080 24bit) の起動
echo ">> [2/4] Xvfb 仮想ディスプレイ (:1, 1080p) & Xfce4 を起動中..."
export DISPLAY=:1
if ! pgrep -f "Xvfb :1" > /dev/null 2>&1; then
    nohup Xvfb :1 -screen 0 1920x1080x24 +extension GLX +extension RENDER -noreset > /content/xvfb.log 2>&1 &
    sleep 2
fi

if ! pgrep -f "xfce4-session" > /dev/null 2>&1; then
    nohup dbus-launch --exit-with-session startxfce4 > /content/xfce.log 2>&1 &
    sleep 2
fi

# 3. x11vnc & noVNC (Webブラウザ用リモートデスクトップ) の起動
echo ">> [3/4] x11vnc & noVNC サーバーをバックグラウンド起動中..."
pkill -f "x11vnc.*:1" 2>/dev/null || true
nohup x11vnc -display :1 -nopw -listen 0.0.0.0 -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 > /content/x11vnc.log 2>&1 &

pkill -f "websockify.*6080" 2>/dev/null || true
NOVNC_DIR="/usr/share/novnc"
if [ ! -d "$NOVNC_DIR" ]; then
    NOVNC_DIR="/usr/local/share/novnc"
fi
nohup websockify --web="$NOVNC_DIR" 6080 localhost:5901 > /content/novnc.log 2>&1 &
sleep 2

# Cloudflared 高速トンネルの起動 (noVNC を HTTPS で直接アクセス可能にする)
pkill -f "cloudflared tunnel" 2>/dev/null || true
rm -f /content/cloudflared.log
nohup cloudflared tunnel --url http://localhost:6080 > /content/cloudflared.log 2>&1 &

echo "Cloudflare トンネルURLの取得待機中..."
NOVNC_URL=""
for i in {1..20}; do
    NOVNC_URL=$(grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" /content/cloudflared.log 2>/dev/null | head -n 1 || true)
    if [ -n "$NOVNC_URL" ]; then
        break
    fi
    sleep 1
done

# 4. Chrome Remote Desktop (CRD) の設定（コードが指定されている場合）
echo ">> [4/4] リモート接続方式の構成..."
if [ -n "$CRD_CODE" ]; then
    echo "Chrome Remote Desktop を構成中..."
    if ! python3 -c "import dbus" > /dev/null 2>&1; then
        echo "python3-dbus パッケージをインストール & ビルド中..."
        apt-get install -y -qq python3-dbus python3-gi libdbus-1-3 libdbus-1-dev libglib2.0-dev python3-dev pkg-config > /dev/null 2>&1 || true
        python3 -m pip install --ignore-installed --no-cache-dir dbus-python > /dev/null 2>&1 || true
        if which python3.10 >/dev/null 2>&1 && python3.10 -c "import dbus" >/dev/null 2>&1; then
            sed -i '1s|.*|#!/usr/bin/python3.10|' /opt/google/chrome-remote-desktop/chrome-remote-desktop 2>/dev/null || true
        fi
    fi

    # colabuserの存在確認・設定 (CRDはroot実行不可のため)
    if ! id -u colabuser >/dev/null 2>&1; then
        useradd -m -s /bin/bash -G sudo,chrome-remote-desktop colabuser
        echo "colabuser:123456" | chpasswd
        echo "colabuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/colabuser
    fi
    mkdir -p /home/colabuser/.config/chrome-remote-desktop
    echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /home/colabuser/.chrome-remote-desktop-session
    echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /etc/chrome-remote-desktop-session
    chmod +x /home/colabuser/.chrome-remote-desktop-session /etc/chrome-remote-desktop-session
    adduser colabuser chrome-remote-desktop 2>/dev/null || true
    chown -R colabuser:colabuser /home/colabuser

    # コマンド判定（全文コピーか、認証コード単体か）
    if [[ "$CRD_CODE" == *"start-host"* ]]; then
        CMD="$CRD_CODE"
        if [[ "$CMD" != *"--pin="* ]]; then
            CMD="$CMD --pin=$CRD_PIN"
        fi
    else
        CMD="DISPLAY= /opt/google/chrome-remote-desktop/start-host --code=\"$CRD_CODE\" --redirect-url=\"https://remotedesktop.google.com/_/oauthredirect\" --name=\$(hostname) --pin=$CRD_PIN"
    fi

    echo "CRD ホスト起動を実行中 (ユーザー: colabuser)..."
    sudo -u colabuser bash -c "$CMD" > /content/crd_setup.log 2>&1 || true
    sudo -u colabuser /opt/google/chrome-remote-desktop/chrome-remote-desktop --start > /dev/null 2>&1 || true
    echo "✅ Chrome Remote Desktop を構成・起動しました (ログ: /content/crd_setup.log)"
    tail -n 10 /content/crd_setup.log 2>/dev/null || true
fi

echo ""
echo "=================================================="
echo "🎉 デスクトップ環境の起動が完了しました！"
echo "=================================================="
if [ -n "$NOVNC_URL" ]; then
    echo "🌐 【ブラウザ即座アクセス用 URL (noVNC)】:"
    echo "👉  ${NOVNC_URL}/vnc.html?autoconnect=true&resize=scale"
    echo "--------------------------------------------------"
fi
if [ -n "$CRD_CODE" ]; then
    echo "🖥️ 【Chrome Remote Desktop】:"
    echo "👉  https://remotedesktop.google.com/access"
    echo "    (設定PIN: $CRD_PIN)"
    echo "--------------------------------------------------"
fi
echo "✨ 画面解像度: 1920x1080 (Full HD)"
echo "✨ デスクトップ上にChrome(各プロファイル), Steam, Discord, Minecraft, CurseForge等のショートカットが配置されています。"
echo "=================================================="
