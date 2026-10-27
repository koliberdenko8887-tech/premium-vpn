package com.premiumvpn.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** «Премиум VPN» button in the quick settings shade. */
public class PvTile extends TileService {
    @Override
    public void onStartListening() {
        VpnState.tileListener = new Runnable() {
            public void run() {
                update();
            }
        };
        update();
    }

    @Override
    public void onStopListening() {
        VpnState.tileListener = null;
    }

    @Override
    public void onClick() {
        if (VpnState.active()) {
            PvVpn.stop(this);
            return;
        }
        if (VpnService.prepare(this) != null || Core.readFile(PvVpn.lastParams(this)) == null) {
            Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE));
            } else {
                startActivityAndCollapse(i);
            }
            return;
        }
        PvVpn.start(this, null);
    }

    private void update() {
        Tile t = getQsTile();
        if (t == null) return;
        String s = VpnState.s;
        t.setState(VpnState.active() ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= 29) {
            t.setSubtitle("on".equals(s) ? "Защищено" : "connecting".equals(s) ? "Подключаюсь…" : "weak".equals(s) ? "Связь слабая" : "Выключен");
        }
        t.updateTile();
    }
}
