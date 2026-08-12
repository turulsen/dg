# Table Radio audio soundscape (ambient layers + stinger soundboard) — abandoned

**Branch:** this one (`design-graveyard/table-radio-audio-soundscape`),
forked from `claude/delta-green-agent-hub-sn79d4` at the point it was
dropped.
**Status:** abandoned, never merged to `main`. `main` was never touched
by any of this work.

## What was built

Two additions to the existing Table Radio widget:

1. **Ambient layers** — rain/wind/static loops the Handler could toggle
   on underneath whatever track was tuned, synced per-channel via a new
   `ambient_layers` field piggybacked on the existing `get_now_playing`
   poll. (A fourth layer, "machine hum," was cut early after a listen —
   didn't sound like a hum.)
2. **Stingers** — a 13-button soundboard (knock, wood creak, 4 gunshot
   variants, 3 explosion grades, 2 screams, 2 child-voice sounds) firing
   one-shot SFX to every listener via a `last_stinger` field on the same
   poll, architecturally separate from the ambient toggle state since a
   stinger fires once rather than persisting on/off.

Both shipped with full Playwright regression coverage (399/399 passing
at every step) and a committed Apps Script backend reference at
`apps-script/table-radio-audio-additions.gs` — that commit was itself a
process improvement (previous backend additions were only ever handed
over via chat, never version-controlled) that's arguably worth keeping
even though the feature it was written for is being dropped here.

## Why it was dropped

Real-device audio quality feedback, after the user generated and
listened to all the procedurally-synthesized clips (numpy + ffmpeg, no
sourced/licensed audio):

- Ambient: rain, wind, and static (interference) sounded fine. Machine
  hum did not and was cut before this retrospective was even written.
- Stingers: of the 13, only the 4 gunshot variants (pistol, shotgun,
  semi-auto rifle, full-auto burst) were usable. Knock, wood creak, the
  3 explosion grades, and all 4 vocal sounds (2 screams, child laughter,
  child crying) did not land — consistent with the up-front caveat given
  before attempting the vocal ones (noise synthesis can't produce real
  vocal-cord physics), but the miss extended further than expected, to
  knock/creak/explosions too.

Rather than iterate further on procedural synthesis for a feature whose
core premise (usable audio) wasn't landing, the user chose to drop the
whole soundscape effort and pursue a different, unrelated bug (PDF
character import).

## What's here

Three commits from `claude/delta-green-agent-hub-sn79d4`, preserved as
history: the ambient layers feature, the stingers feature (plus dropping
"hum"), and the Apps Script backend commit. The working feature branch
has been reset back to `main`.

If this is revisited, the clear path forward per the user's own
feedback is real recordings (Freesound.org, Zapsplat, BBC Sound
Effects, OpenGameArt, Pixabay were suggested) rather than further
procedural synthesis attempts, at least for anything beyond simple
noise/impulse sounds (gunshots proved synthesis-friendly; vocals and
some percussive/explosive sounds did not).
