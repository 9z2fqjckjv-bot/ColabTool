#!/bin/bash
# ==============================================================================
# launch.sh - Ultra-Fast & Cached One-Click Launch for Colab Gaming PC
# ==============================================================================

export DEBIAN_FRONTEND=noninteractive
SCREEN_RES="${1:-1680x1050}" # MacBook 16:10 デフォルト

echo "=================================================="
echo "  🎮 Gaming PC 仮想環境（日本語・音同期・MacBook最適化）"
echo "  画面解像度: ${SCREEN_RES}"
echo "=================================================="

# 1. タイムゾーン (Asia/Tokyo) & 日本語ロケール
echo ">> [1/5] 日本標準時 (Asia/Tokyo) & 日本語フォント設定..."
ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime 2>/dev/null || true
echo "Asia/Tokyo" > /etc/timezone 2>/dev/null || true

# 必要なパッケージの導入（インストール済みならスキップして高速化）
if ! which xfce4-session >/dev/null 2>&1 || [ ! -f /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc ]; then
    echo "    📦 基本デスクトップ・日本語フォントをインストール中..."
    dpkg --add-architecture i386 2>/dev/null || true
    apt-get update -qq 2>/dev/null || true
    apt-get install -y -qq \
        locales fonts-noto-cjk fonts-noto-color-emoji fonts-ipafont-gothic \
        xfce4 xfce4-terminal dbus-x11 x11-xserver-utils x11-utils xterm \
        xvfb x11vnc websockify novnc \
        pulseaudio pulseaudio-utils alsa-utils pavucontrol \
        libgl1-mesa-dri libglx-mesa0 libgl1 mesa-utils libvulkan1 vulkan-tools \
        ffmpeg jq curl wget git zstd htop \
        openjdk-21-jre-headless 2>/dev/null || true
    locale-gen ja_JP.UTF-8 2>/dev/null || true
    update-locale LANG=ja_JP.UTF-8 2>/dev/null || true
else
    echo "    ✅ 基本パッケージは既にインストール済みです（スキップ）"
fi

pip install -q websockify 2>/dev/null || true

export LANG=ja_JP.UTF-8
export LC_ALL=ja_JP.UTF-8
export TZ=Asia/Tokyo

# 2. 一般ユーザー (colabuser) の作成 & 権限付与
echo ">> [2/5] 実行ユーザー権限 & オーディオの初期化..."
if ! id -u colabuser >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo,video,audio colabuser 2>/dev/null || true
    echo "colabuser:123456" | chpasswd 2>/dev/null || true
    echo "colabuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/colabuser 2>/dev/null || true
fi
usermod -aG video,audio,render colabuser 2>/dev/null || true
xhost +local: > /dev/null 2>&1 || xhost + > /dev/null 2>&1 || true

# PulseAudio 仮想オーディオ
pulseaudio -D --exit-idle-time=-1 2>/dev/null || true
pactl load-module module-null-sink sink_name=VirtualSink sink_properties=device.description=VirtualSink 2>/dev/null || true
pactl set-default-sink VirtualSink 2>/dev/null || true

# 3. ブラウザ & ゲームソフトの導入（未導入時のみダウンロード）
echo ">> [3/5] Google Chrome, Steam, Prism Launcher (Minecraft), Discord の確認..."

# Google Chrome
if ! which google-chrome > /dev/null 2>&1 && ! which google-chrome-stable > /dev/null 2>&1; then
    echo "    📦 Google Chrome をダウンロード中..."
    wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb || true
    apt-get install -y -qq /tmp/chrome.deb 2>/dev/null || apt-get install -f -y -qq 2>/dev/null || true
    rm -f /tmp/chrome.deb 2>/dev/null || true
fi
cat << 'EOF' > /usr/local/bin/google-chrome-colab
#!/bin/bash
exec /usr/bin/google-chrome-stable --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox "$@"
EOF
chmod +x /usr/local/bin/google-chrome-colab 2>/dev/null || true

