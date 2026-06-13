package main

// Client for the on-robot reachy_mini daemon: ws://<host>:8000/ws/sdk, raw
// JSON commands (the same protocol the Python SDK's WSClient speaks).

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// EnsureReady starts the daemon's hardware backend (motors + audio) and
// wakes the robot, then waits until backend_status.ready flips to true.
// Idempotent: safe to call when the daemon is already up and the robot is
// already awake — same shape as reachy_vision's deploy.sh `wake` command.
// Calling it before DialDaemon is what makes the binary "just work" after a
// reboot or after `goto_sleep`.
func EnsureReady(robotAddr string, timeout time.Duration) error {
	base := "http://" + robotAddr
	client := &http.Client{Timeout: 5 * time.Second}

	req, _ := http.NewRequest(http.MethodPost, base+"/api/daemon/start?wake_up=true", nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("daemon start: %w", err)
	}
	resp.Body.Close()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	tick := time.NewTicker(300 * time.Millisecond)
	defer tick.Stop()

	var lastState, lastErr string
	for {
		r, err := client.Get(base + "/api/daemon/status")
		if err == nil {
			var s struct {
				State         string `json:"state"`
				BackendStatus struct {
					Ready bool    `json:"ready"`
					Error *string `json:"error"`
				} `json:"backend_status"`
			}
			if json.NewDecoder(r.Body).Decode(&s) == nil {
				lastState = s.State
				if s.BackendStatus.Error != nil {
					lastErr = *s.BackendStatus.Error
				}
				if s.State == "running" && s.BackendStatus.Ready {
					r.Body.Close()
					return nil
				}
			}
			r.Body.Close()
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("daemon backend not ready within %s (state=%q err=%q)", timeout, lastState, lastErr)
		case <-tick.C:
		}
	}
}

type Daemon struct {
	ws  *websocket.Conn
	out chan []byte
}

type fullTarget struct {
	Type     string     `json:"type"` // "set_full_target"
	Head     []float64  `json:"head,omitempty"`
	Antennas []float64  `json:"antennas,omitempty"`
	BodyYaw  *float64   `json:"body_yaw,omitempty"`
}

func DialDaemon(addr string) (*Daemon, error) {
	url := fmt.Sprintf("ws://%s/ws/sdk", addr)
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return nil, fmt.Errorf("daemon at %s: %w", url, err)
	}
	d := &Daemon{ws: ws, out: make(chan []byte, 64)}
	// drain server messages (status/joint streams) so the socket stays healthy
	go func() {
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()
	// single writer goroutine — gorilla allows only one concurrent writer
	go func() {
		for msg := range d.out {
			if err := ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Printf("daemon write failed: %v", err)
				return
			}
		}
	}()
	return d, nil
}

func (d *Daemon) send(v any) {
	b, _ := json.Marshal(v)
	select {
	case d.out <- b:
	default: // drop rather than stall the 50 Hz loop
	}
}

func (d *Daemon) SetFullTarget(p Pose) {
	yaw := p.BodyYaw
	d.send(fullTarget{
		Type:     "set_full_target",
		Head:     p.Head[:],
		Antennas: p.Antennas[:],
		BodyYaw:  &yaw,
	})
}

func (d *Daemon) Command(typ string) {
	d.send(map[string]string{"type": typ}) // e.g. wake_up / goto_sleep
}

func (d *Daemon) Close() {
	// settle back to neutral, then sleep pose
	d.Command("goto_sleep")
	time.Sleep(1500 * time.Millisecond)
	close(d.out)
	_ = d.ws.Close()
}
