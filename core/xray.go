package main

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

// xrayStream builds streamSettings from share-link parameters.
func xrayStream(q url.Values, host string) map[string]any {
	network := q.Get("type")
	if network == "" || network == "raw" {
		network = "tcp"
	}
	if network == "h2" {
		network = "http"
	}
	st := map[string]any{"network": network}
	sec := q.Get("security")
	sni := q.Get("sni")
	if sni == "" {
		sni = q.Get("peer")
	}
	fp := q.Get("fp")
	switch sec {
	case "tls":
		if sni == "" {
			sni = host
		}
		t := map[string]any{"serverName": sni}
		if fp != "" {
			t["fingerprint"] = fp
		}
		if a := q.Get("alpn"); a != "" {
			t["alpn"] = strings.Split(a, ",")
		}
		if q.Get("allowInsecure") == "1" || q.Get("insecure") == "1" {
			t["allowInsecure"] = true
		}
		st["security"], st["tlsSettings"] = "tls", t
	case "reality":
		if fp == "" {
			fp = "chrome"
		}
		r := map[string]any{"serverName": sni, "fingerprint": fp, "publicKey": q.Get("pbk"), "shortId": q.Get("sid")}
		if v := q.Get("spx"); v != "" {
			r["spiderX"] = v
		}
		if v := q.Get("pqv"); v != "" {
			r["mldsa65Verify"] = v
		}
		st["security"], st["realitySettings"] = "reality", r
	default:
		st["security"] = "none"
	}
	path, hostH := q.Get("path"), q.Get("host")
	switch network {
	case "ws":
		st["wsSettings"] = map[string]any{"path": path, "host": hostH}
	case "grpc":
		g := map[string]any{"serviceName": q.Get("serviceName")}
		if q.Get("mode") == "multi" {
			g["multiMode"] = true
		}
		if a := q.Get("authority"); a != "" {
			g["authority"] = a
		}
		st["grpcSettings"] = g
	case "httpupgrade":
		st["httpupgradeSettings"] = map[string]any{"path": path, "host": hostH}
	case "xhttp", "splithttp":
		st["network"] = "xhttp"
		x := map[string]any{"path": path, "host": hostH}
		if m := q.Get("mode"); m != "" {
			x["mode"] = m
		}
		if e := q.Get("extra"); e != "" {
			var extra any
			if json.Unmarshal([]byte(e), &extra) == nil {
				x["extra"] = extra
			}
		}
		st["xhttpSettings"] = x
	case "http":
		st["httpSettings"] = map[string]any{"path": path, "host": splitNonEmpty(hostH)}
	case "kcp", "mkcp":
		st["network"] = "kcp"
		k := map[string]any{"header": map[string]any{"type": orDefault(q.Get("headerType"), "none")}}
		if s := q.Get("seed"); s != "" {
			k["seed"] = s
		}
		st["kcpSettings"] = k
	case "tcp":
		if q.Get("headerType") == "http" {
			st["tcpSettings"] = map[string]any{"header": map[string]any{
				"type":    "http",
				"request": map[string]any{"path": []string{orDefault(path, "/")}, "headers": map[string]any{"Host": splitNonEmpty(hostH)}},
			}}
		}
	}
	return st
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

// linkToXray converts a share link into an Xray outbound.
func linkToXray(link string) (map[string]any, *Server, error) {
	link = strings.TrimSpace(link)
	s := &Server{Kind: "link"}
	ob := map[string]any{"tag": "proxy"}
	if strings.HasPrefix(link, "vmess://") {
		b, err := b64decode(strings.TrimPrefix(link, "vmess://"))
		if err != nil {
			return nil, nil, err
		}
		var v map[string]any
		if err := json.Unmarshal(b, &v); err != nil {
			return nil, nil, err
		}
		str := func(k string) string {
			switch x := v[k].(type) {
			case string:
				return x
			case float64:
				return strconv.Itoa(int(x))
			}
			return ""
		}
		port, _ := strconv.Atoi(str("port"))
		aid, _ := strconv.Atoi(str("aid"))
		s.Name, s.Host, s.Port, s.Proto = str("ps"), str("add"), port, "VMess"
		ob["protocol"] = "vmess"
		ob["settings"] = map[string]any{"vnext": []any{map[string]any{"address": s.Host, "port": port,
			"users": []any{map[string]any{"id": str("id"), "alterId": aid, "security": orDefault(str("scy"), "auto")}}}}}
		q := url.Values{}
		q.Set("type", str("net"))
		q.Set("host", str("host"))
		q.Set("path", str("path"))
		q.Set("serviceName", str("path"))
		q.Set("headerType", str("type"))
		if str("tls") == "tls" {
			q.Set("security", "tls")
			q.Set("sni", orDefault(str("sni"), str("host")))
			q.Set("fp", str("fp"))
			q.Set("alpn", str("alpn"))
		}
		ob["streamSettings"] = xrayStream(q, s.Host)
		return ob, s, nil
	}
	u, err := url.Parse(link)
	if err != nil {
		return nil, nil, err
	}
	s.Name, _ = url.PathUnescape(u.Fragment)
	q := u.Query()
	switch u.Scheme {
	case "vless":
		h, p, err := hostPort(u)
		if err != nil {
			return nil, nil, err
		}
		s.Host, s.Port, s.Proto = h, p, "VLESS"
		user := map[string]any{"id": u.User.Username(), "encryption": orDefault(q.Get("encryption"), "none")}
		if f := q.Get("flow"); f != "" {
			user["flow"] = f
		}
		ob["protocol"] = "vless"
		ob["settings"] = map[string]any{"vnext": []any{map[string]any{"address": h, "port": p, "users": []any{user}}}}
		ob["streamSettings"] = xrayStream(q, h)
	case "trojan":
		h, p, err := hostPort(u)
		if err != nil {
			return nil, nil, err
		}
		s.Host, s.Port, s.Proto = h, p, "Trojan"
		if q.Get("security") == "" {
			q.Set("security", "tls")
		}
		ob["protocol"] = "trojan"
		ob["settings"] = map[string]any{"servers": []any{map[string]any{"address": h, "port": p, "password": u.User.Username()}}}
		ob["streamSettings"] = xrayStream(q, h)
	case "ss":
		sv, err := parseLink(link) // reuse the Shadowsocks decoding
		if err != nil {
			return nil, nil, err
		}
		var so map[string]any
		json.Unmarshal(sv.Outbound, &so)
		s.Host, s.Port, s.Proto = sv.Host, sv.Port, "Shadowsocks"
		ob["protocol"] = "shadowsocks"
		ob["settings"] = map[string]any{"servers": []any{map[string]any{"address": sv.Host, "port": sv.Port, "method": so["method"], "password": so["password"]}}}
	default:
		return nil, nil, fmt.Errorf("не для Xray")
	}
	return ob, s, nil
}

// transportName gives a short label like "VLESS · Reality" for the server list.
func transportName(ob map[string]any) string {
	st, _ := ob["streamSettings"].(map[string]any)
	if st == nil {
		return ""
	}
	n, _ := st["network"].(string)
	sec, _ := st["security"].(string)
	parts := []string{}
	switch n {
	case "xhttp":
		parts = append(parts, "XHTTP")
	case "ws":
		parts = append(parts, "WS")
	case "grpc":
		parts = append(parts, "gRPC")
	}
	if sec == "reality" {
		parts = append(parts, "Reality")
	}
	return strings.Join(parts, " · ")
}

// parseLinkAny prefers Xray for the protocols it supports and falls back to sing-box.
func parseLinkAny(link string) (*Server, error) {
	ob, xs, xerr := linkToXray(link)
	ss, serr := parseLink(link)
	if xerr == nil {
		if ss == nil {
			ss = xs
		}
		ss.Name = orDefault(xs.Name, xs.Host)
		ss.Country = detectCountry(ss.Name)
		ss.Kind, ss.Host, ss.Port = "link", xs.Host, xs.Port
		ss.Proto = xs.Proto
		if t := transportName(ob); t != "" {
			ss.Proto += " · " + t
		}
		ss.Xray, _ = json.Marshal(map[string]any{"outbounds": []any{ob, map[string]any{"protocol": "freedom", "tag": "direct"}}})
		return ss, nil
	}
	if serr != nil {
		return nil, serr
	}
	return ss, nil
}

// parseXrayJSON reads a subscription that is a list of full Xray configs (one per server).
func parseXrayJSON(body []byte) []*Server {
	var list []map[string]any
	if err := json.Unmarshal(body, &list); err != nil {
		var one map[string]any
		if json.Unmarshal(body, &one) != nil {
			return nil
		}
		list = []map[string]any{one}
	}
	var out []*Server
	for _, cfg := range list {
		obs, _ := cfg["outbounds"].([]any)
		var main map[string]any
		for _, o := range obs {
			m, _ := o.(map[string]any)
			if m == nil {
				continue
			}
			p, _ := m["protocol"].(string)
			if p == "vless" || p == "vmess" || p == "trojan" || p == "shadowsocks" || p == "hysteria" || p == "wireguard" {
				if tag, _ := m["tag"].(string); main == nil || tag == "proxy" {
					main = m
				}
			}
		}
		if main == nil {
			continue
		}
		s := &Server{Kind: "link"}
		s.Name, _ = cfg["remarks"].(string)
		p, _ := main["protocol"].(string)
		s.Proto = map[string]string{"vless": "VLESS", "vmess": "VMess", "trojan": "Trojan", "shadowsocks": "Shadowsocks", "hysteria": "Hysteria", "wireguard": "WireGuard"}[p]
		if t := transportName(main); t != "" {
			s.Proto += " · " + t
		}
		if set, ok := main["settings"].(map[string]any); ok {
			for _, key := range []string{"vnext", "servers"} {
				if arr, ok := set[key].([]any); ok && len(arr) > 0 {
					if first, ok := arr[0].(map[string]any); ok {
						s.Host, _ = first["address"].(string)
						if f, ok := first["port"].(float64); ok {
							s.Port = int(f)
						}
					}
				}
			}
			if s.Host == "" {
				s.Host, _ = set["address"].(string)
				if f, ok := set["port"].(float64); ok {
					s.Port = int(f)
				}
			}
		}
		delete(cfg, "inbounds")
		s.Xray, _ = json.Marshal(cfg)
		s.Name = orDefault(s.Name, s.Host)
		s.Country = detectCountry(s.Name)
		out = append(out, s)
	}
	return out
}

// xrayRunConfig turns a stored server config into a runnable one with our local SOCKS entry.
func xrayRunConfig(raw []byte, port int, o *connOpts) (map[string]any, error) {
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	level := "warning"
	if o != nil {
		level = o.set.LogLevel
	}
	cfg["log"] = xrayLog(level)
	cfg["inbounds"] = []any{map[string]any{
		"tag": "socks-in", "listen": "127.0.0.1", "port": port, "protocol": "socks",
		"settings": map[string]any{"udp": true, "auth": "noauth"},
	}}
	for _, k := range []string{"api", "stats", "policy", "observatory", "burstObservatory", "reverse", "metrics"} {
		delete(cfg, k)
	}
	// Rules and DNS filters that need geoip/geosite files are dropped:
	// everything from our local entry goes through the server anyway.
	rules := []any{map[string]any{"type": "field", "inboundTag": []any{"socks-in"}, "outboundTag": mainOutboundTag(cfg)}}
	r, _ := cfg["routing"].(map[string]any)
	if r == nil {
		r = map[string]any{}
	}
	if old, ok := r["rules"].([]any); ok {
		for _, rule := range old {
			if !usesGeo(rule) && !strings.Contains(mustJSON(rule), "balancerTag") {
				rules = append(rules, rule)
			}
		}
	}
	r["rules"] = rules
	delete(r, "balancers")
	cfg["routing"] = r
	if d, ok := cfg["dns"].(map[string]any); ok {
		if servers, ok := d["servers"].([]any); ok {
			kept := []any{}
			for _, sv := range servers {
				if m, ok := sv.(map[string]any); ok {
					for _, k := range []string{"domains", "expectIPs", "expectedIPs", "unexpectedIPs"} {
						if list, ok := m[k].([]any); ok {
							clean := []any{}
							for _, x := range list {
								if !usesGeo(x) {
									clean = append(clean, x)
								}
							}
							if len(clean) == 0 && len(list) > 0 {
								delete(m, k)
								if k == "domains" {
									m = nil // a server only meant for geo-matched domains
									break
								}
								continue
							}
							m[k] = clean
						}
					}
					if m == nil {
						continue
					}
				}
				kept = append(kept, sv)
			}
			if len(kept) == 0 {
				kept = []any{"1.1.1.1", "8.8.8.8"}
			}
			d["servers"] = kept
		}
		if hosts, ok := d["hosts"].(map[string]any); ok {
			for k := range hosts {
				if usesGeo(k) {
					delete(hosts, k)
				}
			}
		}
	}
	if o != nil {
		tuneXray(cfg, o)
	}
	return cfg, nil
}

// tuneXray applies the connection settings: known server addresses, the physical adapter
// under Xray/tun2proxy TUN, fragmentation, noises and multiplexing.
func tuneXray(cfg map[string]any, o *connOpts) {
	obs, _ := cfg["outbounds"].([]any)
	mainTag := mainOutboundTag(cfg)
	var main map[string]any
	for _, x := range obs {
		if m, ok := x.(map[string]any); ok && m["tag"] == mainTag {
			main = m
		}
	}
	sockopt := func(m map[string]any) map[string]any {
		ss, _ := m["streamSettings"].(map[string]any)
		if ss == nil {
			ss = map[string]any{}
			m["streamSettings"] = ss
		}
		so, _ := ss["sockopt"].(map[string]any)
		if so == nil {
			so = map[string]any{}
			ss["sockopt"] = so
		}
		return so
	}
	// The server's name is resolved here, before any tunnel: Xray must never ask DNS
	// for its own server through the tunnel it carries.
	if main != nil && o.srv != nil && len(o.serverIPs) > 0 {
		if _, err := netip.ParseAddr(o.srv.Host); err != nil {
			d, _ := cfg["dns"].(map[string]any)
			if d == nil {
				d = map[string]any{}
				cfg["dns"] = d
			}
			hosts, _ := d["hosts"].(map[string]any)
			if hosts == nil {
				hosts = map[string]any{}
				d["hosts"] = hosts
			}
			var ips []any
			v6 := false
			for _, a := range o.serverIPs {
				ips = append(ips, a.String())
				v6 = v6 || a.Is6()
			}
			hosts[o.srv.Host] = ips
			if so := sockopt(main); so["domainStrategy"] == nil {
				if v6 {
					so["domainStrategy"] = "UseIP"
				} else {
					so["domainStrategy"] = "UseIPv4"
				}
			}
		}
	}
	set := o.set
	if main != nil && (set.Fragment || set.Noises) {
		fs := map[string]any{}
		if set.Fragment {
			fs["fragment"] = map[string]any{"packets": set.FragPackets, "length": set.FragLength, "interval": set.FragInterval}
		}
		if set.Noises {
			fs["noises"] = []any{map[string]any{"type": set.NoiseType, "packet": set.NoisePacket, "delay": set.NoiseDelay}}
		}
		obs = append(obs, map[string]any{"tag": "pv-dialer", "protocol": "freedom", "settings": fs,
			"streamSettings": map[string]any{"sockopt": map[string]any{"tcpNoDelay": true}}})
		cfg["outbounds"] = obs
		sockopt(main)["dialerProxy"] = "pv-dialer"
	}
	if main != nil && set.Mux {
		js := mustJSON(main)
		if strings.Contains(js, "xtls-rprx-vision") || strings.Contains(js, `"network":"xhttp"`) {
			logc("мультиплексирование не включено: сервер работает на Vision или XHTTP, они с ним несовместимы")
		} else {
			main["mux"] = map[string]any{"enabled": true, "concurrency": set.MuxConc, "xudpConcurrency": set.XudpConc, "xudpProxyUDP443": set.XudpQuic}
		}
	}
	if o.bindPhys() {
		for _, x := range obs {
			if m, ok := x.(map[string]any); ok {
				if p, _ := m["protocol"].(string); p != "blackhole" && p != "dns" && p != "loopback" {
					sockopt(m)["interface"] = o.phys.Name
				}
			}
		}
	}
}

// xrayLog keeps the per-connection «accepted» lines out of the logs unless the details level is on.
func xrayLog(level string) map[string]any {
	l := map[string]any{"loglevel": level}
	if level != "info" && level != "debug" {
		l["access"] = "none"
	}
	return l
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func usesGeo(v any) bool {
	s := mustJSON(v)
	return strings.Contains(s, "geoip:") || strings.Contains(s, "geosite:") || strings.Contains(s, "ext:")
}

// mainOutboundTag finds the outbound that leads to the server (tagged "proxy" when there is one).
func mainOutboundTag(cfg map[string]any) string {
	obs, _ := cfg["outbounds"].([]any)
	first := ""
	for i, o := range obs {
		m, _ := o.(map[string]any)
		if m == nil {
			continue
		}
		p, _ := m["protocol"].(string)
		if p == "freedom" || p == "blackhole" || p == "dns" || p == "loopback" {
			continue
		}
		tag, _ := m["tag"].(string)
		if tag == "" {
			tag = "proxy-" + strconv.Itoa(i)
			m["tag"] = tag
		}
		if tag == "proxy" {
			return tag
		}
		if first == "" {
			first = tag
		}
	}
	if first == "" {
		return "proxy"
	}
	return first
}

