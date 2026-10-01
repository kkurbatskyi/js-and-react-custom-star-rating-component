# Brief: AUDIO (name: sound-designer, dev port 5308)

You compose Sidereal's sound: a generative ambient score that morphs with what you're looking at, plus
tasteful UI and travel sounds. Everything synthesised with the Web Audio API — no files.

## You own
src/audio/** (replace the stub `createAudioDirector(): IAudioDirector`, keep the contract), dev/audio.html + dev/audio.ts.

## Build
- Architecture: master bus → gentle compressor/limiter → destination; convolution reverb with a
  synthesised impulse response (decaying filtered noise, stereo decorrelated); voices capped; everything
  scheduled with the AudioContext clock (lookahead scheduler), not setInterval drift.
- Score: an evolving pad (detuned saw/triangle stacks through slowly modulated low-pass filters, long
  envelopes), a deep sub drone, and sparse melodic motifs (FM bells / soft plucks) from a scale chosen
  per scene. Mapping: galaxy view = vast, slow, choral (formant-filtered noise/pads, very sparse);
  system view = warmer and more melodic, key & mode seeded by the star (hot stars → brighter timbres, higher
  register, Lydian/major; cool red dwarfs → darker, lower, Dorian/minor); planet view = textural layer by
  planet type (gas giant low rumble, ice glassy shimmer, lava crackle, terran wind/ocean wash).
  Crossfade smoothly (several seconds) on scene change; no clicks (ramp every param change).
- SFX: hover (barely audible tick), select, open/close, travel-start (riser + whoosh; `setTravel` drives a
  continuous warp layer), arrive (a soft blooming chord in the new key), rate (a chime whose pitch climbs
  with the star count — 5 stars sounds triumphant), error.
- Lifecycle: `unlock()` from a user gesture (create/resume context), suspend when the tab is hidden,
  setEnabled/setVolume with ramps, dispose cleanly. CPU-light.
- You can't hear, so verify numerically: dev/audio.ts renders scenes through an OfflineAudioContext
  (same graph builder) and reports RMS, peak (no clipping), spectral centroid per scene, silence gaps and
  NaN checks; unit-test the pure parts (scale/key selection, mapping, scheduler maths). Reason carefully about
  musicality — voicings, consonance, envelope times — and document the design in src/audio/README.md.
