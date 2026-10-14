#!/bin/bash
# ==============================================================================
# setup_environment.sh - Gaming PC on Google Colab (L4 GPU High-Memory) Setup
# ==============================================================================
set -e

export DEBIAN_FRONTEND=noninteractive
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=================================================="
echo "  🎮 Gaming PC 仮想環境 自動セットアップ開始"
echo "  動作環境: Colab L4 GPU (24GB VRAM) / High-RAM"
echo "=================================================="

# 1. 32-bit アーキテクチャの有効化（Steam必須）
echo ">> [1/8] 32bitアーキテクチャの追加 & パッケージ更新..."
dpkg --add-architecture i386 || true
apt-get update -qq

# 2. Xfce4 デスクトップ環境, 音声 (PulseAudio), OpenGL/Vulkan, VNC, noVNC
echo ">> [2/8] Xfce4 デスクトップ・音声・OpenGL/Vulkan・画面描画ツールのインストール..."
apt-get install -y -qq \
    xfce4 xfce4-goodies dbus-x11 x11-xserver-utils x11-utils xterm \
    xvfb x11vnc websockify novnc \
    pulseaudio pulseaudio-utils alsa-utils pavucontrol \
    libgl1-mesa-glx mesa-utils libvulkan1 vulkan-tools \
    ffmpeg jq curl wget git zstd htop \
    python3-dbus python3-gi libdbus-1-3 \
    openjdk-21-jdk-headless > /dev/null 2>&1

# 3. Google Chrome & Chrome Remote Desktop のインストール
echo ">> [3/8] Google Chrome & Chrome Remote Desktop の確認 & インストール..."
if ! which google-chrome > /dev/null 2>&1 && ! which google-chrome-stable > /dev/null 2>&1; then
    wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -qq /tmp/chrome.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1
    rm -f /tmp/chrome.deb
fi

if ! dpkg -s chrome-remote-desktop > /dev/null 2>&1; then
    wget -q -O /tmp/crd.deb https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb
    apt-get install -y -qq /tmp/crd.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1
    rm -f /tmp/crd.deb
fi

# CRD用一般ユーザー (colabuser) の作成 (CRDはrootでの直接実行を拒否するため)
if ! id -u colabuser >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo,chrome-remote-desktop colabuser
    echo "colabuser:123456" | chpasswd
    echo "colabuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/colabuser
fi

mkdir -p /root/.config/chrome-remote-desktop /home/colabuser/.config/chrome-remote-desktop
echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /root/.chrome-remote-desktop-session
echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /home/colabuser/.chrome-remote-desktop-session
chmod +x /root/.chrome-remote-desktop-session /home/colabuser/.chrome-remote-desktop-session
chown -R colabuser:colabuser /home/colabuser

# 4. Steam のインストール
echo ">> [4/8] Steam の確認 & インストール..."
if ! which steam > /dev/null 2>&1; then
    apt-get install -y -qq steam-installer > /dev/null 2>&1 || apt-get install -y -qq steam > /dev/null 2>&1 || true
fi

# 5. Discord のインストール
echo ">> [5/8] Discord の確認 & インストール..."
if ! which discord > /dev/null 2>&1; then
    wget -q -O /tmp/discord.deb "https://discord.com/api/download?platform=linux&format=deb" || true
    if [ -f /tmp/discord.deb ]; then
        apt-get install -y -qq /tmp/discord.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1 || true
        rm -f /tmp/discord.deb
    fi
fi

# 6. CurseForge & Prism Launcher (Minecraftクライアント) & OBS Studio
echo ">> [6/8] CurseForge / Prism Launcher / OBS Studio のセットアップ..."
mkdir -p /usr/local/bin /content/tools

# CurseForge AppImage
if [ ! -f /usr/local/bin/curseforge ]; then
    curl -sSL -o /usr/local/bin/curseforge "https://curseforge.overwolf.com/downloads/curseforge-latest-linux.AppImage" || true
    chmod +x /usr/local/bin/curseforge 2>/dev/null || true
fi

# Prism Launcher (高性能Minecraftランチャー)
if [ ! -f /usr/local/bin/prismlauncher ]; then
    curl -sSL -o /usr/local/bin/prismlauncher "https://github.com/PrismLauncher/PrismLauncher/releases/download/8.4/PrismLauncher-Linux-8.4-x86_64.AppImage" || true
    chmod +x /usr/local/bin/prismlauncher 2>/dev/null || true
fi

# OBS Studio
if ! which obs > /dev/null 2>&1; then
    apt-get install -y -qq obs-studio > /dev/null 2>&1 || true
fi

# 7. トンネルツール (Cloudflared & playit.gg)
echo ">> [7/8] トンネルツール (Cloudflared & playit.gg) のセットアップ..."
if [ ! -f /usr/local/bin/cloudflared ]; then
    curl -sSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x /usr/local/bin/cloudflared
fi

if [ ! -f /usr/local/bin/playit ]; then
    curl -sSL -o /usr/local/bin/playit https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-amd64
    chmod +x /usr/local/bin/playit
fi

