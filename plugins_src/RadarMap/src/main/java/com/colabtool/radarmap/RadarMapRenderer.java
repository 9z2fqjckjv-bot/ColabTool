package com.colabtool.radarmap;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.map.*;

import java.util.Collection;

public class RadarMapRenderer extends MapRenderer {

    // カラーパレット定数 (MapPalette 安全な符号付きbyte値)
    private static final byte COLOR_BLACK = (byte) 119;      // 暗色背景
    private static final byte COLOR_GRID = (byte) 18;       // グリッド・レーダー円 (薄緑/グレー)
    private static final byte COLOR_CROSSHAIR = (byte) 22;  // 十字照準線
    private static final byte COLOR_USER = (byte) 34;       // 明るいグリーン (あなた)
    private static final byte COLOR_GEMINI = (byte) 54;     // ブルー (Gemini)
    private static final byte COLOR_CHATGPT = (byte) 78;    // シアン (ChatGPT)
    private static final byte COLOR_CLAUDE = (byte) 66;     // マゼンタ/パープル (Claude)
    private static final byte COLOR_GROK = (byte) 42;       // ゴールド/オレンジ (Grok)
    private static final byte COLOR_OTHER = (byte) 16;      // レッド (その他)

    public RadarMapRenderer() {
        super(true); // contextual: プレイヤーごとに個別視点描画
    }

    public boolean isExplorerMap() {
        return false;
    }

    @Override
    public void render(MapView map, MapCanvas canvas, Player viewer) {
        if (viewer == null || !viewer.isOnline()) return;

        try {
            Location viewerLoc = viewer.getLocation();
            Collection<? extends Player> players = Bukkit.getOnlinePlayers();

            // 1. 最大距離を計測して動的スケール(Auto-Scale)を算出
            double maxDist = 35.0; // 最小探知半径 (近距離時はズーム)
            for (Player p : players) {
                if (p != null && p.isOnline() && p.getWorld().equals(viewer.getWorld())) {
                    double dist = p.getLocation().distance(viewerLoc);
                    if (dist > maxDist) {
                        maxDist = dist;
                    }
                }
            }
            // 最大半径は500mに安全制限
            if (maxDist > 500.0) maxDist = 500.0;

            // 128x128画面の中心(64,64)から半径52px以内に全プレイヤーが収まるスケール
            double scale = (maxDist + 10.0) / 52.0;

            // 2. 背景・レーダー円・十字線の描画
            for (int x = 0; x < 128; x++) {
                int dx = x - 64;
                for (int y = 0; y < 128; y++) {
                    int dy = y - 64;
                    int r2 = dx * dx + dy * dy;

                    if (r2 > 58 * 58) {
                        canvas.setPixel(x, y, (byte) 0); // 外枠外側
                    } else if (r2 >= 57 * 57 || r2 == 38 * 38 || r2 == 19 * 19) {
                        canvas.setPixel(x, y, COLOR_GRID); // レーダー同心円
                    } else if (dx == 0 || dy == 0) {
                        canvas.setPixel(x, y, COLOR_CROSSHAIR); // 十字線
                    } else {
                        canvas.setPixel(x, y, COLOR_BLACK); // レーダースコープ背景
                    }
                }
            }

            // 方角表示 (N, S, E, W)
            canvas.drawText(62, 7, MinecraftFont.Font, "§18;N");
            canvas.drawText(62, 115, MinecraftFont.Font, "§18;S");
            canvas.drawText(116, 61, MinecraftFont.Font, "§18;E");
            canvas.drawText(8, 61, MinecraftFont.Font, "§18;W");

            // 3. タイトル & スケール情報
            canvas.drawText(4, 2, MinecraftFont.Font, "§17;LIVE RADAR");
            canvas.drawText(4, 118, MinecraftFont.Font, "§20;R:" + (int) maxDist + "m");
            canvas.drawText(70, 118, MinecraftFont.Font, "§20;" + (int) viewerLoc.getX() + "," + (int) viewerLoc.getZ());

            // 4. クルソル初期化
            MapCursorCollection cursors = canvas.getCursors();
            while (cursors.size() > 0) {
                cursors.removeCursor(cursors.getCursor(0));
            }

            // 5. 各プレイヤー/Botのプロット
            for (Player p : players) {
                if (p == null || !p.isOnline() || !p.getWorld().equals(viewer.getWorld())) continue;

                Location pLoc = p.getLocation();
                double relX = pLoc.getX() - viewerLoc.getX();
                double relZ = pLoc.getZ() - viewerLoc.getZ();

                // レーダー座標系への変換 (Z軸下方向が南)
                int mapX = 64 + (int) Math.round(relX / scale);
                int mapY = 64 + (int) Math.round(relZ / scale);

                // 境界クランプ (レーダー円の内部に収める)
                mapX = Math.max(8, Math.min(119, mapX));
                mapY = Math.max(8, Math.min(119, mapY));

                String name = p.getName();
                byte dotColor = COLOR_OTHER;
                String label = name.length() > 2 ? name.substring(0, 2) : name;

                if (p.equals(viewer)) {
                    dotColor = COLOR_USER;
                    label = "YOU";
                } else if (name.equalsIgnoreCase("Gemini")) {
                    dotColor = COLOR_GEMINI;
                    label = "Gm";
                } else if (name.equalsIgnoreCase("ChatGPT")) {
                    dotColor = COLOR_CHATGPT;
                    label = "GPT";
                } else if (name.equalsIgnoreCase("Claude")) {
                    dotColor = COLOR_CLAUDE;
                    label = "Cld";
                } else if (name.equalsIgnoreCase("Grok")) {
                    dotColor = COLOR_GROK;
                    label = "Grk";
                }

                // 3x3 のマーカードットを描画
                for (int ox = -1; ox <= 1; ox++) {
                    for (int oy = -1; oy <= 1; oy++) {
                        canvas.setPixel(mapX + ox, mapY + oy, dotColor);
                    }
                }

                // ラベル表示 (重なり防止のため少しオフセット)
                int textX = Math.min(108, mapX + 3);
                int textY = Math.min(115, Math.max(5, mapY - 3));
                canvas.drawText(textX, textY, MinecraftFont.Font, "§17;" + label);

                // MapCursor（プレイヤー向き矢印）の追加（安全な例外保護）
                try {
                    byte cursorX = (byte) ((mapX - 64) * 2);
                    byte cursorY = (byte) ((mapY - 64) * 2);
                    byte cursorDir = (byte) Math.floorMod((int) (pLoc.getYaw() * 16.0 / 360.0), 16);
                    MapCursor.Type cType = p.equals(viewer) ? MapCursor.Type.PLAYER : MapCursor.Type.BLUE_MARKER;
                    cursors.addCursor(new MapCursor(cursorX, cursorY, cursorDir, cType, true));
                } catch (Throwable ignored) {}
            }
        } catch (Throwable t) {
            // レンダリング例外でサーバーが止まらないよう安全にキャッチ
        }
    }
}

