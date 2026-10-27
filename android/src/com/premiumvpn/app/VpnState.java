package com.premiumvpn.app;

import org.json.JSONObject;

/** Current connection state, shared by the service, the screen and the tile. */
final class VpnState {
    static volatile String s = "off"; // off | connecting | on | weak | reconnecting | error
    static volatile String msg = "";
    static volatile String name = "";
    static volatile String serverId = "";
    static volatile String ip = "";
    static volatile String loc = "";
    static volatile int ms;
    static volatile long since;
    static volatile long down, up, rateDown, rateUp; // bytes since connect, bytes in the last second
    static volatile Runnable tileListener;

    static synchronized void set(String state, String message) {
        boolean wasOn = "on".equals(s) || "weak".equals(s) || "reconnecting".equals(s);
        if ("on".equals(state) && !wasOn) since = System.currentTimeMillis();
        if (!"on".equals(state) && !"weak".equals(state) && !"reconnecting".equals(state)) {
            rateDown = rateUp = 0;
            if (!"connecting".equals(state)) ip = loc = "";
        }
        s = state;
        msg = message == null ? "" : message;
        Runnable t = tileListener;
        if (t != null) t.run();
    }

    static boolean active() {
        return "on".equals(s) || "weak".equals(s) || "connecting".equals(s) || "reconnecting".equals(s);
    }

    static String json() {
        try {
            JSONObject o = new JSONObject();
            o.put("s", s);
            o.put("msg", msg);
            o.put("name", name);
            o.put("id", serverId);
            o.put("ip", ip);
            o.put("loc", loc);
            o.put("ms", ms);
            o.put("since", since);
            o.put("down", down);
            o.put("up", up);
            o.put("rd", rateDown);
            o.put("ru", rateUp);
            return o.toString();
        } catch (Exception e) {
            return "{\"s\":\"off\"}";
        }
    }

    static void traffic(long d, long u, long rd, long ru) {
        down = d;
        up = u;
        rateDown = rd;
        rateUp = ru;
    }
}
