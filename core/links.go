package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func b64decode(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer("\r", "", "\n", "", " ", "").Replace(s)
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, fmt.Errorf("not base64")
}

func tlsBlock(q url.Values, host string) map[string]any {
	sec := q.Get("security")
	if sec != "tls" && sec != "reality" {
		return nil
	}
	sni := q.Get("sni")
	if sni == "" {
		sni = q.Get("peer")
	}
	if sni == "" {
		sni = host
	}
	t := map[string]any{"enabled": true, "server_name": sni}
	fp := q.Get("fp")
	if fp == "" {
		fp = "chrome"
	}
	t["utls"] = map[string]any{"enabled": true, "fingerprint": fp}
	if a := q.Get("alpn"); a != "" {
		t["alpn"] = strings.Split(a, ",")
	}
	if q.Get("allowInsecure") == "1" || q.Get("insecure") == "1" {
		t["insecure"] = true
	}
	if sec == "reality" {
		t["reality"] = map[string]any{"enabled": true, "public_key": q.Get("pbk"), "short_id": q.Get("sid")}
	}
	return t
}

func transportBlock(q url.Values) (map[string]any, error) {
	switch q.Get("type") {
	case "", "tcp", "raw":
		if q.Get("headerType") == "http" {
			return map[string]any{"type": "http", "path": q.Get("path"), "host": splitNonEmpty(q.Get("host"))}, nil
		}
		return nil, nil
	case "ws":
		t := map[string]any{"type": "ws", "path": q.Get("path")}
		if h := q.Get("host"); h != "" {
			t["headers"] = map[string]any{"Host": h}
		}
		return t, nil
	case "grpc":
		return map[string]any{"type": "grpc", "service_name": q.Get("serviceName")}, nil
	case "http", "h2":
		return map[string]any{"type": "http", "path": q.Get("path"), "host": splitNonEmpty(q.Get("host"))}, nil
	case "httpupgrade":
		return map[string]any{"type": "httpupgrade", "path": q.Get("path"), "host": q.Get("host")}, nil
	}
	return nil, fmt.Errorf("транспорт %s пока не поддерживается", q.Get("type"))
}

