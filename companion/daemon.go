package main

// Client for the on-robot reachy_mini daemon: ws://<host>:8000/ws/sdk, raw
// JSON commands (the same protocol the Python SDK's WSClient speaks).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// EnsureReady starts the daemon's hardware backend (motors + audio) and
// wakes the robot, then waits for the backend to come up. Same sequence
// reachy_vision's main.odin runs at startup: POST /api/daemon/start, poll
// /api/daemon/status until backend_status is non-null (takes ~10–15 s
// after a cold wake), then a 2 s grace period so the publishers actually
// start producing frames/audio before we touch them. Idempotent: a no-op
// when the daemon is already up and the robot is awake.
func EnsureReady(robotAddr string) error {
	base := "http://" + robotAddr
	client := &http.Client{Timeout: 5 * time.Second}

	req, _ := http.NewRequest(http.MethodPost, base+"/api/daemon/start?wake_up=true", nil)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("daemon start: %w", err)
	}
	resp.Body.Close()

	// Poll for backend_status going non-null. Same heuristic as reachy_vision's
	// robot_backend_up — a substring check on the JSON body — because we
	// only care whether the field is JSON null, not what's inside it.
	deadline := time.Now().Add(25 * time.Second)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		r, err := client.Get(base + "/api/daemon/status")
		if err == nil {
			body, _ := io.ReadAll(r.Body)
			r.Body.Close()
			if !bytes.Contains(body, []byte(`"backend_status":null`)) {
				// Grace period — backend reports up, but the camera/audio
				// publishers need another moment to actually start pushing.
				time.Sleep(2 * time.Second)
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("daemon backend did not come up within 25s")
		}
		<-tick.C
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
