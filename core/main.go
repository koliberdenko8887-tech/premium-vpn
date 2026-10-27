package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"
)

// Премиум VPN core for Android: one binary with sing-box (tunnel, DNS, rules) and Xray (servers).
// The app runs it as lib/<abi>/libpvcore.so:
//   run <params.json>   VPN session, talks to the app over an abstract unix socket
//   sub <url>           download a subscription, print servers as JSON
//   parse               read share links from stdin, print servers as JSON
//   ping                read [{"id","host","port"}] from stdin, print {"id": ms}
//   rping               the same through each server: {"settings","servers"} from stdin

func urlParse(s string) (*url.URL, error) { return url.Parse(s) }

func out(v any) {
	b, _ := json.Marshal(v)
	os.Stdout.Write(append(b, '\n'))
}

func main() {
	setupResolver()
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: run|sub|parse|ping")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "run":
		if err := runVPN(os.Args[2]); err != nil {
			fmt.Fprintln(os.Stderr, "ошибка:", err)
			os.Exit(1)
		}
	case "sub":
		r, err := fetchSubscriptionWith(&http.Client{Timeout: 25 * time.Second, Transport: &http.Transport{Proxy: nil, DialContext: physDialer(10 * time.Second).DialContext}}, os.Args[2])
		if err != nil {
			out(map[string]any{"error": err.Error()})
			return
		}
		number(r.Servers)
		out(r)
	case "parse":
		b, _ := io.ReadAll(os.Stdin)
		list, errs := parseText(string(b))
		number(list)
		out(map[string]any{"Servers": list, "Errors": errs})
	case "ping":
		var list []struct {
			ID   string `json:"id"`
			Host string `json:"host"`
			Port int    `json:"port"`
		}
		json.NewDecoder(os.Stdin).Decode(&list)
		res := map[string]int{}
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 16)
		for _, s := range list {
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				ms := tcpPing(s.Host, s.Port)
				mu.Lock()
				res[s.ID] = ms
				mu.Unlock()
			}()
		}
		wg.Wait()
		out(res)
	case "rping": // {"settings","servers"} from stdin, {"id": ms} out
		b, _ := io.ReadAll(os.Stdin)
		out(realPingAll(b))
	case "version":
		fmt.Println("0.2.0")
	}
}

func number(list []*Server) {
	for i, s := range list {
		if s.ID == "" {
			s.ID = "s" + strconv.Itoa(i+1)
		}
	}
}