# Steam
if ! which steam > /dev/null 2>&1 && [ ! -f /usr/games/steam ]; then
    echo "    📦 Steam をダウンロード中..."
    wget -q -O /tmp/steam.deb "https://cdn.cloudflare.steamstatic.com/client/installer/steam.deb" 2>/dev/null || true
    if [ -f /tmp/steam.deb ]; then
        dpkg -i /tmp/steam.deb 2>/dev/null || apt-get install -f -y -qq 2>/dev/null || true
        rm -f /tmp/steam.deb 2>/dev/null || true
    fi
fi
cat << 'EOF' > /usr/local/bin/steam-colab
#!/bin/bash
xhost +local: > /dev/null 2>&1 || xhost + > /dev/null 2>&1 || true
export DISPLAY=:1
exec sudo -u colabuser DISPLAY=:1 HOME=/home/colabuser /usr/games/steam "$@"
EOF
chmod +x /usr/local/bin/steam-colab 2>/dev/null || true

# Discord
if ! which discord > /dev/null 2>&1; then
    echo "    📦 Discord をダウンロード中..."
    wget -q -O /tmp/discord.deb "https://discord.com/api/download?platform=linux&format=deb" 2>/dev/null || true
    if [ -f /tmp/discord.deb ]; then
        apt-get install -y -qq /tmp/discord.deb 2>/dev/null || apt-get install -f -y -qq 2>/dev/null || true
        rm -f /tmp/discord.deb 2>/dev/null || true
    fi
fi
cat << 'EOF' > /usr/local/bin/discord-colab
#!/bin/bash
exec /usr/bin/discord --no-sandbox "$@"
EOF
chmod +x /usr/local/bin/discord-colab 2>/dev/null || true

# Prism Launcher (Minecraft)
mkdir -p /opt/prismlauncher
if [ ! -f /opt/prismlauncher/prismlauncher.AppImage ]; then
    echo "    📦 Prism Launcher をダウンロード中..."
    curl -sSL -o /opt/prismlauncher/prismlauncher.AppImage "https://github.com/PrismLauncher/PrismLauncher/releases/download/8.4/PrismLauncher-Linux-8.4-x86_64.AppImage" 2>/dev/null || \
    curl -sSL -o /opt/prismlauncher/prismlauncher.AppImage "https://github.com/PrismLauncher/PrismLauncher/releases/latest/download/PrismLauncher-Linux-x86_64.AppImage" 2>/dev/null || true
    chmod +x /opt/prismlauncher/prismlauncher.AppImage 2>/dev/null || true
fi
cat << 'EOF' > /usr/local/bin/prismlauncher
#!/bin/bash
exec /opt/prismlauncher/prismlauncher.AppImage --appimage-extract-and-run "$@"
EOF
chmod +x /usr/local/bin/prismlauncher 2>/dev/null || true

# OBS Studio
which obs > /dev/null 2>&1 || apt-get install -y -qq obs-studio 2>/dev/null || true

# 4. 日本語デスクトップショートカットの配置
echo ">> [4/5] デスクトップショートカットの整備..."
DESKTOP_DIR="/root/Desktop"
mkdir -p "$DESKTOP_DIR" /content/chrome_profiles/profile1 /content/chrome_profiles/profile2 /content/chrome_profiles/profile3

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

cat << 'EOF' > "$DESKTOP_DIR/Steam.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Steam (Hoi4 / Chill with You)
Exec=/usr/local/bin/steam-colab
Icon=steam
Terminal=false
Categories=Game;
EOF

cat << 'EOF' > "$DESKTOP_DIR/Minecraft.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Minecraft (Prism Launcher)
Exec=/usr/local/bin/prismlauncher
Icon=system-run
Terminal=false
Categories=Game;
EOF

cat << 'EOF' > "$DESKTOP_DIR/XboxCloud.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Xbox Cloud Gaming
Exec=/usr/local/bin/google-chrome-colab --app="https://www.xbox.com/play"
Icon=input-gaming
Terminal=false
Categories=Game;
EOF

