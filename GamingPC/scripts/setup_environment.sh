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

# 1. タイムゾーン (Asia/Tokyo) & 日本語環境 (ja_JP.UTF-8) の設定
echo ">> [1/9] 日本標準時 (Asia/Tokyo) & 日本語ロケールのセットアップ..."
ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime
echo "Asia/Tokyo" > /etc/timezone

dpkg --add-architecture i386 || true
apt-get update -qq

apt-get install -y -qq locales fonts-noto-cjk fonts-noto-color-emoji fonts-ipafont-gothic > /dev/null 2>&1 || true
locale-gen ja_JP.UTF-8 > /dev/null 2>&1 || true
update-locale LANG=ja_JP.UTF-8 > /dev/null 2>&1 || true
export LANG=ja_JP.UTF-8
export LC_ALL=ja_JP.UTF-8
export TZ=Asia/Tokyo

# 2. Xfce4 デスクトップ環境, 音声 (PulseAudio), OpenGL/Vulkan, VNC, noVNC
echo ">> [2/9] Xfce4 デスクトップ・音声・OpenGL/Vulkan・画面描画ツールのインストール..."
apt-get install -y -qq \
    xfce4 xfce4-goodies xfce4-terminal dbus-x11 x11-xserver-utils x11-utils xterm \
    xvfb x11vnc websockify novnc \
    pulseaudio pulseaudio-utils alsa-utils pavucontrol \
    libgl1-mesa-glx mesa-utils libvulkan1 vulkan-tools \
    ffmpeg jq curl wget git zstd htop \
    python3-dbus python3-gi libdbus-1-3 libdbus-1-dev libglib2.0-dev python3-dev pkg-config \
    openjdk-21-jdk-headless > /dev/null 2>&1

# Python websockify & D-Bus バインディングの確実なコンパイル・導入
pip install -q websockify > /dev/null 2>&1 || true
python3 -m pip install --ignore-installed --no-cache-dir dbus-python > /dev/null 2>&1 || true
if which python3.10 >/dev/null 2>&1 && python3.10 -c "import dbus" >/dev/null 2>&1; then
    sed -i '1s|.*|#!/usr/bin/python3.10|' /opt/google/chrome-remote-desktop/chrome-remote-desktop 2>/dev/null || true
fi

# 3. Google Chrome & Chrome Remote Desktop のインストール
echo ">> [3/9] Google Chrome & Chrome Remote Desktop の確認 & インストール..."
if ! which google-chrome > /dev/null 2>&1 && ! which google-chrome-stable > /dev/null 2>&1; then
    wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -qq /tmp/chrome.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1
    rm -f /tmp/chrome.deb
fi

# Chrome root実行用ラッパー
cat << 'EOF' > /usr/local/bin/google-chrome-colab
#!/bin/bash
exec /usr/bin/google-chrome-stable --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
EOF
chmod +x /usr/local/bin/google-chrome-colab

if ! dpkg -s chrome-remote-desktop > /dev/null 2>&1; then
    wget -q -O /tmp/crd.deb https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb
    apt-get install -y -qq /tmp/crd.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1
    rm -f /tmp/crd.deb
fi

# Colab/Docker環境用 systemctl モック (CRDのstart-hostがsystemd不在でクラッシュするのを防ぐ)
cat << 'EOF' > /usr/local/bin/systemctl
#!/bin/bash
if [ "$1" = "is-active" ]; then
    echo "active"
fi
exit 0
EOF
chmod +x /usr/local/bin/systemctl

# 4. 一般ユーザー (colabuser) の作成 & 権限付与 (CRD・Steam の root 実行制限対策)
echo ">> [4/9] 一般ユーザー (colabuser) の構成 & 権限設定..."
if ! id -u colabuser >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo,chrome-remote-desktop,video,audio colabuser
    echo "colabuser:123456" | chpasswd
    echo "colabuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/colabuser
fi
usermod -aG video,audio,render colabuser 2>/dev/null || true

# X11 画面へのローカルユーザーアクセス許可
xhost +local: > /dev/null 2>&1 || xhost + > /dev/null 2>&1 || true

mkdir -p /root/.config/chrome-remote-desktop /home/colabuser/.config/chrome-remote-desktop
echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /root/.chrome-remote-desktop-session
echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /home/colabuser/.chrome-remote-desktop-session
chmod +x /root/.chrome-remote-desktop-session /home/colabuser/.chrome-remote-desktop-session
chown -R colabuser:colabuser /home/colabuser

