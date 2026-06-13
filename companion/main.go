// Small Talk companion — run this ON a physical Reachy Mini.
//
// It joins a Small Talk show as a listener: the room's voices play through the
// robot's speaker, and the head/antennas/body move with the speech exactly like
// the digital twins on the web UI (same motion model).
//
//	./smalltalk-reachy -room hot-dog-court
//	./smalltalk-reachy -room my-show-1a2b -only gen-my-show-1a2b-s1   # embody one host
//
// Build for the robot:  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o smalltalk-reachy .
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-logr/logr"
	"github.com/livekit/protocol/logger"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
)

type tokenResp struct {
	Token    string `json:"token"`
	URL      string `json:"url"`
	Identity string `json:"identity"`
}

func fetchToken(space, room, name string, meta map[string]any) (*tokenResp, error) {
	payload := map[string]any{"room": room, "name": name, "device": true}
	for k, v := range meta {
		if s, ok := v.(string); !ok || s != "" {
			payload[k] = v
		}
	}
	body, _ := json.Marshal(payload)
	r, err := http.Post(space+"/api/token", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("token: HTTP %d", r.StatusCode)
	}
	var t tokenResp
	return &t, json.NewDecoder(r.Body).Decode(&t)
}

// packet-size → speech level: opus VBR packet size tracks energy closely, so we
// get a usable intensity envelope without decoding any audio (keeps us CGO-free).
func packetLevel(payloadLen int) float64 {
	return math.Max(0, math.Min(1, float64(payloadLen-45)/200.0))
}

