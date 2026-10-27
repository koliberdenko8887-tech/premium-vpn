package main

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"slices"
	"sync"
	"syscall"

	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	"github.com/sagernet/sing-box/option"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/common/x/list"
)

// The app's VpnService opens the tunnel and sends us its descriptor; it also tells us
// which network is the phone's default one (Android 11+ hides netlink from apps).

type netIface struct {
	Name    string   `json:"name"`
	Index   int      `json:"index"`
	MTU     int      `json:"mtu"`
	Addrs   []string `json:"addrs"`
	DNS     []string `json:"dns"`
	Type    string   `json:"type"`
	Metered bool     `json:"metered"`
}

type netState struct {
	Ifaces  []netIface `json:"ifaces"`
	Default string     `json:"default"`
}

type platform struct {
	tunFd int

	mu        sync.Mutex
	state     netState
	nm        adapter.NetworkManager
	monitor   *monitor
	myTunName string
	myTunAddr []netip.Addr
}

var errUnsupported = errors.New("not supported")

func (p *platform) Initialize(nm adapter.NetworkManager) error { p.nm = nm; return nil }

func (p *platform) UsePlatformAutoDetectInterfaceControl() bool { return true }

// The whole app is left out of its own VPN (addDisallowedApplication), so sockets need no protect().
func (p *platform) AutoDetectInterfaceControl(fd int) error { return nil }

func (p *platform) UsePlatformInterface() bool { return true }

func (p *platform) OpenInterface(options *tun.Options, _ option.TunPlatformOptions) (tun.Tun, error) {
	if p.tunFd <= 0 {
		return nil, errors.New("нет туннеля от Android")
	}
	name, err := tunName(p.tunFd)
	if err != nil {
		name = "tun0"
	}
	options.Name = name
	options.InterfaceMonitor.RegisterMyInterface(name)
	fd, err := syscall.Dup(p.tunFd)
	if err != nil {
		return nil, err
	}
	options.FileDescriptor = fd
	p.myTunName = name
	for _, a := range options.Inet4Address {
		p.myTunAddr = append(p.myTunAddr, a.Addr())
	}
	for _, a := range options.Inet6Address {
		p.myTunAddr = append(p.myTunAddr, a.Addr())
	}
	return tun.New(*options)
}

func (p *platform) ProcessPlatformOptions(option.TunPlatformOptions) error { return nil }

func (p *platform) UsePlatformDefaultInterfaceMonitor() bool { return true }

func (p *platform) CreateDefaultInterfaceMonitor(l logger.Logger) tun.DefaultInterfaceMonitor {
	m := &monitor{p: p, logger: l}
	p.mu.Lock()
	p.monitor = m
	p.mu.Unlock()
	return m
}

func (p *platform) UsePlatformNetworkInterfaces() bool { return true }

func (p *platform) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	p.mu.Lock()
	st := p.state
	p.mu.Unlock()
	var out []adapter.NetworkInterface
	for _, n := range st.Ifaces {
		if n.Name == p.myTunName {
			continue
		}
		var prefixes []netip.Prefix
		for _, a := range n.Addrs {
			if pr, err := netip.ParsePrefix(a); err == nil {
				prefixes = append(prefixes, pr)
			}
		}
		t := C.InterfaceTypeOther
		switch n.Type {
		case "wifi":
			t = C.InterfaceTypeWIFI
		case "cellular":
			t = C.InterfaceTypeCellular
		case "ethernet":
			t = C.InterfaceTypeEthernet
		}
		mtu := n.MTU
		if mtu <= 0 {
			mtu = 1500
		}
		out = append(out, adapter.NetworkInterface{
			Interface: control.Interface{
				Index: n.Index, MTU: mtu, Name: n.Name, Addresses: prefixes,
				Flags: net.FlagUp | net.FlagRunning | net.FlagMulticast,
			},
			Type:       t,
			DNSServers: n.DNS,
			Expensive:  n.Metered,
		})
	}
	return out, nil
}

