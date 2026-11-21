# Meanings test

When someone listens to one hidden Aetheria tone for as long as the Aetheria
protocol gives its layer (GUT 45 minutes, HEART 30, HEAD 20), does the meaning
they pick out of four match the tone's own more often than chance, 1 in 4?

- `PREREGISTRATION.md`: the plan, with the 27 meanings as shown, pushed to
  GitHub (commit 3fd2903, 16:49 Mountain, 21 Nov 2026) before any sitting.
- `analyze.py`: the analysis.
- `tests/make_sittings.py`: testing only; writes simulated sittings in the
  app's file format.

## The app

[Meanings Test](https://big-banana-studios.github.io/meanings-test/) (Big
Banana Studios, any phone browser) runs a sitting as the plan describes: it
draws one of the 27 tones and three other meanings from its layer, seals the
draw with a SHA-256 fingerprint before listening, plays the tone for its
layer's length, asks how high it felt and whether the listener recognised it,
and only then shows the four meanings. The draw stays sealed (base64) in the
file, and the app never shows which tone it was. `?demo` (with `&speed=N`)
runs a shortened sitting; demo files are marked and never counted.

## The analysis

- `python3 -I analyze.py --check DIR`: blind. Lists which files count and why
  others don't, checking each fingerprint against its sealed draw, without
  showing tones or hits.
- `python3 -I analyze.py DIR`: the pre-registered test. Refuses to run before
  54 sittings count.

Calibration on simulated sittings: over 200 sets of 54 sittings with a
listener who guesses, the test called "above chance" 7 times (3.5%; the exact
test's size at 54 is 3.3%). With a true hit rate of 50% it called it in 49 of
50 sets, estimating 0.496 on average, with the 95% interval covering 0.5 in 49
of 50.

The same runs show why the height check matters. A simulated listener who
judges the right third of the layer 70% of the time would, by height alone,
expect about 26 hits in 54 (48%), well past the 20 the primary test needs. The
meanings climb with pitch, so hits above chance only point past pitch if they
also beat the height-only guess.
