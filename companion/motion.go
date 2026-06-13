package main

// The digital twin's motion model (frontend/src/reachy3d.js), ported to the
// robot's own frame (x forward, y left, z up): idle breathing + antenna sway,
// and a speech wobble whose amplitude follows the audio level envelope.

import (
	"math"
	"sync"
	"time"
)

const (
	d2r = math.Pi / 180

	breatheZ  = 0.005 // 5 mm vertical bob
	breatheHz = 0.1

	antSwayRad   = 15 * d2r // idle antenna sway
	antHz        = 0.5
	antSpeechRad = 7 * d2r // extra perk while talking
	antSpeechHz  = 1.6
	antRestR     = -0.1745 // INIT_ANTENNAS_JOINT_POSITIONS
	antRestL     = 0.1745

	bodyYawRad = 2.5 * d2r // slow idle "look around"
	bodyYawHz  = 0.06

	// speech sway: amplitude, frequency (level-scaled)
	swayPitch, swayPitchHz = 3.5 * d2r, 1.2  // nod
	swayYaw, swayYawHz     = 3.5 * d2r, 0.45 // shake
	swayRoll, swayRollHz   = 2.0 * d2r, 0.8  // tilt
	swayY, swayYHz         = 0.0045, 0.3     // lateral
	swayZ, swayZHz         = 0.00375, 0.4    // vertical
	swayX, swayXHz         = 0.00225, 0.22   // fore-aft

	attackS  = 0.09 // fast attack, slow release — same envelope as the twin
	releaseS = 0.25
)

// Motion turns a raw 0..1 speech level into smooth head/antenna/body targets.
type Motion struct {
	mu     sync.Mutex
	target float64 // raw level, set by the audio side
	level  float64 // smoothed envelope
	start  time.Time
	last   time.Time
	phase  float64
}

func NewMotion() *Motion {
	now := time.Now()
	return &Motion{start: now, last: now, phase: 1.7}
}

// SetLevel feeds the latest speech intensity (0..1).
func (m *Motion) SetLevel(v float64) {
	m.mu.Lock()
	m.target = math.Max(0, math.Min(1, v))
	m.mu.Unlock()
}

// Pose is one 50 Hz target for the daemon.
type Pose struct {
	Head     [16]float64 // row-major 4x4 SE3
	Antennas [2]float64  // [right, left] rad
	BodyYaw  float64
}

// Tick advances the envelope and returns the current pose.
func (m *Motion) Tick() Pose {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	dt := math.Min(now.Sub(m.last).Seconds(), 0.1)
	m.last = now
	t := now.Sub(m.start).Seconds()

	tau := releaseS
	if m.target > m.level {
		tau = attackS
	}
	m.level += (m.target - m.level) * (1 - math.Exp(-dt/tau))
	lvl := m.level
	ph := m.phase
	tau2 := 2 * math.Pi

	// idle breathing + speech sway, in the robot frame
	x := swayX * lvl * math.Sin(tau2*swayXHz*t+ph+3.1)
	y := swayY * lvl * math.Sin(tau2*swayYHz*t+ph+0.7)
	z := breatheZ*math.Sin(tau2*breatheHz*t) + swayZ*lvl*math.Sin(tau2*swayZHz*t+ph+1.9)
	pitch := swayPitch * lvl * math.Sin(tau2*swayPitchHz*t+ph)
	yaw := swayYaw * lvl * math.Sin(tau2*swayYawHz*t+ph+1.3)
	roll := swayRoll * lvl * math.Sin(tau2*swayRollHz*t+ph+2.6)

	antB := antSwayRad * math.Sin(tau2*antHz*t) * (0.3 + 0.7*lvl)
	antS := antSpeechRad * lvl * math.Sin(tau2*antSpeechHz*t+ph)
	bodyYaw := bodyYawRad * math.Sin(tau2*bodyYawHz*t+ph) * (1 - 0.6*lvl)

	return Pose{
		Head:     se3(x, y, z, roll, pitch, yaw),
		Antennas: [2]float64{antRestR - antB - antS, antRestL + antB + antS},
		BodyYaw:  bodyYaw,
	}
}

// se3 builds a row-major 4x4 from translation + intrinsic Rz(yaw)·Ry(pitch)·Rx(roll).
func se3(x, y, z, roll, pitch, yaw float64) [16]float64 {
	cr, sr := math.Cos(roll), math.Sin(roll)
	cp, sp := math.Cos(pitch), math.Sin(pitch)
	cy, sy := math.Cos(yaw), math.Sin(yaw)
	return [16]float64{
		cy * cp, cy*sp*sr - sy*cr, cy*sp*cr + sy*sr, x,
		sy * cp, sy*sp*sr + cy*cr, sy*sp*cr - cy*sr, y,
		-sp, cp * sr, cp * cr, z,
		0, 0, 0, 1,
	}
}
