package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sjson "github.com/sagernet/sing/common/json"
	M "github.com/sagernet/sing/common/metadata"
	"github.com/sagernet/sing/service"
	xcore "github.com/xtls/xray-core/core"
	_ "github.com/xtls/xray-core/main/distro/all"
)

// directDomains always go straight to the internet, outside the VPN (same rule as on Windows).
var directDomains = []string{"anthropic.com", "claude.ai", "claude.com"}

type runParams struct {
	Server   Server          `json:"server"`
	Ctl      string          `json:"ctl"`  // abstract unix socket the app listens on
	Data     string          `json:"data"` // the app's files folder: stats.json and live.json
	Settings json.RawMessage `json:"settings"`
	// 0.1.0 sent these at the top level
	LogLevel  string `json:"logLevel"`
	RemoteDNS string `json:"remoteDns"`
	LocalDNS  bool   `json:"localDns"`
	BypassLAN *bool  `json:"bypassLan"`

	set Settings
}

func (p *runParams) settings() {
	p.set = defaultSettings()
	if len(p.Settings) > 0 {
		json.Unmarshal(p.Settings, &p.set)
		return
	}
	p.set.LogLevel = orDefault(p.LogLevel, p.set.LogLevel)
	p.set.RemoteDNS = orDefault(p.RemoteDNS, p.set.RemoteDNS)
	p.set.LocalDNS = p.LocalDNS
	if p.BypassLAN != nil {
		p.set.BypassLAN = *p.BypassLAN
	}
}

type ctlConn struct {
	c  *net.UnixConn
	mu sync.Mutex
}

func (c *ctlConn) send(v map[string]any) {
	b, _ := json.Marshal(v)
	c.mu.Lock()
	c.c.Write(append(b, '\n'))
	c.mu.Unlock()
}

func (c *ctlConn) log(format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	fmt.Fprintln(os.Stderr, time.Now().Format("15:04:05"), msg)
	c.send(map[string]any{"t": "log", "m": msg})
}

// readFirst waits for the app's first message, which carries the tunnel descriptor.
func readFirst(c *net.UnixConn) (int, []byte, error) {
	buf := make([]byte, 64<<10)
	oob := make([]byte, syscall.CmsgSpace(4*4))
	fd := -1
	var line []byte
	for {
		n, oobn, _, _, err := c.ReadMsgUnix(buf, oob)
		if err != nil {
			return fd, nil, err
		}
		if oobn > 0 {
			msgs, _ := syscall.ParseSocketControlMessage(oob[:oobn])
			for _, m := range msgs {
				if fds, err := syscall.ParseUnixRights(&m); err == nil && len(fds) > 0 {
					fd = fds[0]
				}
			}
		}
		line = append(line, buf[:n]...)
		if i := bytes.IndexByte(line, '\n'); i >= 0 {
			if fd < 0 {
				return fd, nil, errors.New("приложение не передало туннель")
			}
			return fd, line[:i], nil
		}
	}
}