# 5. Steam の公式インストーラー導入 & root 回避ラッパー設定
echo ">> [5/9] Steam の確認 & インストール..."
if ! which steam > /dev/null 2>&1 && [ ! -f /usr/games/steam ]; then
    wget -q -O /tmp/steam.deb "https://cdn.cloudflare.steamstatic.com/client/installer/steam.deb" || true
    if [ -f /tmp/steam.deb ]; then
        dpkg -i /tmp/steam.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1 || true
        rm -f /tmp/steam.deb
    fi
fi

# 一般ユーザー colabuser として Steam を起動するラッパー
cat << 'EOF' > /usr/local/bin/steam-colab
#!/bin/bash
xhost +local: > /dev/null 2>&1 || xhost + > /dev/null 2>&1 || true
export DISPLAY=:1
exec sudo -u colabuser DISPLAY=:1 HOME=/home/colabuser /usr/games/steam "$@"
EOF
chmod +x /usr/local/bin/steam-colab

# 6. Discord のインストール & root 起動ラッパー設定
echo ">> [6/9] Discord の確認 & インストール..."
if ! which discord > /dev/null 2>&1; then
    wget -q -O /tmp/discord.deb "https://discord.com/api/download?platform=linux&format=deb" || true
    if [ -f /tmp/discord.deb ]; then
        apt-get install -y -qq /tmp/discord.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1 || true
        rm -f /tmp/discord.deb
    fi
fi
cat << 'EOF' > /usr/local/bin/discord-colab
#!/bin/bash
exec /usr/bin/discord --no-sandbox "$@"
EOF
chmod +x /usr/local/bin/discord-colab

# 7. CurseForge & Prism Launcher (Minecraftクライアント) & OBS Studio
echo ">> [7/9] CurseForge / Prism Launcher / OBS Studio のセットアップ..."
mkdir -p /usr/local/bin /opt/curseforge /opt/prismlauncher

# CurseForge AppImage
if [ ! -f /opt/curseforge/curseforge.AppImage ]; then
    curl -sSL -o /opt/curseforge/curseforge.AppImage "https://curseforge.overwolf.com/downloads/curseforge-latest-linux.AppImage" || true
    chmod +x /opt/curseforge/curseforge.AppImage 2>/dev/null || true
fi

# Prism Launcher (高性能Minecraftランチャー)
if [ ! -f /opt/prismlauncher/prismlauncher.AppImage ]; then
    curl -sSL -o /opt/prismlauncher/prismlauncher.AppImage "https://github.com/PrismLauncher/PrismLauncher/releases/download/8.4/PrismLauncher-Linux-8.4-x86_64.AppImage" || \
    curl -sSL -o /opt/prismlauncher/prismlauncher.AppImage "https://github.com/PrismLauncher/PrismLauncher/releases/latest/download/PrismLauncher-Linux-x86_64.AppImage" || true
    chmod +x /opt/prismlauncher/prismlauncher.AppImage 2>/dev/null || true
fi

cat << 'EOF' > /usr/local/bin/prismlauncher
#!/bin/bash
exec /opt/prismlauncher/prismlauncher.AppImage --appimage-extract-and-run "$@"
EOF
chmod +x /usr/local/bin/prismlauncher

# OBS Studio
if ! which obs > /dev/null 2>&1; then
    apt-get install -y -qq obs-studio > /dev/null 2>&1 || true
fi

# 8. トンネルツール (Cloudflared & playit.gg)
echo ">> [8/9] トンネルツール (Cloudflared & playit.gg) のセットアップ..."
if [ ! -f /usr/local/bin/cloudflared ]; then
    curl -sSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x /usr/local/bin/cloudflared
fi

if [ ! -f /usr/local/bin/playit ]; then
    curl -sSL -o /usr/local/bin/playit https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-amd64
    chmod +x /usr/local/bin/playit
fi

# 9. デスクトップ環境・ショートカット・プロファイル整備
echo ">> [9/9] 日本語デスクトップショートカット & 権限登録..."
DESKTOP_DIR="/root/Desktop"
mkdir -p "$DESKTOP_DIR" /content/chrome_profiles/profile1 /content/chrome_profiles/profile2 /content/chrome_profiles/profile3 /content/recordings

# Chrome Profile 1〜3
for i in 1 2 3; do
cat << EOF > "$DESKTOP_DIR/Chrome_Profile_$i.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Chrome (Profile $i)
Comment=Chrome Profile $i
Exec=/usr/local/bin/google-chrome-colab --user-data-dir=/content/chrome_profiles/profile$i
Icon=google-chrome
Terminal=false
Categories=Network;WebBrowser;
EOF
done

