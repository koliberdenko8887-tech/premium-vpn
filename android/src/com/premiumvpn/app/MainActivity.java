package com.premiumvpn.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.provider.Settings;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.List;
import java.util.zip.GZIPInputStream;

/** The screen is the Windows app's page (ui/desktop.html, adapted by ui/build_phone.py) in a WebView; PV is its bridge. */
public class MainActivity extends Activity {
    private static final int REQ_VPN = 1;
    private WebView web;
    private String pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF060606);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "PV");
        setContentView(web);
        web.loadUrl("file:///android_asset/app.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("window.pvResume&&pvResume()");
    }

    private static String model; // the 3D people, read once from assets

    private String modelText() {
        synchronized (MainActivity.class) {
            if (model == null) {
                try { // aapt unpacks girls3d.json.gz into assets/girls3d.json
                    model = Core.readAll(getAssets().open("girls3d.json"));
                } catch (Exception e) {
                    try {
                        model = Core.readAll(new GZIPInputStream(getAssets().open("girls3d.json.gz"), 65536));
                    } catch (Exception e2) {
                        model = "";
                    }
                }
            }
            return model;
        }
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(code, null);
            }
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_VPN) {
            if (res == RESULT_OK && pending != null) PvVpn.start(this, pending);
            else VpnState.set("error", "Без разрешения Android VPN не включить");
            pending = null;
        }
    }

    @Override
    public void onBackPressed() { // the page closes an open sheet or goes home first
        web.evaluateJavascript("window.pvBack?pvBack():false", new android.webkit.ValueCallback<String>() {
            public void onReceiveValue(String v) {
                if (!"true".equals(v)) moveTaskToBack(true);
            }
        });
    }

    final class Bridge {
        @JavascriptInterface
        public void call(final String cmd, final String arg, final String id) {
            new Thread(new Runnable() {
                public void run() {
                    String out;
                    if ("sub".equals(cmd)) out = Core.run(MainActivity.this, "sub", arg, null);
                    else out = Core.run(MainActivity.this, cmd, null, arg);
                    js("pvCb(" + JSONObject.quote(id) + "," + JSONObject.quote(out) + ")");
                }
            }).start();
        }

        @JavascriptInterface
        public void connect(final String params) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = VpnService.prepare(MainActivity.this);
                    if (i != null) {
                        pending = params;
                        startActivityForResult(i, REQ_VPN);
                    } else {
                        PvVpn.start(MainActivity.this, params);
                    }
                }
            });
        }

        @JavascriptInterface
        public void disconnect() {
            PvVpn.stop(MainActivity.this);
        }

        @JavascriptInterface
        public String state() {
            return VpnState.json();
        }

        @JavascriptInterface
        public String log() {
            return Core.tail(Core.logFile(MainActivity.this), 400);
        }

        @JavascriptInterface
        public void env(String ua, boolean hwid) {
            Core.ua = ua;
            Core.hwid = hwid;
        }

        @JavascriptInterface
        public void clearLogs() {
            Core.writeFile(Core.logFile(MainActivity.this), "");
        }

        /** The model in parts of 256 K characters, like pvModelPart on Windows; "" after the last one. */
        @JavascriptInterface
        public String modelPart(int i) {
            String m = modelText();
            int a = i * 262144;
            if (a >= m.length()) return "";
            return m.substring(a, Math.min(m.length(), a + 262144));
        }

        /** stats.json and live.json written by the core while the VPN is on. */
        @JavascriptInterface
        public String data(String name) {
            if (!"stats.json".equals(name) && !"live.json".equals(name)) return "";
            String s = Core.readFile(new File(getFilesDir(), name));
            return s == null ? "" : s;
        }

        @JavascriptInterface
        public void resetStats() {
            new File(getFilesDir(), "stats.json").delete();
            if (VpnState.active()) Core.writeFile(new File(getFilesDir(), "stats.reset"), "1");
        }

        /** The status and navigation bars take the theme's colour. */
        @JavascriptInterface
        public void theme(final String color) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        int c = Color.parseColor(color);
                        Window w = getWindow();
                        w.setStatusBarColor(c);
                        w.setNavigationBarColor(c);
                        web.setBackgroundColor(c);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** Android's own VPN page: «Постоянная VPN» and «Блокировать соединения без VPN». */
        @JavascriptInterface
        public void vpnSettings() {
            try {
                startActivity(new Intent(Settings.ACTION_VPN_SETTINGS));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
            }
        }

        /** Installed apps with an icon on the home screen: [{"p": package, "l": label}]. */
        @JavascriptInterface
        public String apps() {
            JSONArray out = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
                java.util.TreeMap<String, String> sorted = new java.util.TreeMap<String, String>(String.CASE_INSENSITIVE_ORDER);
                for (ResolveInfo r : list) {
                    String p = r.activityInfo.packageName;
                    if (p.equals(getPackageName())) continue;
                    String l = String.valueOf(r.loadLabel(pm));
                    sorted.put(l + "\u0000" + p, p);
                }
                for (java.util.Map.Entry<String, String> e : sorted.entrySet()) {
                    JSONObject o = new JSONObject();
                    o.put("p", e.getValue());
                    o.put("l", e.getKey().substring(0, e.getKey().indexOf('\u0000')));
                    out.put(o);
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String clipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData c = cm.getPrimaryClip();
                if (c == null || c.getItemCount() == 0) return "";
                CharSequence t = c.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