func singboxRunConfig(p *runParams, proxyOut map[string]any, apiPort int, secret string) map[string]any {
	set := p.set
	local := map[string]any{"tag": "local", "type": "udp", "server": "1.1.1.1"}
	if len(sysDNS) > 0 {
		local["server"] = sysDNS[0]
	}
	if d := strings.TrimSpace(set.DirectDNS); d != "" {
		if l := dnsServer("local", d); l["domain_resolver"] == nil {
			local = l // a name cannot resolve itself, so only an address replaces the phone's DNS
		}
	}
	remote := dnsServer("remote", orDefault(strings.TrimSpace(set.RemoteDNS), "https://1.1.1.1/dns-query"))
	remote["detour"] = "proxy"
	final := "remote"
	if set.LocalDNS {
		final = "local"
	}
	directD, directC := parseList(set.DirectList)
	proxyD, proxyC := parseList(set.ProxyList)
	blockD, blockC := parseList(set.BlockList)
	directD = append(append([]string{}, directDomains...), directD...)
	dnsRules := []any{map[string]any{"domain_suffix": directD, "server": "local"}}
	if _, err := netip.ParseAddr(p.Server.Host); err != nil && p.Server.Host != "" {
		dnsRules = append(dnsRules, map[string]any{"domain": []string{p.Server.Host}, "server": "local"})
	}
	var rules []any
	if set.Sniff {
		rules = append(rules, map[string]any{"action": "sniff"})
	}
	rules = append(rules,
		map[string]any{"protocol": "dns", "action": "hijack-dns"},
		map[string]any{"port": []int{53}, "action": "hijack-dns"},
	)
	if set.BypassLAN {
		rules = append(rules, map[string]any{"ip_is_private": true, "outbound": "direct"})
	}
	if len(blockD) > 0 {
		rules = append(rules, map[string]any{"domain_suffix": blockD, "action": "reject"})
	}
	if len(blockC) > 0 {
		rules = append(rules, map[string]any{"ip_cidr": blockC, "action": "reject"})
	}
	rules = append(rules, map[string]any{"domain_suffix": directD, "outbound": "direct"})
	if len(directC) > 0 {
		rules = append(rules, map[string]any{"ip_cidr": directC, "outbound": "direct"})
	}
	if len(proxyD) > 0 {
		rules = append(rules, map[string]any{"domain_suffix": proxyD, "outbound": "proxy"})
	}
	if len(proxyC) > 0 {
		rules = append(rules, map[string]any{"ip_cidr": proxyC, "outbound": "proxy"})
	}
	routeFinal := "proxy"
	if !set.GlobalProxy {
		routeFinal = "direct"
	}
	strategy := set.IPMode
	switch strategy {
	case "prefer_ipv4", "prefer_ipv6", "ipv6_only":
	default:
		strategy = "ipv4_only"
	}
	addr := []string{"172.19.0.1/30"}
	if strategy != "ipv4_only" {
		addr = append(addr, "fdfe:dcba:9876::1/126")
	}
	proxyOut["tag"] = "proxy"
	return map[string]any{
		"log": map[string]any{"level": logLevelSB(set.LogLevel), "timestamp": true},
		"dns": map[string]any{
			"servers": []any{local, remote}, "rules": dnsRules, "final": final, "strategy": strategy,
		},
		"inbounds": []any{map[string]any{
			"type": "tun", "tag": "tun", "address": addr, "mtu": 9000, "stack": "gvisor",
		}},
		"outbounds": []any{proxyOut, map[string]any{"type": "direct", "tag": "direct",
			"domain_resolver": map[string]any{"server": "local", "strategy": strategy}}},
		"route": map[string]any{"rules": rules, "final": routeFinal, "auto_detect_interface": true, "default_domain_resolver": "local"},
		"experimental": map[string]any{
			"clash_api": map[string]any{"external_controller": "127.0.0.1:" + strconv.Itoa(apiPort), "secret": secret},
		},
	}
}

func logLevelSB(l string) string {
	switch l {
	case "debug", "info":
		return l
	}
	return "warn"
}

