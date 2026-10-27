package com.premiumvpn.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.List;
import java.util.Map;

/** Runs the Go core (lib/arm64-v8a/libpvcore.so: sing-box + Xray). */
final class Core {
    static volatile String ua = "";      // «User-Agent» for subscriptions, empty = automatic
    static volatile boolean hwid = true; // «Отправлять ID устройства»

    static String path(Context c) {
        return c.getApplicationInfo().nativeLibraryDir + "/libpvcore.so";
    }

    static File logFile(Context c) {
        return new File(c.getFilesDir(), "core.log");
    }

    static void env(Context c, Map<String, String> env) {
        StringBuilder dns = new StringBuilder();
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
            if (lp != null) {
                for (InetAddress a : lp.getDnsServers()) {
                    if (dns.length() > 0) dns.append(',');
                    dns.append(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
        }
        env.put("PV_DNS", dns.toString());
        env.put("PV_UA", ua == null ? "" : ua);
        String id = hwid ? Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ANDROID_ID) : null;
        env.put("PV_HWID", id == null ? "" : id);
    }

    /** One-shot command (sub, parse, ping); returns its stdout. */
    static String run(Context c, String cmd, String arg, String stdin) {
        try {
            ProcessBuilder pb = arg == null ? new ProcessBuilder(path(c), cmd) : new ProcessBuilder(path(c), cmd, arg);
            env(c, pb.environment());
            pb.redirectError(ProcessBuilder.Redirect.appendTo(logFile(c)));
            Process p = pb.start();
            OutputStream os = p.getOutputStream();
            if (stdin != null) os.write(stdin.getBytes("UTF-8"));
            os.close();
            String out = readAll(p.getInputStream());
            p.waitFor();
            return out.trim().isEmpty() ? "{\"error\":\"Ядро не ответило\"}" : out.trim();
        } catch (Exception e) {
            return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
        }
    }

    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toString("UTF-8");
    }

    static String readFile(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            return readAll(in);
        } catch (Exception e) {
            return null;
        }
    }

    static void writeFile(File f, String s) {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(s.getBytes("UTF-8"));
        } catch (Exception ignored) {
        }
    }

    static String tail(File f, int lines) {
        String s = readFile(f);
        if (s == null) return "";
        String[] all = s.split("\n");
        StringBuilder b = new StringBuilder();
        for (int i = Math.max(0, all.length - lines); i < all.length; i++) b.append(all[i]).append('\n');
        return b.toString();
    }

    /** The phone's networks, for sing-box: Android 11+ hides netlink from apps. */
    static JSONObject netState(Context c) {
        JSONObject st = new JSONObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network active = cm.getActiveNetwork();
            JSONArray arr = new JSONArray();
            String def = "";
            int fake = 1000;
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                LinkProperties lp = cm.getLinkProperties(n);
                if (caps == null || lp == null || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                String name = lp.getInterfaceName();
                if (name == null) continue;
                int index = -1, mtu = 1500;
                try {
                    NetworkInterface ni = NetworkInterface.getByName(name);
                    if (ni != null) {
                        index = ni.getIndex();
                        mtu = ni.getMTU();
                    }
                } catch (Exception ignored) {
                }
                if (index <= 0) index = fake++;
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("index", index);
                o.put("mtu", mtu);
                JSONArray addrs = new JSONArray();
                List<LinkAddress> la = lp.getLinkAddresses();
                for (LinkAddress a : la) {
                    String h = a.getAddress().getHostAddress();
                    int pct = h.indexOf('%');
                    if (pct > 0) h = h.substring(0, pct);
                    addrs.put(h + "/" + a.getPrefixLength());
                }
                o.put("addrs", addrs);
                JSONArray dns = new JSONArray();
                for (InetAddress a : lp.getDnsServers()) dns.put(a.getHostAddress());
                o.put("dns", dns);
                String type = "other";
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "cellular";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "ethernet";
                o.put("type", type);
                o.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
                arr.put(o);
                if (n.equals(active)) def = name;
            }
            st.put("ifaces", arr);
            st.put("default", def);
        } catch (Exception ignored) {
        }
        return st;
    }
}
