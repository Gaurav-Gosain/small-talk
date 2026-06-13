package main

// Client for the on-robot reachy_mini daemon: ws://<host>:8000/ws/sdk, raw
// JSON commands (the same protocol the Python SDK's WSClient speaks).

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

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