cat << 'EOF' > "$DESKTOP_DIR/Roblox.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Roblox
Exec=/usr/local/bin/google-chrome-colab --app="https://www.roblox.com/home"
Icon=applications-games
Terminal=false
Categories=Game;
EOF

cat << 'EOF' > "$DESKTOP_DIR/ChillwithYou.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=ChillwithYou
Exec=/usr/local/bin/google-chrome-colab --app="https://chillhop.com/live/chillhop-radio/"
Icon=audio-headphones
Terminal=false
Categories=AudioVideo;Audio;
EOF

cat << 'EOF' > "$DESKTOP_DIR/Discord.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Discord
Exec=/usr/local/bin/discord-colab
Icon=discord
Terminal=false
Categories=Network;InstantMessaging;
EOF

cat << 'EOF' > "$DESKTOP_DIR/OBS.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=OBS Studio (画面収録・配信)
Exec=obs
Icon=obs
Terminal=false
Categories=AudioVideo;Recorder;
EOF

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
chown -R colabuser:colabuser /home/colabuser 2>/dev/null || true

# 5. Xvfb 画面 & 超低遅延音同期エンジンの起動
echo ">> [5/5] Xvfb 仮想ディスプレイ (${SCREEN_RES}) & Web Audio 音同期エンジンの起動..."
export DISPLAY=:1

if ! pgrep -f "Xvfb :1" > /dev/null 2>&1; then
    nohup Xvfb :1 -screen 0 "${SCREEN_RES}x24" +extension GLX +extension RENDER -noreset > /content/xvfb.log 2>&1 &
    sleep 2
fi

mkdir -p /root/.config/xfce4/xfconf/xfce-perchannel-xml /home/colabuser/.config/xfce4/xfconf/xfce-perchannel-xml
cp -r /etc/xdg/xfce4/panel/default.xml /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml 2>/dev/null || true
cp -r /etc/xdg/xfce4/panel/default.xml /home/colabuser/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml 2>/dev/null || true

if ! pgrep -f "xfce4-session" > /dev/null 2>&1; then
    nohup dbus-launch --exit-with-session startxfce4 > /content/xfce.log 2>&1 &
    sleep 2
fi

# 超低遅延 PCM 音声配信デーモン (ポート 8000)
fuser -k 8000/tcp 2>/dev/null || true
cat << 'EOF' > /content/audio_stream.py
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

class UltraLowLatencyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'close')
        self.end_headers()
        
        cmd = [
            "ffmpeg", "-f", "pulse", "-i", "VirtualSink.monitor",
            "-ac", "2", "-ar", "44100", "-f", "s16le",
            "-bufsize", "1024", "-fflags", "nobuffer", "-flush_packets", "1", "-"
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=512)
        try:
            while True:
                chunk = proc.stdout.read(2048)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except Exception:
            pass
        finally:
            proc.kill()

httpd = HTTPServer(('0.0.0.0', 8000), UltraLowLatencyHandler)
httpd.serve_forever()
EOF
nohup python3 /content/audio_stream.py > /dev/null 2>&1 &

# x11vnc & websockify 起動
fuser -k 5901/tcp 6080/tcp 2>/dev/null || true
sleep 1
nohup x11vnc -display :1 -nopw -listen 0.0.0.0 -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 > /content/x11vnc.log 2>&1 &

NOVNC_DIR="/usr/share/novnc"
[ -d "$NOVNC_DIR" ] || NOVNC_DIR="/usr/local/share/novnc"
[ -f "$NOVNC_DIR/index.html" ] && [ ! -f "$NOVNC_DIR/vnc.html" ] && ln -sf "$NOVNC_DIR/index.html" "$NOVNC_DIR/vnc.html"

# noVNC の HTML に Web Audio API 音同期ウィジェットを注入
python3 - << 'PYEOF'
import os, re
novnc_dir = "/usr/share/novnc" if os.path.exists("/usr/share/novnc") else "/usr/local/share/novnc"
target_html = f"{novnc_dir}/vnc.html"