func main() {
	space := flag.String("space", "https://build-small-hackathon-small-talk.hf.space", "Small Talk space base URL")
	room := flag.String("room", "", "room id to join (e.g. hot-dog-court)")
	name := flag.String("name", "Reachy", "device display name")
	robot := flag.String("robot", "localhost:8000", "reachy_mini daemon host:port")
	color := flag.String("color", "#49e6c8", "card accent colour")
	persona := flag.String("persona", "a real Reachy Mini, live in the room", "card persona blurb")
	voice := flag.String("voice", "", "voice description for this robot's TTS lines (when cast)")
	shell := flag.String("shell", "", "body/shell tint (hex)")
	hat := flag.String("hat", "", "hat prop slug")
	face := flag.String("face", "", "face prop slug")
	neck := flag.String("neck", "", "neck prop slug")
	only := flag.String("only", "", "only play/move for participants whose identity contains this")
	playerArg := flag.String("player", "", "override audio player command (reads ogg/opus on stdin)")
	noMotors := flag.Bool("no-motors", false, "don't connect to the robot daemon (audio + logs only)")
	wake := flag.Bool("wake", false, "send wake_up to the daemon on start")
	verbose := flag.Bool("v", false, "verbose webrtc logs")
	flag.Parse()
	if *room == "" {
		flag.Usage()
		os.Exit(2)
	}
	if !*verbose {
		lksdk.SetLogger(logger.LogRLogger(logr.Discard()))
	}

	playerCmd, err := findPlayer(*playerArg)
	if err != nil {
		log.Fatal(err)
	}

	// --- robot ---
	var daemon *Daemon
	if !*noMotors {
		daemon, err = DialDaemon(*robot)
		if err != nil {
			log.Fatalf("robot daemon: %v (use -no-motors to run audio-only)", err)
		}
		if *wake {
			daemon.Command("wake_up")
			time.Sleep(3 * time.Second)
		}
		log.Printf("🤖 motors connected (%s)", *robot)
	}

	motion := NewMotion()
	if daemon != nil {
		go func() {
			tick := time.NewTicker(20 * time.Millisecond) // 50 Hz, like the twin
			for range tick.C {
				daemon.SetFullTarget(motion.Tick())
			}
		}()
	}

	// --- LiveKit ---
	tok, err := fetchToken(*space, *room, *name, map[string]any{
		"color": *color, "persona": *persona, "voice": *voice, "bodyColor": *shell,
		"hat": *hat, "face": *face, "neck": *neck,
	})
	if err != nil {
		log.Fatalf("token from %s: %v", *space, err)
	}
	log.Printf("🎟  joined as %s", tok.Identity)

	var mu sync.Mutex
	players := map[string]*Player{}
	lastPkt := map[string]time.Time{}
	cast := false // true once the show casts THIS robot — then we speak only our lines
	done := make(chan struct{})  // closed on a terminal disconnect

	log.Printf("🎚  mode: listening to the whole room. If the show casts this Reachy " +
		"as a host, it will switch to speaking ONLY its own lines.")

	cb := lksdk.NewRoomCallback()
	cb.OnTrackSubscribed = func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
		id := rp.Identity()
		if track.Kind() != webrtc.RTPCodecTypeAudio || strings.HasPrefix(id, "stage-") {
			return
		}
		if *only != "" && !strings.Contains(id, *only) {
			log.Printf("⏭  skipping %s (-only %s)", id, *only)
			return
		}
		var meta struct {
			ForDevice string `json:"forDevice"`
		}
		_ = json.Unmarshal([]byte(rp.Metadata()), &meta)
		mine := meta.ForDevice == tok.Identity
		if meta.ForDevice != "" && !mine {
			log.Printf("⏭  %s speaks through another robot — staying quiet", rp.Name())
			return
		}
		mu.Lock()
		if mine && !cast {
			cast = true
			for tid, pl := range players { // the room speaker becomes a cast member
				pl.Close()
				delete(players, tid)
			}
			log.Printf("🎭 cast as %q — this Reachy now speaks ONLY its own lines "+
				"(the other hosts play through the web view)", rp.Name())
		}
		if !mine && cast {
			mu.Unlock()
			log.Printf("🔇 %s is another host — staying quiet (this Reachy is cast)", rp.Name())
			return
		}
		mu.Unlock()
		p, err := NewPlayer(playerCmd, fmt.Sprintf("%s (%s)", rp.Name(), id))
		if err != nil {
			log.Printf("player for %s: %v", id, err)
			return
		}
		mu.Lock()
		players[id] = p
		mu.Unlock()
		go func() {
			defer p.Close()
			for {
				pkt, _, err := track.ReadRTP()
				if err != nil {
					return
				}
				_ = p.WriteRTP(pkt)
				motion.SetLevel(packetLevel(len(pkt.Payload)))
				mu.Lock()
				lastPkt[id] = time.Now()
				mu.Unlock()
			}
		}()
	}
	cb.OnDataPacket = func(data lksdk.DataPacket, params lksdk.DataReceiveParams) {
		if u, ok := data.(*lksdk.UserDataPacket); ok {
			var msg struct{ Type, Speaker, Text string }
			if json.Unmarshal(u.Payload, &msg) == nil && msg.Text != "" {
				if msg.Speaker != "" {
					log.Printf("💬 %s: %s", msg.Speaker, msg.Text)
				} else {
					log.Printf("ℹ️  %s", msg.Text)
				}
			}
		}
	}
	cb.OnDisconnected = func() {
		log.Println("disconnected from room")
		select {
		case <-done:
		default:
			close(done)
		}
	}

	lkRoom, err := lksdk.ConnectToRoomWithToken(tok.URL, tok.Token, cb, lksdk.WithAutoSubscribe(true))
	if err != nil {
		log.Fatalf("livekit connect: %v", err)
	}
	log.Printf("📡 on air in '%s' — the robots are talking through this Reachy", *room)

	// decay the level when packets stop (end of a line → settle to idle)
	go func() {
		for range time.Tick(120 * time.Millisecond) {
			mu.Lock()
			newest := time.Time{}
			for _, t := range lastPkt {
				if t.After(newest) {
					newest = t
				}
			}
			mu.Unlock()
			if time.Since(newest) > 350*time.Millisecond {
				motion.SetLevel(0)
			}
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	// exit cleanly on Ctrl-C; exit non-zero on an unexpected room drop so a
	// supervisor (systemd Restart=always, or `while true; do ...; done`) brings
	// the companion back — handy for a Reachy left running through a show.
	exit := 0
	select {
	case <-sig:
		log.Println("leaving…")
	case <-done:
		log.Println("room connection lost — exiting so a supervisor can restart")
		exit = 1
	}
	lkRoom.Disconnect()
	if daemon != nil {
		daemon.Close()
	}
	os.Exit(exit)
}
