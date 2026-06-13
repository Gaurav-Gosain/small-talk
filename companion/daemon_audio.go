package main

// Audio sink that publishes opus RTP packets to the local reachy_mini daemon
// via a WebRTC peer connection (sendrecv on a "consumer" session against the
// daemon's webrtcsink). The daemon owns the speaker hardware on Reachy OS,
// so dropping the binary on a robot with no ffmpeg/mpv installed still gets
// audio through — gst-plugins-rs's gstwebrtc-api signaling, spoken natively
// from Go using pion.
//
// Protocol reference: gst-plugins-rs/net/webrtc/protocol.md. The message
// types we exercise are: welcome, setPeerStatus, peerStatusChanged, list,
// startSession, sessionStarted, peer (carrying sdp + ice), endSession.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const (
	// The producer the daemon registers as (see media_server.py — meta name).
	daemonProducerName = "reachymini"
	// Default signaling port for webrtcsink's embedded server.
	daemonSignalingPort = "8443"
)

// audioSink is the common interface main.go uses for an outbound audio path —
// implemented by both the exec'd Player (ffplay/ffmpeg/mpv child) and
// DaemonAudio (WebRTC peer to the on-robot daemon).
type audioSink interface {
	WriteRTP(*rtp.Packet) error
	Close()
}

type gstSigMsg struct {
	Type      string          `json:"type"`
	PeerID    string          `json:"peerId,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Roles     []string        `json:"roles,omitempty"`
	Meta      json.RawMessage `json:"meta,omitempty"`
	Producers []gstProducer   `json:"producers,omitempty"`
	SDP       *gstSDP         `json:"sdp,omitempty"`
	ICE       *gstICE         `json:"ice,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type gstProducer struct {
	ID   string          `json:"id"`
	Meta json.RawMessage `json:"meta"`
}

type gstSDP struct {
	Type string `json:"type"` // "offer" or "answer"
	SDP  string `json:"sdp"`
}

type gstICE struct {
	Candidate     string  `json:"candidate"`
	SDPMLineIndex *uint16 `json:"sdpMLineIndex,omitempty"`
	SDPMid        *string `json:"sdpMid,omitempty"`
}

// DaemonAudio publishes opus RTP into the daemon's speaker via WebRTC.
type DaemonAudio struct {
	label string

	pc    *webrtc.PeerConnection
	track *webrtc.TrackLocalStaticRTP
	ws    *websocket.Conn

	sessionID string
	sessionMu sync.Mutex

	cancel    context.CancelFunc
	closeOnce sync.Once
}

// dialDaemonAudio opens a WebRTC peer to the daemon's webrtcsink at
// signalingHost:8443 and returns once the connection is fully established
// (ICE connected). label is used in log lines.
func dialDaemonAudio(robotAddr, label string) (*DaemonAudio, error) {
	host, _, err := net.SplitHostPort(robotAddr)
	if err != nil {
		host = robotAddr
	}
	signalingURL := (&url.URL{Scheme: "ws", Host: net.JoinHostPort(host, daemonSignalingPort)}).String()

	dialer := websocket.DefaultDialer
	ctxDial, cancelDial := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDial()
	ws, _, err := dialer.DialContext(ctxDial, signalingURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial signaling %s: %w", signalingURL, err)
	}

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		_ = ws.Close()
		return nil, fmt.Errorf("new peerconn: %w", err)
	}

	// Outbound opus track. Pion overwrites SSRC/PT on WriteRTP to match the
	// negotiated track; seqno and timestamp pass through, so paced 20 ms opus
	// frames from LiveKit play out at the same cadence on the daemon.
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"audio", "smalltalk-companion",
	)
	if err != nil {
		_ = pc.Close()
		_ = ws.Close()
		return nil, fmt.Errorf("new track: %w", err)
	}
	if _, err := pc.AddTrack(track); err != nil {
		_ = pc.Close()
		_ = ws.Close()
		return nil, fmt.Errorf("add track: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	d := &DaemonAudio{
		label:  label,
		pc:     pc,
		track:  track,
		ws:     ws,
		cancel: cancel,
	}

	var wsMu sync.Mutex
	send := func(m gstSigMsg) error {
		b, err := json.Marshal(m)
		if err != nil {
			return err
		}
		wsMu.Lock()
		defer wsMu.Unlock()
		return ws.WriteMessage(websocket.TextMessage, b)
	}

	connected := make(chan error, 1)
	signalDone := func(err error) {
		select {
		case connected <- err:
		default:
		}
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		ji := c.ToJSON()
		d.sessionMu.Lock()
		sid := d.sessionID
		d.sessionMu.Unlock()
		if sid == "" {
			return
		}
		if err := send(gstSigMsg{
			Type:      "peer",
			SessionID: sid,
			ICE: &gstICE{
				Candidate:     ji.Candidate,
				SDPMLineIndex: ji.SDPMLineIndex,
				SDPMid:        ji.SDPMid,
			},
		}); err != nil {
			log.Printf("📞 %s: ice send: %v", label, err)
		}
	})
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		switch s {
		case webrtc.PeerConnectionStateConnected:
			signalDone(nil)
		case webrtc.PeerConnectionStateFailed,
			webrtc.PeerConnectionStateDisconnected,
			webrtc.PeerConnectionStateClosed:
			signalDone(fmt.Errorf("peer connection %s", s))
		}
	})

	go d.readSignalingLoop(ctx, send, signalDone)

	select {
	case err := <-connected:
		if err != nil {
			d.Close()
			return nil, err
		}
		log.Printf("🔊 %s via reachy_mini daemon (webrtc)", label)
		return d, nil
	case <-time.After(20 * time.Second):
		d.Close()
		return nil, fmt.Errorf("daemon webrtc connect timeout")
	}
}

