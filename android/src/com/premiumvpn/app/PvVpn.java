package com.premiumvpn.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.net.Network;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.system.Os;
import android.system.OsConstants;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.security.SecureRandom;

/**
 * The phone's VPN: Android gives us a tunnel, the Go core (sing-box + Xray) carries it to the server.
 * The app itself is left out of its own tunnel, so the core reaches the server directly.
 */
public class PvVpn extends VpnService {
    static final String ACTION_START = "com.premiumvpn.app.START";
    static final String ACTION_STOP = "com.premiumvpn.app.STOP";
    static final String EXTRA_PARAMS = "params";
    private static final int NOTIF_ID = 1;

    private final Object lock = new Object();
    private int gen;
    private ParcelFileDescriptor tun;
    private Process proc;
    private LocalServerSocket server;
    private LocalSocket sock;
    private OutputStream sockOut;
    private ConnectivityManager.NetworkCallback netCb;
    private volatile int retries;
    private volatile boolean reachedOn;

    static void start(Context c, String params) {
        Intent i = new Intent(c, PvVpn.class).setAction(ACTION_START);
        if (params != null) i.putExtra(EXTRA_PARAMS, params);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.startService(new Intent(c, PvVpn.class).setAction(ACTION_STOP));
    }

    static File lastParams(Context c) {
        return new File(c.getFilesDir(), "last.json");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            foreground("Отключаюсь…");
            new Thread(new Runnable() {
                public void run() {
                    shutdown(null);
                }
            }).start();
            return START_NOT_STICKY;
        }
        String params = intent == null ? null : intent.getStringExtra(EXTRA_PARAMS);
        if (params == null) params = Core.readFile(lastParams(this)); // always-on VPN or the tile
        else Core.writeFile(lastParams(this), params);
        foreground("Подключаюсь…");
        if (params == null) {
            VpnState.set("error", "Сначала выберите сервер в приложении");
            stopSelfNow();
            return START_NOT_STICKY;
        }
        final String p = params;
        final int my;
        synchronized (lock) {
            my = ++gen;
        }
        retries = 0;
        reachedOn = false;
        new Thread(new Runnable() {
            public void run() {
                session(my, p);
            }
        }).start();
        return START_STICKY;
    }

    @Override
    public void onRevoke() {
        new Thread(new Runnable() {
            public void run() {
                shutdown(null);
            }
        }).start();
    }

    @Override
    public void onDestroy() {
        stopCore();
        super.onDestroy();
    }

    private void session(int my, String params) {
        stopCore(); // a new server replaces the old session
        String name = "";
        try {
            JSONObject p = new JSONObject(params);
            JSONObject srv = p.optJSONObject("server");
            JSONObject set = p.optJSONObject("settings");
            if (set == null) set = new JSONObject();
            if (srv != null) name = srv.optString("name");
            VpnState.name = name;
            VpnState.serverId = srv == null ? "" : srv.optString("id");
            VpnState.ms = 0;
            if (!"reconnecting".equals(VpnState.s)) VpnState.set("connecting", "");
            VpnState.traffic(0, 0, 0, 0);

            Builder b = new Builder();
            b.setSession("Премиум VPN");
            b.setMtu(9000);
            b.addAddress("172.19.0.1", 30);
            b.addRoute("0.0.0.0", 0);
            b.addDnsServer("172.19.0.2");
            try { // IPv6 goes into the tunnel too, so it never leaks past the VPN
                b.addAddress("fdfe:dcba:9876::1", 126);
                b.addRoute("::", 0);
            } catch (Exception ignored) {
            }
            apps(b, set);
            if (Build.VERSION.SDK_INT >= 29) b.setMetered(false);
            b.setConfigureIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE));
            ParcelFileDescriptor t = b.establish();
            if (t == null) {
                fail(my, "Android не дал включить VPN. Откройте приложение и разрешите");
                return;
            }
            byte[] rnd = new byte[8];
            new SecureRandom().nextBytes(rnd);
            StringBuilder ctl = new StringBuilder("pvpn_");
            for (byte x : rnd) ctl.append(String.format("%02x", x));
            LocalServerSocket ss = new LocalServerSocket(ctl.toString());
            p.put("ctl", ctl.toString());
            p.put("data", getFilesDir().getPath());
            File runFile = new File(getFilesDir(), "run.json");
            Core.writeFile(runFile, p.toString());

            ProcessBuilder pb = new ProcessBuilder(Core.path(this), "run", runFile.getPath());
            Core.env(this, pb.environment());
            pb.redirectErrorStream(true);
            pb.redirectOutput(ProcessBuilder.Redirect.appendTo(Core.logFile(this)));
            trimLog();
            Process pr = pb.start();
            synchronized (lock) {
                if (my != gen) {
                    pr.destroy();
                    ss.close();
                    t.close();
                    return;
                }
                tun = t;
                proc = pr;
                server = ss;
            }
            watchProcess(my, pr);

            LocalSocket s = ss.accept();
            OutputStream out = s.getOutputStream();
            synchronized (lock) {
                if (my != gen) {
                    s.close();
                    return;
                }
                sock = s;
                sockOut = out;
            }
            s.setFileDescriptorsForSend(new FileDescriptor[]{t.getFileDescriptor()});
            out.write((Core.netState(this).toString() + "\n").getBytes("UTF-8"));
            out.flush();
            s.setFileDescriptorsForSend(null);
            watchNetwork(my);

            BufferedReader r = new BufferedReader(new InputStreamReader(s.getInputStream(), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                if (my != gen) return;
                JSONObject m = new JSONObject(line);
                String type = m.optString("t");
                if ("traffic".equals(type)) {
                    VpnState.traffic(m.optLong("down"), m.optLong("up"), m.optLong("rd"), m.optLong("ru"));
                } else if ("info".equals(type)) {
                    VpnState.ip = m.optString("ip");
                    VpnState.loc = m.optString("loc");
                } else if ("state".equals(type)) {
                    String st = m.optString("s");
                    if (m.has("ms")) VpnState.ms = m.optInt("ms");
                    if ("on".equals(st)) {
                        reachedOn = true;
                        retries = 0;
                    }
                    VpnState.set(st, "");
                    if ("on".equals(st)) foreground("Защищено · " + clean(name));
                    else if ("weak".equals(st)) foreground("Связь слабая · " + clean(name));
                } else if ("err".equals(type)) {
                    fail(my, m.optString("m"));
                    return;
                }
            }
            if (my == gen) fail(my, lastLogLine());
        } catch (Exception e) {
            if (my == gen) fail(my, "Ошибка: " + e.getMessage());
        }
    }

    private void watchProcess(final int my, final Process pr) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    pr.waitFor();
                } catch (InterruptedException ignored) {
                }
                synchronized (lock) {
                    if (my != gen || proc != pr) return;
                }
                fail(my, lastLogLine());
            }
        }).start();
    }

    private void watchNetwork(final int my) {
        final ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                push();
            }

            @Override
            public void onLost(Network network) {
                push();
            }

            @Override
            public void onLinkPropertiesChanged(Network network, android.net.LinkProperties lp) {
                push();
            }

            private void push() {
                try {
                    JSONObject st = Core.netState(PvVpn.this);
                    st.put("t", "net");
                    synchronized (lock) {
                        if (my != gen || sockOut == null) return;
                        sockOut.write((st.toString() + "\n").getBytes("UTF-8"));
                        sockOut.flush();
                    }
                } catch (Exception ignored) {
                }
            }
        };
        try {
            cm.registerDefaultNetworkCallback(cb);
            synchronized (lock) {
                netCb = cb;
            }
        } catch (Exception ignored) {
        }
    }

    private void fail(int my, final String msg) {
        final String why = msg == null || msg.isEmpty() ? "Соединение прервалось" : msg;
        final String params = Core.readFile(lastParams(this));
        final int next;
        synchronized (lock) {
            if (my != gen) return;
            boolean again = reachedOn && retries < 5 && params != null && autoReconnect(params);
            next = again ? ++gen : -1;
        }
        if (next < 0) {
            shutdown(why);
            return;
        }
        retries++; // the link was up: bring it back, as on Windows («Авто-переподключение»)
        stopCore();
        VpnState.set("reconnecting", why);
        foreground("Переподключаюсь…");
        final long wait = 2000L * retries;
        new Thread(new Runnable() {
            public void run() {
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException ignored) {
                }
                synchronized (lock) {
                    if (next != gen) return;
                }
                session(next, params);
            }
        }).start();
    }

    private static boolean autoReconnect(String params) {
        try {
            JSONObject set = new JSONObject(params).optJSONObject("settings");
            return set == null || set.optBoolean("autoReconnect", true);
        } catch (Exception e) {
            return false;
        }
    }

    /** «Программы»: all apps, all but the list, or only the list go through the VPN. */
    private void apps(Builder b, JSONObject set) throws Exception {
        String mode = set.optString("appMode", "all");
        String[] list = set.optString("apps", "").split("[\\s,;]+");
        String me = getPackageName();
        if ("only".equals(mode)) {
            int n = 0;
            for (String a : list) {
                if (a.isEmpty() || a.equals(me)) continue;
                try {
                    b.addAllowedApplication(a);
                    n++;
                } catch (Exception ignored) { // not installed
                }
            }
            if (n > 0) return; // the app itself is outside the list, so the core reaches the server directly
        }
        b.addDisallowedApplication(me);
        if ("bypass".equals(mode)) {
            for (String a : list) {
                if (a.isEmpty() || a.equals(me)) continue;
                try {
                    b.addDisallowedApplication(a);
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void shutdown(String err) {
        synchronized (lock) {
            gen++;
        }
        stopCore();
        VpnState.set(err == null ? "off" : "error", err);
        stopSelfNow();
    }

    /** Stops the core and closes the tunnel; the service may start a new session right after. */
    private void stopCore() {
        Process pr;
        LocalSocket s;
        LocalServerSocket ss;
        ParcelFileDescriptor t;
        ConnectivityManager.NetworkCallback cb;
        synchronized (lock) {
            pr = proc;
            s = sock;
            ss = server;
            t = tun;
            cb = netCb;
            if (sockOut != null) {
                try {
                    sockOut.write("{\"t\":\"stop\"}\n".getBytes("UTF-8"));
                    sockOut.flush();
                } catch (Exception ignored) {
                }
            }
            proc = null;
            sock = null;
            sockOut = null;
            server = null;
            tun = null;
            netCb = null;
        }
        if (cb != null) {
            try {
                ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(cb);
            } catch (Exception ignored) {
            }
        }
        if (pr != null) {
            for (int i = 0; i < 30 && pr.isAlive(); i++) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ignored) {
                }
            }
            pr.destroy();
        }
        try {
            if (s != null) s.close();
        } catch (Exception ignored) {
        }
        if (ss != null) {
            try { // wakes a pending accept()
                Os.shutdown(ss.getFileDescriptor(), OsConstants.SHUT_RDWR);
            } catch (Exception ignored) {
            }
            try {
                ss.close();
            } catch (Exception ignored) {
            }
        }
        try {
            if (t != null) t.close();
        } catch (Exception ignored) {
        }
    }

    private void stopSelfNow() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    private String lastLogLine() {
        String[] lines = Core.tail(Core.logFile(this), 6).split("\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String l = lines[i].trim();
            if (l.startsWith("ошибка:")) return l.substring(7).trim();
        }
        return "Ядро VPN остановилось. Подробности в разделе «Журнал»";
    }

    private void trimLog() {
        File f = Core.logFile(this);
        if (f.length() > 512 * 1024) Core.writeFile(f, Core.tail(f, 400));
    }

    private static String clean(String n) {
        return n.replaceAll("[\\x{1F1E6}-\\x{1F1FF}]", "").trim();
    }

    private void foreground(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel("vpn", "VPN", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent off = PendingIntent.getService(this, 1, new Intent(this, PvVpn.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "vpn") : new Notification.Builder(this);
        Notification n = nb.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Премиум VPN")
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setColor(0xFFFF2A47)
                .addAction(new Notification.Action.Builder(null, "Отключить", off).build())
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
    }
}
