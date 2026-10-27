package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"sync"
	"time"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sjson "github.com/sagernet/sing/common/json"
	xcore "github.com/xtls/xray-core/core"
)

// realPingAll measures servers the way Happ's "via proxy" ping does: the server is started
// for a moment and the test page is opened through it twice; the better answer counts.
func realPingAll(in []byte) map[string]int {
	var req struct {
		Settings json.RawMessage `json:"settings"`
		Servers  []*Server       `json:"servers"`
	}
	json.Unmarshal(in, &req)
	set := defaultSettings()
	if len(req.Settings) > 0 {
		json.Unmarshal(req.Settings, &set)
	}
	set.Mux = false
	set.LogLevel = "none"
	res := map[string]int{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for _, s := range req.Servers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ms := realPing(s, set)
			mu.Lock()
			res[s.ID] = ms
			mu.Unlock()
		}()
	}
	wg.Wait()
	return res
}

func realPing(s *Server, set Settings) int {
	port := freeTCPPort()
	ips := resolveServer(s.Host)
	if len(ips) == 0 && s.Host != "" {
		return -1
	}
	switch {
	case len(s.Xray) > 0:
		cfg, err := xrayRunConfig(s.Xray, port, &connOpts{set: set, srv: s, serverIPs: ips})
		if err != nil {
			return -1
		}
		cfg["log"] = map[string]any{"loglevel": "none"}
		b, _ := json.Marshal(cfg)
		inst, err := xcore.StartInstance("json", b)
		if err != nil {
			return -1
		}
		defer inst.Close()
	case len(s.Outbound) > 0:
		var out map[string]any
		if json.Unmarshal(s.Outbound, &out) != nil {
			return -1
		}
		if _, err := netip.ParseAddr(s.Host); err != nil && len(ips) > 0 {
			out["server"] = ips[0].String()
			delete(out, "domain_resolver")
		}
		out["tag"] = "proxy"
		cfg := map[string]any{
			"log":       map[string]any{"disabled": true},
			"inbounds":  []any{map[string]any{"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": port}},
			"outbounds": []any{out},
		}
		b, _ := json.Marshal(cfg)
		ctx := include.Context(context.Background())
		opts, err := sjson.UnmarshalExtendedContext[option.Options](ctx, b)
		if err != nil {
			return -1
		}
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		inst, err := box.New(box.Options{Context: ctx, Options: opts})
		if err != nil {
			return -1
		}
		if inst.Start() != nil {
			inst.Close()
			return -1
		}
		defer inst.Close()
	default:
		return tcpPing(s.Host, s.Port)
	}
	if !waitLocal(port, 4*time.Second) {
		return -1
	}
	pu, _ := url.Parse("socks5://127.0.0.1:" + strconv.Itoa(port))
	c := &http.Client{Timeout: 6 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(pu)}}
	defer c.CloseIdleConnections()
	best := -1
	for i := 0; i < 2; i++ {
		start := time.Now()
		resp, err := c.Get(orDefault(set.PingURL, "https://www.gstatic.com/generate_204"))
		if err != nil {
			continue
		}
		resp.Body.Close()
		if ms := max(int(time.Since(start).Milliseconds()), 1); best < 0 || ms < best {
			best = ms
		}
	}
	return best
}

func waitLocal(port int, d time.Duration) bool {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 300*time.Millisecond); err == nil {
			c.Close()
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}