func (d *DaemonAudio) readSignalingLoop(ctx context.Context, send func(gstSigMsg) error, signalDone func(error)) {
	for {
		if ctx.Err() != nil {
			return
		}
		_, raw, err := d.ws.ReadMessage()
		if err != nil {
			signalDone(fmt.Errorf("signaling read: %w", err))
			return
		}
		var m gstSigMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		switch m.Type {
		case "welcome":
			if err := send(gstSigMsg{Type: "setPeerStatus", Roles: []string{"listener"}}); err != nil {
				signalDone(fmt.Errorf("setPeerStatus: %w", err))
				return
			}
		case "peerStatusChanged":
			isListener := false
			for _, r := range m.Roles {
				if r == "listener" {
					isListener = true
				}
			}
			if isListener {
				if err := send(gstSigMsg{Type: "list"}); err != nil {
					signalDone(fmt.Errorf("list: %w", err))
					return
				}
			}
		case "list":
			producerID := pickProducer(m.Producers)
			if producerID == "" {
				signalDone(fmt.Errorf("daemon has no producer named %q", daemonProducerName))
				return
			}
			if err := send(gstSigMsg{Type: "startSession", PeerID: producerID}); err != nil {
				signalDone(fmt.Errorf("startSession: %w", err))
				return
			}
		case "sessionStarted":
			d.sessionMu.Lock()
			d.sessionID = m.SessionID
			d.sessionMu.Unlock()
		case "peer":
			if m.SDP != nil && m.SDP.Type == "offer" {
				if err := d.handleOffer(m.SessionID, m.SDP.SDP, send); err != nil {
					signalDone(err)
					return
				}
			}
			if m.ICE != nil && m.ICE.Candidate != "" {
				init := webrtc.ICECandidateInit{Candidate: m.ICE.Candidate}
				if m.ICE.SDPMLineIndex != nil {
					init.SDPMLineIndex = m.ICE.SDPMLineIndex
				}
				if m.ICE.SDPMid != nil {
					init.SDPMid = m.ICE.SDPMid
				}
				if err := d.pc.AddICECandidate(init); err != nil {
					log.Printf("📞 %s: add ice: %v", d.label, err)
				}
			}
		case "endSession":
			signalDone(fmt.Errorf("session ended by daemon"))
			return
		case "error":
			log.Printf("📞 %s: signaling error: %s", d.label, m.Error)
		}
	}
}

func (d *DaemonAudio) handleOffer(sessionID, sdp string, send func(gstSigMsg) error) error {
	if err := d.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer, SDP: sdp,
	}); err != nil {
		return fmt.Errorf("set remote desc: %w", err)
	}
	answer, err := d.pc.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("create answer: %w", err)
	}
	if err := d.pc.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("set local desc: %w", err)
	}
	return send(gstSigMsg{
		Type:      "peer",
		SessionID: sessionID,
		SDP:       &gstSDP{Type: "answer", SDP: answer.SDP},
	})
}

func pickProducer(producers []gstProducer) string {
	// Prefer the explicitly named reachymini producer; fall back to the first.
	for _, p := range producers {
		var meta struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(p.Meta, &meta); err == nil && meta.Name == daemonProducerName {
			return p.ID
		}
	}
	if len(producers) > 0 {
		return producers[0].ID
	}
	return ""
}

func (d *DaemonAudio) WriteRTP(pkt *rtp.Packet) error {
	return d.track.WriteRTP(pkt)
}

func (d *DaemonAudio) Close() {
	d.closeOnce.Do(func() {
		d.cancel()
		_ = d.ws.Close()
		_ = d.pc.Close()
	})
}

// daemonSignalingReachable returns true if a WebSocket can be established to
// the daemon's signaling endpoint within timeout. Used to choose between the
// exec'd-player path and the daemon path at startup.
func daemonSignalingReachable(robotAddr string, timeout time.Duration) bool {
	host, _, err := net.SplitHostPort(robotAddr)
	if err != nil {
		host = robotAddr
	}
	addr := net.JoinHostPort(host, daemonSignalingPort)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