func splitNonEmpty(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func hostPort(u *url.URL) (string, int, error) {
	host := u.Hostname()
	port, err := strconv.Atoi(u.Port())
	if host == "" || err != nil {
		return "", 0, fmt.Errorf("нет адреса сервера")
	}
	return host, port, nil
}

// parseLink turns a share link (vless://, vmess://, trojan://, ss://, hysteria2://) into a server.
func parseLink(link string) (*Server, error) {
	link = strings.TrimSpace(link)
	if strings.HasPrefix(link, "vmess://") {
		return parseVmess(link)
	}
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	name, _ := url.PathUnescape(u.Fragment)
	q := u.Query()
	s := &Server{Kind: "link", Name: name}
	ob := map[string]any{"tag": "proxy"}
	switch u.Scheme {
	case "vless":
		h, p, err := hostPort(u)
		if err != nil {
			return nil, err
		}
		s.Host, s.Port, s.Proto = h, p, "VLESS"
		ob["type"], ob["server"], ob["server_port"], ob["uuid"] = "vless", h, p, u.User.Username()
		if f := q.Get("flow"); f != "" {
			ob["flow"] = f
		}
		ob["packet_encoding"] = "xudp"
		if t := tlsBlock(q, h); t != nil {
			ob["tls"] = t
		}
		tr, err := transportBlock(q)
		if err != nil {
			return nil, err
		}
		if tr != nil {
			ob["transport"] = tr
		}
	case "trojan":
		h, p, err := hostPort(u)
		if err != nil {
			return nil, err
		}
		s.Host, s.Port, s.Proto = h, p, "Trojan"
		ob["type"], ob["server"], ob["server_port"], ob["password"] = "trojan", h, p, u.User.Username()
		if q.Get("security") == "" {
			q.Set("security", "tls")
		}
		if q.Get("security") != "none" {
			ob["tls"] = tlsBlock(q, h)
		}
		tr, err := transportBlock(q)
		if err != nil {
			return nil, err
		}
		if tr != nil {
			ob["transport"] = tr
		}
	case "hysteria2", "hy2":
		h, p, err := hostPort(u)
		if err != nil {
			return nil, err
		}
		s.Host, s.Port, s.Proto = h, p, "Hysteria2"
		pass := u.User.Username()
		if pw, ok := u.User.Password(); ok {
			pass += ":" + pw
		}
		ob["type"], ob["server"], ob["server_port"], ob["password"] = "hysteria2", h, p, pass
		sni := q.Get("sni")
		if sni == "" {
			sni = h
		}
		t := map[string]any{"enabled": true, "server_name": sni, "alpn": []string{"h3"}}
		if q.Get("insecure") == "1" {
			t["insecure"] = true
		}
		ob["tls"] = t
		if q.Get("obfs") == "salamander" {
			ob["obfs"] = map[string]any{"type": "salamander", "password": q.Get("obfs-password")}
		}
	case "ss":
		method, pass := "", ""
		if u.User != nil {
			if pw, ok := u.User.Password(); ok {
				method, pass = u.User.Username(), pw
			} else if b, err := b64decode(u.User.Username()); err == nil {
				parts := strings.SplitN(string(b), ":", 2)
				if len(parts) == 2 {
					method, pass = parts[0], parts[1]
				}
			}
		} else if b, err := b64decode(u.Host); err == nil {
			// ss://base64(method:pass@host:port)
			if u2, err := url.Parse("ss://" + string(b)); err == nil {
				u = u2
				if pw, ok := u.User.Password(); ok {
					method, pass = u.User.Username(), pw
				}
			}
		}
		h, p, err := hostPort(u)
		if err != nil || method == "" {
			return nil, fmt.Errorf("не удалось прочитать ссылку Shadowsocks")
		}
		s.Host, s.Port, s.Proto = h, p, "Shadowsocks"
		ob["type"], ob["server"], ob["server_port"], ob["method"], ob["password"] = "shadowsocks", h, p, method, pass
	default:
		return nil, fmt.Errorf("неизвестный тип ссылки")
	}
	ob["domain_resolver"] = "local"
	s.Outbound, _ = json.Marshal(ob)
	if s.Name == "" {
		s.Name = s.Host
	}
	s.Country = detectCountry(s.Name)
	return s, nil
}

func parseVmess(link string) (*Server, error) {
	b, err := b64decode(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать ссылку VMess")
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, fmt.Errorf("не удалось прочитать ссылку VMess")
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
	host := str("add")
	if host == "" || port == 0 {
		return nil, fmt.Errorf("нет адреса сервера")
	}
	s := &Server{Kind: "link", Name: str("ps"), Host: host, Port: port, Proto: "VMess"}
	sec := str("scy")
	if sec == "" {
		sec = "auto"
	}
	ob := map[string]any{"tag": "proxy", "type": "vmess", "server": host, "server_port": port, "uuid": str("id"), "alter_id": aid, "security": sec, "packet_encoding": "xudp", "domain_resolver": "local"}
	q := url.Values{}
	q.Set("type", str("net"))
	q.Set("host", str("host"))
	q.Set("path", str("path"))
	q.Set("serviceName", str("path"))
	q.Set("headerType", str("type"))
	if str("tls") == "tls" {
		q.Set("security", "tls")
		q.Set("sni", str("sni"))
		q.Set("fp", str("fp"))
		q.Set("alpn", str("alpn"))
		if q.Get("sni") == "" {
			q.Set("sni", str("host"))
		}
		ob["tls"] = tlsBlock(q, host)
	}
	tr, err := transportBlock(q)
	if err != nil {
		return nil, err
	}
	if tr != nil {
		ob["transport"] = tr
	}
	s.Outbound, _ = json.Marshal(ob)
	if s.Name == "" {
		s.Name = host
	}
	s.Country = detectCountry(s.Name)
	return s, nil
}

// parseText finds every share link in a block of text (or base64 of it).
func parseText(text string) ([]*Server, []string) {
	if !strings.Contains(text, "://") {
		if b, err := b64decode(text); err == nil {
			text = string(b)
		}
	}
	var out []*Server
	var errs []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "://") {
			continue
		}
		parse := parseLink
		if hasXray() {
			parse = parseLinkAny
		}
		s, err := parse(line)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		out = append(out, s)
	}
	return out, errs
}

type subResult struct {
	Title                           string
	Upload, Download, Total, Expire int64
	Servers                         []*Server
	Errors                          []string
}

// subUserAgents: the first one gets plain share links from most panels;
// the second is tried when the first one returns nothing we can use.
var subUserAgents = []string{"v2rayN/7.0", "Happ/3.0.0"}