# Steam
cat << 'EOF' > "$DESKTOP_DIR/Steam.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Steam (Hoi4 / Chill with You)
Comment=Play games on Steam
Exec=/usr/local/bin/steam-colab
Icon=steam
Terminal=false
Categories=Game;
EOF

# Minecraft (Prism Launcher)
cat << 'EOF' > "$DESKTOP_DIR/Minecraft.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Minecraft (Prism Launcher)
Comment=Prism Launcher for Minecraft & Modpacks
Exec=/usr/local/bin/prismlauncher
Icon=system-run
Terminal=false
Categories=Game;
EOF

# CurseForge
cat << 'EOF' > "$DESKTOP_DIR/CurseForge.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=CurseForge (Mod管理)
Comment=CurseForge Mod Manager
Exec=/opt/curseforge/curseforge.AppImage --no-sandbox --appimage-extract-and-run
Icon=applications-games
Terminal=false
Categories=Game;
EOF

# Xbox Cloud Gaming
cat << 'EOF' > "$DESKTOP_DIR/XboxCloud.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Xbox Cloud Gaming
Comment=Xbox Cloud Gaming on Browser
Exec=/usr/local/bin/google-chrome-colab --app="https://www.xbox.com/play"
Icon=input-gaming
Terminal=false
Categories=Game;
EOF

# Roblox
cat << 'EOF' > "$DESKTOP_DIR/Roblox.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Roblox
Comment=Roblox Gaming
Exec=/usr/local/bin/google-chrome-colab --app="https://www.roblox.com/home"
Icon=applications-games
Terminal=false
Categories=Game;
EOF

# ChillwithYou
cat << 'EOF' > "$DESKTOP_DIR/ChillwithYou.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=ChillwithYou
Comment=Lo-Fi Audio & Relax Companion
Exec=/usr/local/bin/google-chrome-colab --app="https://chillhop.com/live/chillhop-radio/"
Icon=audio-headphones
Terminal=false
Categories=AudioVideo;Audio;
EOF

# Discord
cat << 'EOF' > "$DESKTOP_DIR/Discord.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Discord
Comment=All-in-one voice and text chat
Exec=/usr/local/bin/discord-colab
Icon=discord
Terminal=false
Categories=Network;InstantMessaging;
EOF

# OBS Studio
cat << 'EOF' > "$DESKTOP_DIR/OBS.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=OBS Studio (画面収録・配信)
Comment=Screen Recording & Streaming
Exec=obs
Icon=obs
Terminal=false
Categories=AudioVideo;Recorder;
EOF

# 1-Click 画面収録 (NVENC 60fps) ショートカット
cat << 'EOF' > "$DESKTOP_DIR/ScreenRecorder_Toggle.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=画面収録 (開始/停止)
Comment=Toggle Hardware Accelerated Screen Recording
Exec=/bin/bash -c "/content/ColabTool/GamingPC/scripts/record_screen.sh toggle"
Icon=media-record
Terminal=true
Categories=AudioVideo;Recorder;
EOF

# Minecraft サーバー ログ監視コンソール
cat << 'EOF' > "$DESKTOP_DIR/Minecraft_Server_Logs.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Minecraft サーバー ログ監視
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
Name=音量・サウンド設定
Comment=PulseAudio Volume Control
Exec=pavucontrol
Icon=audio-volume-high
Terminal=false
Categories=AudioVideo;
EOF

# 全ショートカットを実行可能 & 信頼済みとして一括登録
chmod +x "$DESKTOP_DIR"/*.desktop 2>/dev/null || true
for f in "$DESKTOP_DIR"/*.desktop; do
    gio set "$f" metadata::trusted yes 2>/dev/null || true
done

mkdir -p /home/colabuser/Desktop
cp -rf "$DESKTOP_DIR"/* /home/colabuser/Desktop/ 2>/dev/null || true
chmod +x /home/colabuser/Desktop/*.desktop 2>/dev/null || true
for f in /home/colabuser/Desktop/*.desktop; do
    gio set "$f" metadata::trusted yes 2>/dev/null || true
done
chown -R colabuser:colabuser /home/colabuser

# Xfce4 デフォルトパネル設定（初回起動の黒画面・ダイアログ防止）
mkdir -p /root/.config/xfce4/xfconf/xfce-perchannel-xml /home/colabuser/.config/xfce4/xfconf/xfce-perchannel-xml
cp -r /etc/xdg/xfce4/panel/default.xml /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml 2>/dev/null || true
cp -r /etc/xdg/xfce4/panel/default.xml /home/colabuser/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml 2>/dev/null || true
chown -R colabuser:colabuser /home/colabuser/.config

echo "✅ [完了] Gaming PC 仮想環境のセットアップが正常に完了しました。"
