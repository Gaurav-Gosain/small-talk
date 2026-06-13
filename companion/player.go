package main

// Audio out: two paths.
//
//   1. Exec a decoder child (ffplay/ffmpeg/mpv) and pipe Ogg/Opus to its
//      stdin. Used off-robot (the README's local-listen mode) and on robots
//      that ship one of those binaries.
//   2. Open a WebRTC peer to the on-robot reachy_mini daemon and forward the
//      opus RTP packets directly (see daemon_audio.go). Used on a vanilla
//      Reachy Mini where the daemon holds the USB speaker — drop the binary
//      on the robot, no flags, no decoder install needed.
//
// One sink per remote LiveKit track. The daemon's tee mixes overlapping
// sinks on the speaker.

import (
	"fmt"
	"io"
	"log"
	"os/exec"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

var playerCandidates = [][]string{
	{"ffplay", "-hide_banner", "-loglevel", "error", "-nodisp", "-fflags", "nobuffer", "-i", "pipe:0"},
	{"ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "alsa", "default"},
	{"mpv", "--really-quiet", "--no-video", "-"},
}

// audioFactory opens one sink per track. label is "Name (identity)" — used
// by the underlying impl for log lines.
type audioFactory func(label string) (audioSink, error)

// findAudio picks the right output path. Order:
//   - explicit -player override → exec'd shell command
//   - ffplay/ffmpeg/mpv on PATH → exec'd child
//   - reachy_mini daemon signaling reachable → daemon WebRTC peer
//   - otherwise error
//
// description is a short label used at startup to tell the user what was
// picked. castOnly is true when the chosen path can only handle a single
// concurrent sink (the daemon path) — main.go then skips creating sinks for
// non-cast hosts to dodge a name-collision bug in the daemon's gst pipeline
// when more than one consumer connects at the same time.
func findAudio(override, robotAddr string) (factory audioFactory, description string, castOnly bool, err error) {
	if override != "" {
		cmd := []string{"sh", "-c", override + " <&0"}
		return func(label string) (audioSink, error) { return NewPlayer(cmd, label) },
			"custom -player command",
			false,
			nil
	}
	for _, c := range playerCandidates {
		if _, err := exec.LookPath(c[0]); err == nil {
			cmd := c
			return func(label string) (audioSink, error) { return NewPlayer(cmd, label) },
				c[0],
				false,
				nil
		}
	}
	if daemonSignalingReachable(robotAddr, 500*time.Millisecond) {
		return func(label string) (audioSink, error) { return dialDaemonAudio(robotAddr, label) },
			"reachy_mini daemon (webrtc)",
			true,
			nil
	}
	return nil, "", false, fmt.Errorf("no audio path found: install ffplay/ffmpeg/mpv, run a reachy_mini daemon at %s, or pass -player", robotAddr)
}

// Player feeds RTP opus packets from one track into a decoder child process.
type Player struct {
	cmd *exec.Cmd
	in  io.WriteCloser
	ogg *oggwriter.OggWriter
}

func NewPlayer(playerCmd []string, label string) (*Player, error) {
	cmd := exec.Command(playerCmd[0], playerCmd[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	ogg, err := oggwriter.NewWith(stdin, 48000, 2)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}
	log.Printf("🔊 playing %s via %s", label, playerCmd[0])
	return &Player{cmd: cmd, in: stdin, ogg: ogg}, nil
}

func (p *Player) WriteRTP(pkt *rtp.Packet) error { return p.ogg.WriteRTP(pkt) }

func (p *Player) Close() {
	_ = p.ogg.Close()
	_ = p.in.Close()
	_ = p.cmd.Wait()
}
