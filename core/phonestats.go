package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Traffic statistics, the same as on Windows: by day, by server and for the session.
// The VPN process keeps them in the app's files folder; the screen reads the files:
//   stats.json  all time (days, servers, sessions)
//   live.json   the current session (speed of the last two minutes, open connections)
// The app asks for a reset by creating stats.reset.

type DayStat struct {
	Day  string `json:"day"` // 2026-10-18
	Down int64  `json:"down"`
	Up   int64  `json:"up"`
}

type ServerStat struct {
	Name    string `json:"name"`
	Country string `json:"country"`
	Down    int64  `json:"down"`
	Up      int64  `json:"up"`
	Seconds int64  `json:"seconds"`
	Last    int64  `json:"last"`
}

type Stats struct {
	Days      []*DayStat             `json:"days"`
	Servers   map[string]*ServerStat `json:"servers"`
	TotalDown int64                  `json:"totalDown"`
	TotalUp   int64                  `json:"totalUp"`
	Sessions  int                    `json:"sessions"`
	Seconds   int64                  `json:"seconds"`
}

type connInfo struct {
	Host    string `json:"host"`
	Network string `json:"network"`
	Route   string `json:"route"` // VPN | Напрямую
	Process string `json:"process"`
	Down    int64  `json:"down"`
	Up      int64  `json:"up"`
}

type liveStats struct {
	SessDown  int64        `json:"sessDown"`
	SessUp    int64        `json:"sessUp"`
	SessSince int64        `json:"sessSince"`
	Speed     [][2]float64 `json:"speed"`
	Conns     []connInfo   `json:"conns"`
	ConnCount int          `json:"connCount"`
	IP        string       `json:"ip"`
	Loc       string       `json:"loc"`
	Updated   int64        `json:"updated"`
}

type phoneStats struct {
	dir   string
	key   string
	start time.Time
	st    Stats
	live  liveStats
	saved time.Time
	n     int
}

// clashConns is sing-box's answer on /connections.
type clashConns struct {
	Down        int64 `json:"downloadTotal"`
	Up          int64 `json:"uploadTotal"`
	Connections []struct {
		Metadata struct {
			Network  string `json:"network"`
			Host     string `json:"host"`
			DestIP   string `json:"destinationIP"`
			DestPort string `json:"destinationPort"`
		} `json:"metadata"`
		Upload   int64    `json:"upload"`
		Download int64    `json:"download"`
		Chains   []string `json:"chains"`
	} `json:"connections"`
}

func (v *clashConns) list() []connInfo {
	out := make([]connInfo, 0, len(v.Connections))
	for _, c := range v.Connections {
		host := c.Metadata.Host
		if host == "" {
			host = c.Metadata.DestIP
		}
		if c.Metadata.DestPort != "" && c.Metadata.DestPort != "443" && c.Metadata.DestPort != "80" {
			host += ":" + c.Metadata.DestPort
		}
		route := "VPN"
		if len(c.Chains) > 0 && c.Chains[0] == "direct" {
			route = "Напрямую"
		}
		out = append(out, connInfo{Host: host, Network: c.Metadata.Network, Route: route, Down: c.Download, Up: c.Upload})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Down+out[i].Up > out[j].Down+out[j].Up })
	return out
}

func newPhoneStats(dir string, srv *Server) *phoneStats {
	p := &phoneStats{dir: dir, key: srv.Name + "|" + srv.Host, start: time.Now()}
	if dir == "" {
		return p
	}
	os.Remove(p.path("stats.reset"))
	if b, err := os.ReadFile(p.path("stats.json")); err == nil {
		json.Unmarshal(b, &p.st)
	}
	if p.st.Servers == nil {
		p.st.Servers = map[string]*ServerStat{}
	}
	p.st.Sessions++
	s := p.st.Servers[p.key]
	if s == nil {
		s = &ServerStat{}
		p.st.Servers[p.key] = s
	}
	s.Name, s.Country, s.Last = srv.Name, srv.Country, time.Now().Unix()
	p.live.SessSince = p.start.Unix()
	p.save()
	return p
}

func (p *phoneStats) path(name string) string { return filepath.Join(p.dir, name) }

func (p *phoneStats) setIP(ip, loc string) { p.live.IP, p.live.Loc = ip, loc }

// add counts one second of traffic.
func (p *phoneStats) add(down, up int64, conns []connInfo) {
	day := time.Now().Format("2006-01-02")
	var d *DayStat
	if n := len(p.st.Days); n > 0 && p.st.Days[n-1].Day == day {
		d = p.st.Days[n-1]
	} else {
		d = &DayStat{Day: day}
		p.st.Days = append(p.st.Days, d)
		if len(p.st.Days) > 400 {
			p.st.Days = p.st.Days[len(p.st.Days)-400:]
		}
	}
	d.Down += down
	d.Up += up
	p.st.TotalDown += down
	p.st.TotalUp += up
	if s := p.st.Servers[p.key]; s != nil {
		s.Down += down
		s.Up += up
	}
	p.live.SessDown += down
	p.live.SessUp += up
	p.live.Speed = append(p.live.Speed, [2]float64{float64(down), float64(up)})
	if len(p.live.Speed) > 120 {
		p.live.Speed = p.live.Speed[len(p.live.Speed)-120:]
	}
	p.live.ConnCount = len(conns)
	if len(conns) > 60 {
		conns = conns[:60]
	}
	p.live.Conns = conns
}

// tick runs every second: the reset asked by the app, live.json every two seconds, stats.json every 30.
func (p *phoneStats) tick() {
	if p.dir == "" {
		return
	}
	p.n++
	if _, err := os.Stat(p.path("stats.reset")); err == nil {
		os.Remove(p.path("stats.reset"))
		p.st = Stats{Servers: map[string]*ServerStat{}}
		p.st.Servers[p.key] = &ServerStat{Last: time.Now().Unix()}
		p.start = time.Now()
		p.live = liveStats{SessSince: p.start.Unix(), IP: p.live.IP, Loc: p.live.Loc}
		p.save()
	}
	if p.n%2 == 0 {
		p.live.Updated = time.Now().Unix()
		writeJSON(p.path("live.json"), p.live)
	}
	if time.Since(p.saved) > 30*time.Second {
		p.save()
	}
}

func (p *phoneStats) save() {
	sec := int64(time.Since(p.start).Seconds())
	st := p.st // the session's time goes in without being counted twice
	st.Seconds += sec
	servers := make(map[string]*ServerStat, len(st.Servers))
	for k, v := range st.Servers {
		c := *v
		if k == p.key {
			c.Seconds += sec
		}
		servers[k] = &c
	}
	st.Servers = servers
	writeJSON(p.path("stats.json"), st)
	p.saved = time.Now()
}

func (p *phoneStats) end() {
	if p.dir == "" {
		return
	}
	p.save()
	os.Remove(p.path("live.json"))
}

func writeJSON(path string, v any) {
	b, _ := json.Marshal(v)
	tmp := path + ".tmp"
	if os.WriteFile(tmp, b, 0600) == nil {
		os.Rename(tmp, path)
	}
}
