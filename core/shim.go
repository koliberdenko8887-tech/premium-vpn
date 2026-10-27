package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strings"
	"time"
)

// Shared pieces the desktop files (links.go, xray.go, countries.go) expect.

var (
	subUserAgent string // PV_UA: a fixed User-Agent for subscriptions
	deviceID     string // PV_HWID: sent to subscription servers that count devices
	sysDNS       []string
)

type Server struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Country  string          `json:"country"`
	Kind     string          `json:"kind"`
	Proto    string          `json:"proto"`
	Host     string          `json:"host"`
	Port     int             `json:"port"`
	SubID    string          `json:"subId,omitempty"`
	Outbound json.RawMessage `json:"outbound,omitempty"`
	Xray     json.RawMessage `json:"xray,omitempty"`
	Ping     int             `json:"ping"`
	IPs      []string        `json:"ips,omitempty"`
}

// Settings are the phone app's options (same names as on Windows).
type Settings struct {
	LogLevel     string `json:"logLevel"`
	RemoteDNS    string `json:"remoteDns"`
	DirectDNS    string `json:"directDns"`
	LocalDNS     bool   `json:"localDns"`
	IPMode       string `json:"ipMode"`
	GlobalProxy  bool   `json:"globalProxy"`
	BypassLAN    bool   `json:"bypassLan"`
	Sniff        bool   `json:"sniff"`
	DirectList   string `json:"directList"`
	ProxyList    string `json:"proxyList"`
	BlockList    string `json:"blockList"`
	Fragment     bool   `json:"fragment"`
	FragPackets  string `json:"fragPackets"`
	FragLength   string `json:"fragLength"`
	FragInterval string `json:"fragInterval"`
	Noises       bool   `json:"noises"`
	NoiseType    string `json:"noiseType"`
	NoisePacket  string `json:"noisePacket"`
	NoiseDelay   string `json:"noiseDelay"`
	Mux          bool   `json:"mux"`
	MuxConc      int    `json:"muxConc"`
	XudpConc     int    `json:"xudpConc"`
	XudpQuic     string `json:"xudpQuic"`
	PingURL      string `json:"pingUrl"`
}

func defaultSettings() Settings {
	return Settings{LogLevel: "warning", RemoteDNS: "https://1.1.1.1/dns-query", IPMode: "ipv4_only", GlobalProxy: true, BypassLAN: true, Sniff: true,
		FragPackets: "tlshello", FragLength: "100-200", FragInterval: "10-20", NoiseType: "rand", NoisePacket: "10-20", NoiseDelay: "10-16",
		MuxConc: 8, XudpConc: 16, XudpQuic: "reject", PingURL: "https://www.gstatic.com/generate_204"}
}

type physInfo struct{ Name string }

type connOpts struct {
	set       Settings
	srv       *Server
	serverIPs []netip.Addr
	phys      physInfo
}

func (o *connOpts) bindPhys() bool { return false }

func hasXray() bool { return true }

func logc(format string, a ...any) { fmt.Fprintf(os.Stderr, format+"\n", a...) }

func physDialer(timeout time.Duration) *net.Dialer { return &net.Dialer{Timeout: timeout} }

// Android has no /etc/resolv.conf, so Go's own resolver would ask 127.0.0.1.
// The app passes the phone's DNS servers in PV_DNS; public ones are the fallback.
func setupResolver() {
	subUserAgent = os.Getenv("PV_UA")
	deviceID = os.Getenv("PV_HWID")
	for _, s := range strings.Split(os.Getenv("PV_DNS"), ",") {
		if a, err := netip.ParseAddr(strings.TrimSpace(s)); err == nil {
			sysDNS = append(sysDNS, a.String())
		}
	}
	servers := append(append([]string{}, sysDNS...), "1.1.1.1", "8.8.8.8", "77.88.8.8")
	net.DefaultResolver.PreferGo = true
	net.DefaultResolver.Dial = func(ctx context.Context, network, _ string) (net.Conn, error) {
		var last error
		d := net.Dialer{Timeout: 3 * time.Second}
		for _, s := range servers {
			c, err := d.DialContext(ctx, network, net.JoinHostPort(s, "53"))
			if err == nil {
				return c, nil
			}
			last = err
		}
		return nil, last
	}
}

// resolveServer finds the server's addresses before the tunnel is up; DoH by IP when DNS fails.
func resolveServer(host string) []netip.Addr {
	if a, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{a}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	var out []netip.Addr
	if ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip4", host); err == nil {
		out = ips
	}
	if len(out) == 0 {
		if list, err := resolveDoH(host); err == nil {
			for _, s := range list {
				if a, err := netip.ParseAddr(s); err == nil {
					out = append(out, a)
				}
			}
		}
	}
	return out
}