# 8. デスクトップ環境・ショートカット・プロファイル整備
echo ">> [8/8] デスクトップショートカット & プロファイル設定..."
DESKTOP_DIR="/root/Desktop"
mkdir -p "$DESKTOP_DIR" /content/chrome_profiles/profile1 /content/chrome_profiles/profile2 /content/chrome_profiles/profile3 /content/recordings

# Chrome Profile 1 ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Chrome_Profile1.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Chrome (Profile 1)
Comment=Google Chrome Main Profile
Exec=google-chrome --no-sandbox --user-data-dir=/content/chrome_profiles/profile1
Icon=google-chrome
Terminal=false
Categories=Network;WebBrowser;
EOF

# Chrome Profile 2 ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Chrome_Profile2.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Chrome (Profile 2)
Comment=Google Chrome Sub Profile
Exec=google-chrome --no-sandbox --user-data-dir=/content/chrome_profiles/profile2
Icon=google-chrome
Terminal=false
Categories=Network;WebBrowser;
EOF

# Steam ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Steam.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Steam
Comment=Steam Gaming Platform
Exec=steam
Icon=steam
Terminal=false
Categories=Game;
EOF

# Discord ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Discord.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Discord
Comment=Discord Voice & Chat
Exec=discord --no-sandbox
Icon=discord
Terminal=false
Categories=Network;InstantMessaging;
EOF

# Minecraft Launcher (Prism Launcher) ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Minecraft_Prism.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Minecraft (Prism Launcher)
Comment=Prism Launcher for Minecraft & Modpacks
Exec=/usr/local/bin/prismlauncher --appimage-extract-and-run
Icon=system-run
Terminal=false
Categories=Game;
EOF

# CurseForge ショートカット
cat << 'EOF' > "$DESKTOP_DIR/CurseForge.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=CurseForge
Comment=CurseForge Mod Manager
Exec=/usr/local/bin/curseforge --no-sandbox --appimage-extract-and-run
Icon=applications-games
Terminal=false
Categories=Game;
EOF

# Xbox Cloud Gaming ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Xbox_Cloud_Gaming.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Xbox Cloud Gaming
Comment=Xbox Cloud Gaming on Browser
Exec=google-chrome --no-sandbox --user-data-dir=/content/chrome_profiles/profile1 --app=https://www.xbox.com/play
Icon=input-gaming
Terminal=false
Categories=Game;
EOF

# Roblox Web / Sober ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Roblox.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Roblox
Comment=Roblox Gaming Platform
Exec=google-chrome --no-sandbox --user-data-dir=/content/chrome_profiles/profile1 --app=https://www.roblox.com
Icon=applications-games
Terminal=false
Categories=Game;
EOF

# ChillwithYou ショートカット
cat << 'EOF' > "$DESKTOP_DIR/ChillwithYou.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=ChillwithYou
Comment=Chill with You / Lo-Fi Audio & Relax Companion
Exec=google-chrome --no-sandbox --user-data-dir=/content/chrome_profiles/profile1 --app=https://chillhop.com/live/chillhop-radio/
Icon=audio-headphones
Terminal=false
Categories=AudioVideo;Audio;
EOF

# 1-Click 画面収録 (NVENC 60fps) ショートカット
cat << 'EOF' > "$DESKTOP_DIR/ScreenRecorder_Toggle.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=🎥 画面収録 (開始/停止)
Comment=Toggle Hardware Accelerated Screen Recording
Exec=/bin/bash -c "/content/ColabTool/GamingPC/scripts/record_screen.sh toggle"
Icon=media-record
Terminal=true
Categories=AudioVideo;Recorder;
EOF

# OBS Studio ショートカット
cat << 'EOF' > "$DESKTOP_DIR/OBS_Studio.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=OBS Studio
Comment=OBS Studio Screen & Stream Recording
Exec=obs
Icon=obs
Terminal=false
Categories=AudioVideo;Recorder;
EOF

# Minecraft サーバー ログ監視コンソール
cat << 'EOF' > "$DESKTOP_DIR/Minecraft_Server_Logs.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=⛏️ Minecraft サーバー ログ監視
Comment=View background Minecraft server logs
Exec=xterm -title "Minecraft Server Logs" -hold -e "tail -n 100 -f /content/minecraft_server/logs/latest.log"
Icon=utilities-terminal
Terminal=false
Categories=System;
EOF

# 音声ミキサー (pavucontrol) ショートカット
cat << 'EOF' > "$DESKTOP_DIR/Volume_Control.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=🔊 音量・サウンド設定
Comment=PulseAudio Volume Control
Exec=pavucontrol
Icon=audio-volume-high
Terminal=false
Categories=AudioVideo;
EOF

# 実行権限の付与 & colabuserへの同期
chmod +x "$DESKTOP_DIR"/*.desktop 2>/dev/null || true
mkdir -p /home/colabuser/Desktop
cp -rf "$DESKTOP_DIR"/* /home/colabuser/Desktop/ 2>/dev/null || true
chmod +x /home/colabuser/Desktop/*.desktop 2>/dev/null || true
chown -R colabuser:colabuser /home/colabuser

echo "✅ [完了] Gaming PC 仮想環境のセットアップが正常に完了しました。"