func fetchSubscriptionWith(client *http.Client, raw string) (*subResult, error) {
	var lastErr error
	agents := subUserAgents
	if ua := strings.TrimSpace(subUserAgent); ua != "" {
		agents = []string{ua}
	}
	for _, ua := range agents {
		r, err := fetchSubOnce(client, raw, ua)
		if err != nil && isDNSError(err) && client.Transport != nil {
			// the provider's name may be blocked by the local DNS; ask Cloudflare or Google directly
			r, err = fetchSubOnce(dohClient(), raw, ua)
		}
		if err != nil {
			lastErr = err
			continue
		}
		if len(r.Servers) > 0 {
			return r, nil
		}
		lastErr = nil
		if len(r.Errors) > 0 {
			lastErr = fmt.Errorf("в подписке нет подходящих серверов: %s", r.Errors[0])
		}
		if ua == agents[len(agents)-1] {
			return r, nil
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("в подписке нет серверов")
	}
	return nil, lastErr
}

func isDNSError(err error) bool {
	var de *net.DNSError
	return errors.As(err, &de)
}

func fetchSubOnce(client *http.Client, raw, ua string) (*subResult, error) {
	req, err := http.NewRequest("GET", raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "*/*")
	hwid := deviceID
	if hwid != "" {
		req.Header.Set("X-HWID", hwid)
		req.Header.Set("X-Device-OS", "Android")
		req.Header.Set("X-Device-Model", "Премиум VPN")
	}
	resp, err := client.Do(req)
	if err != nil {
		if isDNSError(err) {
			return nil, err
		}
		return nil, fmt.Errorf("не удалось скачать подписку")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("сервер подписки ответил %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	r := &subResult{}
	for _, part := range strings.Split(resp.Header.Get("Subscription-Userinfo"), ";") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		n, _ := strconv.ParseFloat(strings.TrimSpace(kv[1]), 64)
		switch kv[0] {
		case "upload":
			r.Upload = int64(n)
		case "download":
			r.Download = int64(n)
		case "total":
			r.Total = int64(n)
		case "expire":
			r.Expire = int64(n)
		}
	}
	title := resp.Header.Get("Profile-Title")
	if strings.HasPrefix(title, "base64:") {
		if b, err := b64decode(strings.TrimPrefix(title, "base64:")); err == nil {
			title = string(b)
		}
	}
	if title == "" {
		if u, err := url.Parse(raw); err == nil {
			title = u.Hostname()
		}
	}
	r.Title = title
	if t := strings.TrimSpace(string(body)); hasXray() && (strings.HasPrefix(t, "[") || strings.HasPrefix(t, "{")) {
		r.Servers = parseXrayJSON([]byte(t))
		if len(r.Servers) == 0 {
			r.Errors = []string{"не понял формат подписки"}
		}
		return r, nil
	}
	r.Servers, r.Errors = parseText(string(body))
	return r, nil
}

// dohClient resolves names over DNS-over-HTTPS (by IP address, so it needs no DNS itself).
func dohClient() *http.Client {
	d := physDialer(10 * time.Second)
	tr := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil || net.ParseIP(host) != nil {
				return d.DialContext(ctx, network, addr)
			}
			ips, err := resolveDoH(host)
			if err != nil {
				return nil, err
			}
			var last error
			for _, ip := range ips {
				c, err := d.DialContext(ctx, network, net.JoinHostPort(ip, port))
				if err == nil {
					return c, nil
				}
				last = err
			}
			return nil, last
		},
	}
	return &http.Client{Timeout: 25 * time.Second, Transport: tr}
}

func resolveDoH(host string) ([]string, error) {
	c := &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{Proxy: nil, DialContext: physDialer(8 * time.Second).DialContext}}
	var last error
	for _, base := range []string{"https://1.1.1.1/dns-query", "https://8.8.8.8/resolve", "https://1.0.0.1/dns-query"} {
		req, _ := http.NewRequest("GET", base+"?type=A&name="+url.QueryEscape(host), nil)
		req.Header.Set("Accept", "application/dns-json")
		resp, err := c.Do(req)
		if err != nil {
			last = err
			continue
		}
		var v struct {
			Answer []struct {
				Type int    `json:"type"`
				Data string `json:"data"`
			}
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&v)
		resp.Body.Close()
		if err != nil {
			last = err
			continue
		}
		var ips []string
		for _, a := range v.Answer {
			if a.Type == 1 {
				ips = append(ips, a.Data)
			}
		}
		if len(ips) > 0 {
			return ips, nil
		}
		last = fmt.Errorf("адрес %s не найден", host)
	}
	return nil, last
}

func tcpPing(host string, port int) int {
	start := time.Now()
	c, err := physDialer(3*time.Second).Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return -1
	}
	c.Close()
	ms := int(time.Since(start).Milliseconds())
	if ms < 1 {
		ms = 1
	}
	return ms
}
