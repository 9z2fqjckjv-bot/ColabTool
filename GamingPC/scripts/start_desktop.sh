#!/bin/bash
# ==============================================================================
# start_desktop.sh - Start Xfce4, Virtual Audio, VNC, noVNC & Ultra-Sync Audio
# ==============================================================================
set -e

CRD_CODE="$1"
CRD_PIN="${2:-123456}"
SCREEN_RES="${3:-1680x1050}" # MacBook 黄金比 16:10 デフォルト

echo "=================================================="
echo "  🖥️ デスクトップ環境 & リアルタイム接続の起動"
echo "  画面解像度: ${SCREEN_RES} (MacBook 16:10 最適化)"
echo "=================================================="

# 1. 仮想オーディオ (PulseAudio) の起動
echo ">> [1/5] 仮想オーディオ (PulseAudio) を初期化中..."
pulseaudio -D --exit-idle-time=-1 2>/dev/null || true
pactl load-module module-null-sink sink_name=VirtualSink sink_properties=device.description=VirtualSink 2>/dev/null || true
pactl set-default-sink VirtualSink 2>/dev/null || true

# 2. Xvfb 仮想ディスプレイ & Xfce4 の起動
echo ">> [2/5] Xvfb 仮想ディスプレイ (${SCREEN_RES} 24bit) & Xfce4 を起動中..."
export DISPLAY=:1
export LANG=ja_JP.UTF-8
export LC_ALL=ja_JP.UTF-8
export TZ=Asia/Tokyo

if ! pgrep -f "Xvfb :1" > /dev/null 2>&1; then
    nohup Xvfb :1 -screen 0 "${SCREEN_RES}x24" +extension GLX +extension RENDER -noreset > /content/xvfb.log 2>&1 &
    sleep 2
fi

# Xfce4 パネル初期設定の配置（初回黒画面防止）
mkdir -p /root/.config/xfce4/xfconf/xfce-perchannel-xml
if [ ! -f /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml ]; then
    cp -r /etc/xdg/xfce4/panel/default.xml /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml 2>/dev/null || true
fi

if ! pgrep -f "xfce4-session" > /dev/null 2>&1; then
    nohup dbus-launch --exit-with-session startxfce4 > /content/xfce.log 2>&1 &
    sleep 2
fi

# 3. 超低遅延 PCM 音声配信サーバー (ポート 8000)
echo ">> [3/5] 超低遅延リアルタイム音声配信デーモン (ポート 8000) を起動..."
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

# 4. x11vnc & noVNC の起動
echo ">> [4/5] x11vnc & noVNC サーバーをバックグラウンド起動中..."
fuser -k 5901/tcp 6080/tcp 2>/dev/null || true
sleep 1

nohup x11vnc -display :1 -nopw -listen 0.0.0.0 -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 > /content/x11vnc.log 2>&1 &

NOVNC_DIR="/usr/share/novnc"
[ -d "$NOVNC_DIR" ] || NOVNC_DIR="/usr/local/share/novnc"
[ -f "$NOVNC_DIR/index.html" ] && [ ! -f "$NOVNC_DIR/vnc.html" ] && ln -sf "$NOVNC_DIR/index.html" "$NOVNC_DIR/vnc.html"

# noVNC の HTML に Web Audio API リアルタイム音同期ウィジェットを注入
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

# Cloudflared 高速トンネルの起動 (外部バックアップ用)
pkill -f "cloudflared tunnel" 2>/dev/null || true
rm -f /content/cloudflared.log
nohup cloudflared tunnel --url http://127.0.0.1:6080 > /content/cloudflared.log 2>&1 &

NOVNC_URL=""
for i in {1..15}; do
    NOVNC_URL=$(grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" /content/cloudflared.log 2>/dev/null | head -n 1 || true)
    if [ -n "$NOVNC_URL" ]; then
        break
    fi
    sleep 1
done

# 5. Chrome Remote Desktop (CRD) の設定（指定されている場合）
echo ">> [5/5] リモート接続方式の構成..."
if [ -n "$CRD_CODE" ]; then
    echo "Chrome Remote Desktop を構成中..."
    cat << 'EOF' > /usr/local/bin/systemctl
#!/bin/bash
if [ "$1" = "is-active" ]; then
    echo "active"
fi
exit 0
EOF
    chmod +x /usr/local/bin/systemctl

    if [[ "$CRD_CODE" == *"start-host"* ]]; then
        CMD="$CRD_CODE"
        if [[ "$CMD" != *"--pin="* ]]; then
            CMD="$CMD --pin=$CRD_PIN"
        fi
    else
        CMD="DISPLAY= /opt/google/chrome-remote-desktop/start-host --code=\"$CRD_CODE\" --redirect-url=\"https://remotedesktop.google.com/_/oauthredirect\" --name=\$(hostname) --pin=$CRD_PIN"
    fi

    pkill -u colabuser -f chrome-remote-desktop 2>/dev/null || true
    service dbus start > /dev/null 2>&1 || true
    sudo -u colabuser bash -c "$CMD" > /content/crd_setup.log 2>&1 || true
    nohup sudo -u colabuser /opt/google/chrome-remote-desktop/chrome-remote-desktop > /content/crd_run.log 2>&1 &
    sleep 2
fi

echo ""
echo "=================================================="
echo "🎉 デスクトップ環境の起動が完了しました！"
echo "=================================================="
if [ -n "$NOVNC_URL" ]; then
    echo "🌐 【Cloudflare 高速トンネル URL】:"
    echo "👉  ${NOVNC_URL}/vnc.html?autoconnect=true&resize=scale"
    echo "--------------------------------------------------"
fi
echo "✨ 解像度: ${SCREEN_RES} (MacBook 16:10)"
echo "✨ 音声同期: Web Audio API (超低遅延・リアルタイム音同期)"
echo "=================================================="
