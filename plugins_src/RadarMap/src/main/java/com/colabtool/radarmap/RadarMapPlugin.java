package com.colabtool.radarmap;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.map.MapRenderer;
import org.bukkit.map.MapView;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Arrays;
import java.util.List;

public class RadarMapPlugin extends JavaPlugin implements Listener, CommandExecutor {

    private MapView radarMapView;
    private static final String RADAR_NAME = "§b🧭 全員位置レーダー地図 (Live Radar)";

    @Override
    public void onEnable() {
        getLogger().info("RadarMapPlugin starting on Minecraft 1.21.1...");
        saveDefaultConfig();

        // サーバー起動完了後に MapView の取得または新規作成を行う
        Bukkit.getScheduler().runTaskLater(this, this::initializeMapView, 20L);

        // 未所持プレイヤー・AI仲間への定期自動配布 (5秒ごと)
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            if (radarMapView != null) {
                for (Player p : Bukkit.getOnlinePlayers()) {
                    giveRadarMap(p, false);
                }
            }
        }, 60L, 100L);

        getServer().getPluginManager().registerEvents(this, this);
        if (getCommand("radar") != null) {
            getCommand("radar").setExecutor(this);
        }

        getLogger().info("RadarMapPlugin enabled successfully!");
    }

    private synchronized void initializeMapView() {
        try {
            World world = Bukkit.getWorlds().isEmpty() ? null : Bukkit.getWorlds().get(0);
            if (world == null) {
                getLogger().warning("World not found yet, retrying map initialization in 2 seconds...");
                Bukkit.getScheduler().runTaskLater(this, this::initializeMapView, 40L);
                return;
            }

            int savedId = getConfig().getInt("radar-map-id", -1);
            MapView existing = null;
            if (savedId >= 0) {
                try {
                    existing = Bukkit.getMap(savedId);
                } catch (Throwable ignored) {}
            }

            if (existing != null) {
                radarMapView = existing;
                getLogger().info("Reused existing Radar MapView (ID: " + radarMapView.getId() + ")");
            } else {
                radarMapView = Bukkit.createMap(world);
                getConfig().set("radar-map-id", radarMapView.getId());
                saveConfig();
                getLogger().info("Created new Radar MapView (ID: " + radarMapView.getId() + ")");
            }

            // バニラ追跡アイコンを無効化し、カスタムレンダラーのみを適用
            radarMapView.setTrackingPosition(false);
            radarMapView.setUnlimitedTracking(true);

            // 既存レンダラーのクリアと RadarMapRenderer の適用
            boolean hasRadarRenderer = false;
            for (MapRenderer r : radarMapView.getRenderers()) {
                if (r instanceof RadarMapRenderer) {
                    hasRadarRenderer = true;
                } else {
                    radarMapView.removeRenderer(r);
                }
            }
            if (!hasRadarRenderer) {
                radarMapView.addRenderer(new RadarMapRenderer());
            }

            getLogger().info("RadarMapRenderer attached to Map ID: " + radarMapView.getId());

            // 接続中の全プレイヤー・AI仲間へ即座に配布
            for (Player p : Bukkit.getOnlinePlayers()) {
                giveRadarMap(p, false);
            }
        } catch (Throwable t) {
            getLogger().severe("Failed to initialize Radar MapView: " + t.getMessage());
            t.printStackTrace();
        }
    }

    public ItemStack createRadarMapItem() {
        ItemStack item = new ItemStack(Material.FILLED_MAP);
        MapMeta meta = (MapMeta) item.getItemMeta();
        if (meta != null && radarMapView != null) {
            meta.setMapView(radarMapView);
            meta.setDisplayName(RADAR_NAME);
            meta.setLore(Arrays.asList(
                    "§7自分と全AI仲間の現在位置をリアルタイム表示",
                    "§7遠くに離れても自動で縮尺調整されます",
                    "§e左手(Fキー)に持つと常に視界に表示されます"
            ));
            item.setItemMeta(meta);
        }
        return item;
    }

    public void giveRadarMap(Player player, boolean forceMessage) {
        if (radarMapView == null) {
            initializeMapView();
            if (radarMapView == null) return;
        }

        // すでに最新のレーダー地図を持っているか確認
        boolean alreadyHas = false;
        ItemStack[] contents = player.getInventory().getContents();
        for (int i = 0; i < contents.length; i++) {
            ItemStack is = contents[i];
            if (is != null && is.getType() == Material.FILLED_MAP) {
                MapMeta m = (MapMeta) is.getItemMeta();
                if (m != null && m.hasMapView() && m.getMapView() != null) {
                    if (m.getMapView().getId() == radarMapView.getId()) {
                        alreadyHas = true;
                        break;
                    } else if (m.hasDisplayName() && m.getDisplayName().contains("レーダー地図")) {
                        // 古いIDのレーダー地図を持っていた場合は最新版に更新
                        m.setMapView(radarMapView);
                        is.setItemMeta(m);
                        alreadyHas = true;
                        break;
                    }
                }
            }
        }

        if (alreadyHas && !forceMessage) {
            return;
        }

        if (!alreadyHas) {
            ItemStack mapItem = createRadarMapItem();
            // オフハンドが空いていればオフハンドに直接装備、そうでなければインベントリに追加
            if (player.getInventory().getItemInOffHand().getType() == Material.AIR) {
                player.getInventory().setItemInOffHand(mapItem);
            } else {
                player.getInventory().addItem(mapItem);
            }
        }

        player.sendMessage("§a[Radar] §f自動縮尺レーダー地図を受け取りました！(左手[Fキー]に持つと便利です)");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(this, () -> {
            giveRadarMap(event.getPlayer(), false);
        }, 20L);
    }

    @EventHandler
    public void onPlayerRespawn(PlayerRespawnEvent event) {
        Bukkit.getScheduler().runTaskLater(this, () -> {
            giveRadarMap(event.getPlayer(), false);
        }, 20L);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player) {
            Player p = (Player) sender;
            giveRadarMap(p, true);
            return true;
        }
        sender.sendMessage("This command can only be used by players.");
        return true;
    }
}

