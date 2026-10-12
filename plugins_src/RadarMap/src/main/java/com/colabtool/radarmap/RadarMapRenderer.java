package com.colabtool.radarmap;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.map.*;

import java.util.Collection;

public class RadarMapRenderer extends MapRenderer {

    // カラーパレット定数 (MapPalette)
    private static final byte COLOR_BG = (byte) 119;        // 濃いグレー/ブラック
    private static final byte COLOR_GRID = (byte) 140;      // グリッド線
    private static final byte COLOR_CROSSHAIR = (byte) 142;  // 照準線
    private static final byte COLOR_USER = (byte) 34;       // 明るいグリーン
    private static final byte COLOR_GEMINI = (byte) 54;     // ブルー
    private static final byte COLOR_CHATGPT = (byte) 78;    // シアン
    private static final byte COLOR_CLAUDE = (byte) 66;     // マゼンタ/パープル
    private static final byte COLOR_GROK = (byte) 42;       // ゴールド/オレンジ
    private static final byte COLOR_OTHER = (byte) 18;      // レッド

    public RadarMapRenderer() {
        super(true); // contextual: プレイヤーごとに個別描画
    }

    @Override
    public void render(MapView map, MapCanvas canvas, Player viewer) {
        Location viewerLoc = viewer.getLocation();
        Collection<? extends Player> players = Bukkit.getOnlinePlayers();

        // 1. 最大距離を計測して動的スケール(Auto-Scale)を算出
        double maxDist = 40.0; // 最小探知半径 (近距離時はズーム)
        for (Player p : players) {
            if (p.getWorld().equals(viewer.getWorld())) {
                double dist = p.getLocation().distance(viewerLoc);
                if (dist > maxDist) {
                    maxDist = dist;
                }
            }
        }
        // 128x128画面の中心(64,64)から半径54px以内に全プレイヤーが収まるスケール
        double scale = (maxDist + 15.0) / 54.0;

        // 2. 背景・グリッド・レーダー円の描画
        for (int x = 0; x < 128; x++) {
            for (int y = 0; y < 128; y++) {
                int dx = x - 64;
                int dy = y - 64;
                int r2 = dx * dx + dy * dy;

                if (r2 > 58 * 58) {
                    canvas.setPixel(x, y, (byte) 0); // 外枠は黒
                } else if (r2 >= 57 * 57 || r2 == 38 * 38 || r2 == 19 * 19) {
                    canvas.setPixel(x, y, COLOR_GRID); // レーダー円
                } else if (x == 64 || y == 64) {
                    canvas.setPixel(x, y, COLOR_CROSSHAIR); // 十字線
                } else {
                    canvas.setPixel(x, y, COLOR_BG); // 背景色
                }
            }
        }

        // 方角表示 (N, S, E, W)
        canvas.drawText(62, 7, MinecraftFont.Font, "§18;N");
        canvas.drawText(62, 115, MinecraftFont.Font, "§18;S");
        canvas.drawText(116, 61, MinecraftFont.Font, "§18;E");
        canvas.drawText(8, 61, MinecraftFont.Font, "§18;W");

        // 3. タイトル & レンジ情報
        canvas.drawText(4, 2, MinecraftFont.Font, "§17;LIVE RADAR");
        canvas.drawText(4, 118, MinecraftFont.Font, "§20;R:" + (int) maxDist + "m");
        canvas.drawText(75, 118, MinecraftFont.Font, "§20;" + (int) viewerLoc.getX() + "," + (int) viewerLoc.getZ());

        // 4. クルソルのクリアと再設定
        MapCursorCollection cursors = canvas.getCursors();
        while (cursors.size() > 0) {
            cursors.removeCursor(cursors.getCursor(0));
        }

        // 5. 各プレイヤー/Botのプロット
        for (Player p : players) {
            if (!p.getWorld().equals(viewer.getWorld())) continue;

            Location pLoc = p.getLocation();
            double relX = pLoc.getX() - viewerLoc.getX();
            double relZ = pLoc.getZ() - viewerLoc.getZ();

            // レーダー座標系への変換 (Z軸下方向が南)
            int mapX = 64 + (int) Math.round(relX / scale);
            int mapY = 64 + (int) Math.round(relZ / scale);

            // 境界クランプ (万が一の画面外も端に表示)
            mapX = Math.max(6, Math.min(121, mapX));
            mapY = Math.max(6, Math.min(121, mapY));

            String name = p.getName();
            byte dotColor = COLOR_OTHER;
            String label = name.substring(0, Math.min(2, name.length()));

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
            int textY = Math.min(115, Math.max(4, mapY - 3));
            canvas.drawText(textX, textY, MinecraftFont.Font, "§17;" + label);

            // MapCursor（プレイヤー向き矢印）の追加
            // byte x, y (-128 ~ 127), direction (0 ~ 15)
            byte cursorX = (byte) ((mapX - 64) * 2);
            byte cursorY = (byte) ((mapY - 64) * 2);
            byte cursorDir = (byte) Math.floorMod((int) (pLoc.getYaw() * 16.0 / 360.0), 16);
            MapCursor.Type cType = p.equals(viewer) ? MapCursor.Type.WHITE_POINTER : MapCursor.Type.BLUE_POINTER;
            cursors.addCursor(new MapCursor(cursorX, cursorY, cursorDir, cType, true));
        }
    }
}