if os.path.exists(target_html):
    with open(target_html, "r", encoding="utf-8") as f:
        content = f.read()

    audio_script = '''
<!-- ANTIGRAVITY AUDIO INTEGRATION -->
<div id="live-audio-bar" style="position: fixed; top: 12px; right: 80px; z-index: 99999; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); border: 1px solid rgba(56, 189, 248, 0.5); border-radius: 30px; padding: 6px 16px; display: flex; align-items: center; gap: 10px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); user-select: none;">
  <span id="audio-toggle" style="cursor: pointer; font-size: 16px;" title="クリックでミュート/解除">🔊</span>
  <span style="font-weight: bold; color: #38bdf8; font-size: 11px; letter-spacing: 0.5px;">LIVE SOUND</span>
  <input id="audio-volume" type="range" min="0" max="1" step="0.05" value="0.8" style="width: 70px; cursor: pointer; accent-color: #38bdf8;">
</div>
<script>
(function() {
  let audioCtx = null, gainNode = null, isRunning = false, nextStartTime = 0;
  const toggleBtn = document.getElementById('audio-toggle');
  const volumeSlider = document.getElementById('audio-volume');
  let currentVolume = 0.8;

  async function initWebAudio() {
    if (isRunning) return;
    isRunning = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 44100 });
    gainNode = audioCtx.createGain();
    gainNode.gain.value = currentVolume;
    gainNode.connect(audioCtx.destination);
    nextStartTime = audioCtx.currentTime;

    const audioUrl = window.location.origin.replace(/^https?:\\/\\/6080-/, (m) => m.replace('6080-', '8000-')) + '/stream';

    try {
      const response = await fetch(audioUrl);
      const reader = response.body.getReader();

      while (isRunning) {
        const { done, value } = await reader.read();
        if (done) break;

        const int16 = new Int16Array(value.buffer, value.byteOffset, Math.floor(value.byteLength / 2));
        const numSamples = Math.floor(int16.length / 2);
        if (numSamples === 0) continue;

        const buffer = audioCtx.createBuffer(2, numSamples, 44100);
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);

        for (let i = 0; i < numSamples; i++) {
          left[i] = int16[i * 2] / 32768;
          right[i] = int16[i * 2 + 1] / 32768;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);

        if (nextStartTime < audioCtx.currentTime - 0.05) {
          nextStartTime = audioCtx.currentTime;
        }
        source.start(nextStartTime);
        nextStartTime += buffer.duration;
      }
    } catch (e) {
      isRunning = false;
    }
  }

  document.addEventListener('click', () => {
    if (!audioCtx || audioCtx.state === 'suspended') {
      if (audioCtx) audioCtx.resume();
      initWebAudio();
    }
  }, { once: true });

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!gainNode) return;
    if (gainNode.gain.value > 0) {
      gainNode.gain.value = 0;
      toggleBtn.textContent = '🔇';
    } else {
      gainNode.gain.value = currentVolume;
      toggleBtn.textContent = '🔊';
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    currentVolume = parseFloat(e.target.value);
    if (gainNode) gainNode.gain.value = currentVolume;
    toggleBtn.textContent = currentVolume === 0 ? '🔇' : '🔊';
  });
})();
</script>
<!-- END ANTIGRAVITY AUDIO INTEGRATION -->
'''
    content = re.sub(r'<!-- ANTIGRAVITY AUDIO INTEGRATION -->.*?<!-- END ANTIGRAVITY AUDIO INTEGRATION -->', '', content, flags=re.DOTALL)
    content = content.replace("</body>", f"{audio_script}\n</body>")
    with open(target_html, "w", encoding="utf-8") as f:
        f.write(content)
PYEOF

nohup websockify --web="$NOVNC_DIR" 6080 127.0.0.1:5901 > /content/novnc.log 2>&1 &
sleep 2

echo "=================================================="
echo "🎉 デスクトップ環境のセットアップが完了しました！"
echo "=================================================="
exit 0