// parseList reads a user list: sites (example.com, *.example.com, https://example.com/x) and addresses (1.2.3.4, 10.0.0.0/8).
func parseList(text string) (domains, cidrs []string) {
	var items []string
	for _, line := range strings.Split(text, "\n") {
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		items = append(items, strings.FieldsFunc(line, func(r rune) bool { return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\r' })...)
	}
	for _, v := range items {
		if p, err := netip.ParsePrefix(v); err == nil {
			cidrs = append(cidrs, p.Masked().String())
			continue
		}
		if a, err := netip.ParseAddr(v); err == nil {
			cidrs = append(cidrs, netip.PrefixFrom(a, a.BitLen()).String())
			continue
		}
		if strings.Contains(v, "://") {
			if u, err := urlParse(v); err == nil {
				v = u.Hostname()
			}
		}
		v = strings.ToLower(strings.TrimPrefix(strings.TrimPrefix(v, "*."), "."))
		if i := strings.IndexAny(v, "/:"); i >= 0 {
			v = v[:i]
		}
		if v != "" {
			domains = append(domains, v)
		}
	}
	return
}

func dnsServer(tag, spec string) map[string]any {
	m := map[string]any{"tag": tag, "type": "udp"}
	host, port := spec, ""
	if u, err := urlParse(spec); err == nil && u.Scheme != "" && u.Host != "" {
		host, port = u.Hostname(), u.Port()
		switch u.Scheme {
		case "https", "h3", "tls", "quic", "tcp", "udp":
			m["type"] = u.Scheme
		}
		if (u.Scheme == "https" || u.Scheme == "h3") && u.Path != "" && u.Path != "/dns-query" {
			m["path"] = u.Path
		}
	} else if h, pp, err := net.SplitHostPort(spec); err == nil {
		host, port = h, pp
	}
	m["server"] = host
	if n, err := strconv.Atoi(port); err == nil && n > 0 {
		m["server_port"] = n
	}
	if _, err := netip.ParseAddr(host); err != nil {
		m["domain_resolver"] = "local"
	}
	return m
}

func freeTCPPort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 10808
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// checkThrough opens two test pages through the proxy outbound; one answer is enough.
func checkThrough(ctx context.Context, ob adapter.Outbound) (int, error) {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return ob.DialContext(ctx, network, M.ParseSocksaddr(addr))
		},
		DisableKeepAlives: true,
	}
	c := &http.Client{Timeout: 8 * time.Second, Transport: tr}
	var last error
	urls := []string{"https://www.gstatic.com/generate_204", "https://cp.cloudflare.com/generate_204", "https://1.1.1.1/cdn-cgi/trace"}
	if u := os.Getenv("PV_CHECK_URL"); u != "" { // lab
		urls = []string{u}
	}
	for _, u := range urls {
		start := time.Now()
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		resp, err := c.Do(req)
		if err != nil {
			last = err
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		ms := int(time.Since(start).Milliseconds())
		if ms < 1 {
			ms = 1
		}
		return ms, nil
	}
	return 0, last
}

func runVPN(paramsPath string) error {
	raw, err := os.ReadFile(paramsPath)
	if err != nil {
		return err
	}
	var p runParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	p.settings()
	uc, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: "@" + p.Ctl, Net: "unix"})
	if err != nil {
		return fmt.Errorf("связь с приложением: %w", err)
	}
	ctl := &ctlConn{c: uc}
	fd, first, err := readFirst(uc)
	if err != nil {
		ctl.send(map[string]any{"t": "err", "m": err.Error()})
		return err
	}
	plat := &platform{tunFd: fd}
	var st netState
	json.Unmarshal(first, &st)
	plat.state = st
	for _, n := range st.Ifaces {
		if n.Name == st.Default {
			sysDNS = append(append([]string{}, n.DNS...), sysDNS...)
		}
	}
	fail := func(msg string) error {
		ctl.send(map[string]any{"t": "err", "m": msg})
		return errors.New(msg)
	}

	srv := p.Server
	ctl.send(map[string]any{"t": "state", "s": "connecting"})
	ips := resolveServer(srv.Host)
	if len(ips) == 0 && srv.Host != "" {
		for _, s := range srv.IPs {
			if a, err := netip.ParseAddr(s); err == nil {
				ips = append(ips, a)
			}
		}
	}
	if len(ips) == 0 && srv.Host != "" {
		return fail("Не удалось найти адрес сервера " + srv.Host)
	}
	var ipList []string
	for _, a := range ips {
		ipList = append(ipList, a.String())
	}
	ctl.send(map[string]any{"t": "ips", "ips": ipList})

	var proxyOut map[string]any
	var xinst *xcore.Instance
	if len(srv.Xray) > 0 {
		port := freeTCPPort()
		cfg, err := xrayRunConfig(srv.Xray, port, &connOpts{set: p.set, srv: &srv, serverIPs: ips})
		if err != nil {
			return fail("Настройки сервера не читаются: " + err.Error())
		}
		b, _ := json.Marshal(cfg)
		xinst, err = xcore.StartInstance("json", b)
		if err != nil {
			return fail("Xray не запустился: " + err.Error())
		}
		defer xinst.Close()
		proxyOut = map[string]any{"type": "socks", "server": "127.0.0.1", "server_port": port, "version": "5"}
	} else if len(srv.Outbound) > 0 {
		json.Unmarshal(srv.Outbound, &proxyOut)
		if _, err := netip.ParseAddr(srv.Host); err != nil && len(ips) > 0 {
			proxyOut["server"] = ips[0].String() // the name is already resolved, no DNS through ourselves
			delete(proxyOut, "domain_resolver")
		}
	} else {
		return fail("У сервера нет настроек")
	}

	apiPort := freeTCPPort()
	sb := make([]byte, 16)
	rand.Read(sb)
	secret := hex.EncodeToString(sb)
	cfgMap := singboxRunConfig(&p, proxyOut, apiPort, secret)
	cfgJSON, _ := json.Marshal(cfgMap)
	ctx := include.Context(context.Background())
	opts, err := sjson.UnmarshalExtendedContext[option.Options](ctx, cfgJSON)
	if err != nil {
		return fail("Ошибка настроек sing-box: " + err.Error())
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ctx = service.ContextWith[adapter.PlatformInterface](ctx, plat)
	inst, err := box.New(box.Options{Context: ctx, Options: opts})
	if err != nil {
		return fail("sing-box: " + err.Error())
	}
	if err := inst.Start(); err != nil {
		inst.Close()
		return fail("sing-box не запустился: " + err.Error())
	}
	defer inst.Close()
	ob, _ := inst.Outbound().Outbound("proxy")

	var ms int
	for try := 0; try < 3; try++ {
		cctx, ccancel := context.WithTimeout(ctx, 12*time.Second)
		ms, err = checkThrough(cctx, ob)
		ccancel()
		if err == nil {
			break
		}
		ctl.log("проверка %d: %v", try+1, err)
	}
	if err != nil {
		return fail("Сервер не отвечает. Выберите другой сервер")
	}
	ctl.send(map[string]any{"t": "state", "s": "on", "ms": ms})
	ctl.log("подключено: %s (%d мс)", srv.Name, ms)
	st0 := newPhoneStats(p.Data, &srv)
	defer st0.end()
	go func() { // the address sites see now, and its country
		cctx, ccancel := context.WithTimeout(ctx, 10*time.Second)
		defer ccancel()
		if ip, loc := trace(cctx, ob); ip != "" {
			st0.setIP(ip, loc)
			ctl.send(map[string]any{"t": "info", "ip": ip, "loc": loc})
		}
	}()

	stop := make(chan struct{})
	go func() { // messages from the app: network changes, stop
		r := bufio.NewReader(uc)
		for {
			line, err := r.ReadBytes('\n')
			if err != nil {
				close(stop)
				return
			}
			var m struct {
				T string `json:"t"`
				netState
			}
			if json.Unmarshal(line, &m) != nil {
				continue
			}
			switch m.T {
			case "net":
				plat.setNet(m.netState)
			case "stop":
				close(stop)
				return
			}
		}
	}()

	api := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	fails, weak := 0, false
	n := 0
	var lastDown, lastUp int64
	for {
		select {
		case <-stop:
			ctl.log("отключено")
			return nil
		case <-tick.C:
		}
		n++
		req, _ := http.NewRequest("GET", "http://127.0.0.1:"+strconv.Itoa(apiPort)+"/connections", nil)
		req.Header.Set("Authorization", "Bearer "+secret)
		if resp, err := api.Do(req); err == nil {
			var v clashConns
			json.NewDecoder(resp.Body).Decode(&v)
			resp.Body.Close()
			dd, du := v.Down-lastDown, v.Up-lastUp
			if dd < 0 || du < 0 { // sing-box restarted its counters
				dd, du = 0, 0
			}
			lastDown, lastUp = v.Down, v.Up
			st0.add(dd, du, v.list())
			ctl.send(map[string]any{"t": "traffic", "down": v.Down, "up": v.Up, "rd": dd, "ru": du})
		}
		st0.tick()
		if n%30 == 0 { // watchdog: three failed checks in a row = weak link
			cctx, ccancel := context.WithTimeout(ctx, 10*time.Second)
			ms, err := checkThrough(cctx, ob)
			ccancel()
			if err != nil {
				fails++
				if fails >= 3 && !weak {
					weak = true
					ctl.send(map[string]any{"t": "state", "s": "weak"})
					ctl.log("связь пропала: %v", err)
				}
			} else {
				fails = 0
				if weak {
					weak = false
					ctl.send(map[string]any{"t": "state", "s": "on", "ms": ms})
					ctl.log("соединение восстановлено")
				}
			}
		}
	}
}

// trace asks Cloudflare which address and country the sites see through the tunnel.
func trace(ctx context.Context, ob adapter.Outbound) (string, string) {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return ob.DialContext(ctx, network, M.ParseSocksaddr(addr))
		},
		DisableKeepAlives: true,
	}
	c := &http.Client{Timeout: 8 * time.Second, Transport: tr}
	urls := []string{"https://1.1.1.1/cdn-cgi/trace", "https://www.cloudflare.com/cdn-cgi/trace"}
	if u := os.Getenv("PV_TRACE_URL"); u != "" { // lab
		urls = []string{u}
	}
	for _, u := range urls {
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		resp, err := c.Do(req)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		var ip, loc string
		for _, l := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(l, "ip="); ok {
				ip = strings.TrimSpace(v)
			} else if v, ok := strings.CutPrefix(l, "loc="); ok {
				loc = strings.TrimSpace(v)
			}
		}
		if ip != "" {
			return ip, loc
		}
	}
	return "", ""
}