func (p *platform) UnderNetworkExtension() bool               { return false }
func (p *platform) NetworkExtensionIncludeAllNetworks() bool  { return false }
func (p *platform) ClearDNSCache()                            {}
func (p *platform) RequestPermissionForWIFIState() error      { return nil }
func (p *platform) ReadWIFIState(context.Context) adapter.WIFIState { return adapter.WIFIState{} }
func (p *platform) UsePlatformConnectionOwnerFinder() bool    { return false }
func (p *platform) FindConnectionOwner(*adapter.FindConnectionOwnerRequest) (*adapter.ConnectionOwner, error) {
	return nil, errUnsupported
}
func (p *platform) UsePlatformWIFIMonitor() bool                                { return false }
func (p *platform) UsePlatformNotification() bool                               { return false }
func (p *platform) SendNotification(*adapter.Notification) error                { return nil }
func (p *platform) CancelNotification(string, int32) error                      { return nil }
func (p *platform) MyInterfaceAddress() []netip.Addr                            { return p.myTunAddr }
func (p *platform) UsePlatformNeighborResolver() bool                           { return false }
func (p *platform) StartNeighborMonitor(adapter.NeighborUpdateListener) error   { return errUnsupported }
func (p *platform) CloseNeighborMonitor(adapter.NeighborUpdateListener) error   { return nil }
func (p *platform) UsePlatformShell() bool                                      { return false }
func (p *platform) CheckPlatformShell() error                                   { return errUnsupported }
func (p *platform) OpenShellSession(*adapter.PlatformUser, string, []string, string, int32, int32) (adapter.ShellSession, error) {
	return nil, errUnsupported
}
func (p *platform) LookupUser(string) (*adapter.PlatformUser, error) { return nil, errUnsupported }
func (p *platform) LookupSFTPServer() (string, error)                { return "", errUnsupported }
func (p *platform) ReadSystemSSHHostKey() ([]byte, error)            { return nil, errUnsupported }
func (p *platform) TailscaleHostname() string                        { return "" }
func (p *platform) UsePlatformBridge() bool                          { return false }
func (p *platform) CreateBridge(adapter.BridgeOptions) (adapter.BridgeSession, error) {
	return nil, errUnsupported
}

// setNet takes a new picture of the phone's networks from the app.
func (p *platform) setNet(st netState) {
	p.mu.Lock()
	p.state = st
	m := p.monitor
	p.mu.Unlock()
	if m != nil && m.started {
		m.update()
	}
}

type monitor struct {
	p       *platform
	logger  logger.Logger
	started bool

	access    sync.Mutex
	callbacks list.List[tun.DefaultInterfaceUpdateCallback]
	def       *control.Interface
	myIfaces  []string
}

func (m *monitor) Start() error { m.started = true; m.update(); return nil }
func (m *monitor) Close() error { return nil }

func (m *monitor) update() {
	if m.p.nm != nil {
		if err := m.p.nm.UpdateInterfaces(); err != nil {
			m.logger.Error("update interfaces: ", err)
		}
	}
	m.p.mu.Lock()
	name := m.p.state.Default
	idx := -1
	for _, n := range m.p.state.Ifaces {
		if n.Name == name {
			idx = n.Index
		}
	}
	m.p.mu.Unlock()
	m.access.Lock()
	old := m.def
	if idx < 0 || m.p.nm == nil {
		m.def = nil
		cbs := m.callbacks.Array()
		m.access.Unlock()
		if old != nil {
			for _, cb := range cbs {
				cb(nil, 0)
			}
		}
		return
	}
	ni, err := m.p.nm.InterfaceFinder().ByIndex(idx)
	if err != nil {
		m.access.Unlock()
		m.logger.Error("find default interface ", name, ": ", err)
		return
	}
	if old != nil && old.Name == ni.Name && old.Index == ni.Index && slices.Equal(old.Addresses, ni.Addresses) {
		m.access.Unlock()
		return
	}
	m.def = ni
	cbs := m.callbacks.Array()
	m.access.Unlock()
	for _, cb := range cbs {
		cb(ni, 0)
	}
}

func (m *monitor) DefaultInterface() *control.Interface {
	m.access.Lock()
	defer m.access.Unlock()
	return m.def
}
func (m *monitor) OverrideAndroidVPN() bool { return false }
func (m *monitor) AndroidVPNEnabled() bool  { return false }
func (m *monitor) RegisterCallback(cb tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	m.access.Lock()
	defer m.access.Unlock()
	return m.callbacks.PushBack(cb)
}
func (m *monitor) UnregisterCallback(e *list.Element[tun.DefaultInterfaceUpdateCallback]) {
	m.access.Lock()
	defer m.access.Unlock()
	m.callbacks.Remove(e)
}
func (m *monitor) RegisterMyInterface(name string) {
	m.access.Lock()
	defer m.access.Unlock()
	m.myIfaces = append(m.myIfaces, name)
}
func (m *monitor) MyInterfaces() []string {
	m.access.Lock()
	defer m.access.Unlock()
	return m.myIfaces
}
