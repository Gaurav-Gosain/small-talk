package main

// Audio out: we stay CGO-free by piping an Ogg/Opus stream into whatever
// decoder the robot already has (the Reachy OS image ships ffmpeg). One child
// player per remote track; ALSA's dmix blends the rare overlaps.

import (
	"fmt"
	"io"
	"log"
	"os/exec"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

var playerCandidates = [][]string{
	{"ffplay", "-hide_banner", "-loglevel", "error", "-nodisp", "-fflags", "nobuffer", "-i", "pipe:0"},
	{"ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "alsa", "default"},
	{"mpv", "--really-quiet", "--no-video", "-"},
}

func findPlayer(override string) ([]string, error) {
	if override != "" {
		return []string{"sh", "-c", override + " <&0"}, nil
	}
	for _, c := range playerCandidates {
		if _, err := exec.LookPath(c[0]); err == nil {
			return c, nil
		}
	}
	return nil, fmt.Errorf("no audio player found (need ffplay, ffmpeg or mpv on the robot)")
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
