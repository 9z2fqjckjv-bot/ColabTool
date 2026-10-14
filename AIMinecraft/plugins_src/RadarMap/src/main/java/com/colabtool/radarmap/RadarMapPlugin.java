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

public class RadarMapPlugin extends JavaPlugin implements Listener, CommandExecutor {

    private MapView radarMapView;

    @Override
    public void onEnable() {
        getLogger().info("RadarMapPlugin starting...");

        // ワールドの取得とカスタムMapViewの作成
        Bukkit.getScheduler().runTaskLater(this, () -> {
            World world = Bukkit.getWorlds().isEmpty() ? null : Bukkit.getWorlds().get(0);
            if (world != null) {
                radarMapView = Bukkit.createMap(world);
                // 既存の標準地形レンダラーを削除
                for (MapRenderer r : radarMapView.getRenderers()) {
                    radarMapView.removeRenderer(r);
                }
                radarMapView.addRenderer(new RadarMapRenderer());
                getLogger().info("Radar Map initialized successfully (Map ID: " + radarMapView.getId() + ")");
                // 接続中の全プレイヤー・AI仲間へ即座に配布
                for (Player p : Bukkit.getOnlinePlayers()) {
                    giveRadarMap(p);
                }
            }
        }, 10L);

        // 未所持プレイヤーへの定期自動配布 (5秒ごと)
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            if (radarMapView != null) {
                for (Player p : Bukkit.getOnlinePlayers()) {
                    giveRadarMap(p);
                }
            }
        }, 40L, 100L);

        getServer().getPluginManager().registerEvents(this, this);
        if (getCommand("radar") != null) {
            getCommand("radar").setExecutor(this);
        }

        getLogger().info("RadarMapPlugin enabled!");
    }

    private ItemStack createRadarMapItem() {
        ItemStack item = new ItemStack(Material.FILLED_MAP);
        MapMeta meta = (MapMeta) item.getItemMeta();
        if (meta != null && radarMapView != null) {
            meta.setMapView(radarMapView);
            meta.setDisplayName("§b🧭 全員位置レーダー地図 (Live Radar)");
            meta.setLore(Arrays.asList(
                    "§7自分と全AI仲間の現在位置をリアルタイム表示",
                    "§7遠くに離れても自動で縮尺調整されます",
                    "§e左手(Fキー)に持つと常に視界に表示されます"
            ));
            item.setItemMeta(meta);
        }
        return item;
    }

    private void giveRadarMap(Player player) {
        if (radarMapView == null) return;

        // すでにレーダー地図を持っているか確認
        for (ItemStack is : player.getInventory().getContents()) {
            if (is != null && is.getType() == Material.FILLED_MAP) {
                MapMeta m = (MapMeta) is.getItemMeta();
                if (m != null && m.hasMapView() && m.getMapView() != null && m.getMapView().getId() == radarMapView.getId()) {
                    return; // 既に所持
                }
            }
        }

        ItemStack mapItem = createRadarMapItem();
        // オフハンドが空いていればオフハンドに装備、そうでなければインベントリに追加
        if (player.getInventory().getItemInOffHand().getType() == Material.AIR) {
            player.getInventory().setItemInOffHand(mapItem);
        } else {
            player.getInventory().addItem(mapItem);
        }
        player.sendMessage("§a[Radar] §f自動縮尺レーダー地図を受け取りました！(左手[Fキー]に持つと便利です)");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(this, () -> {
            giveRadarMap(event.getPlayer());
        }, 30L);
    }

    @EventHandler
    public void onPlayerRespawn(PlayerRespawnEvent event) {
        Bukkit.getScheduler().runTaskLater(this, () -> {
            giveRadarMap(event.getPlayer());
        }, 30L);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player) {
            Player p = (Player) sender;
            giveRadarMap(p);
            p.sendMessage("§a[Radar] §fレーダー地図を再配布しました。");
            return true;
        }
        sender.sendMessage("This command can only be used by players.");
        return true;
    }
}
