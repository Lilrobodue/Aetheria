# Aetheria chance test

Are the number patterns in the 27 Aetheria frequencies found, or built in?
This folder holds the whole test, so anyone can rerun it and get the same
numbers.

- `PREREGISTRATION.md`: the plan, committed before anything ran.
- `chance_test.py`: the test. Writes `results.json`.
- `crosscheck.py`: an independent recount of the main result in plain Python.
- `exploratory.py`: follow-ups written after seeing the results (not part of
  the plan). Writes `exploratory.json`.

Run it (Python 3.9+ with numpy; about ten seconds):

    python3 chance_test.py
    python3 crosscheck.py
    python3 exploratory.py

## Results in one paragraph

Of the 13 claims tested, 3 hold for every evenly spaced set of nine (the magic
squares), 6 hold for more than 5% of comparable sets, 1 for about 1%, and 3 for
fewer than 1% (111 + 243 = 354, 243 = 3^5, and the mirror number 6336). Taken
together on a fixed catalogue of 15 patterns, Aetheria's choice of intervals
(243, 354) shows 6, and only 0.48% of the 810,000 possible pairs show as many,
which the plan calls unusual. Whether that is a discovery or a design depends on
how 243 and 354 were chosen. None of this bears on what the tones do to people.

## What Joe told us afterwards

Joe made 354 by adding the first two intervals (111 + 243), so claim 6 is a
design, not a discovery. `exploratory.py` rescores with that rule built in.
Once HEAD = GUT + HEART, a HEART interval that is a multiple of 9 (as 243 is)
brings claims 4, 5, 7, 9 and 10 with it, every time. What is left: 243 being a
power of three (2 of the 100 multiples of 9 from 100 to 999) and the top
frequency 6336 being a palindrome (3 of those 100: 144, 243 and 342). On the
15-pattern list, 13 of the 900 possible HEART intervals score as high as 243,
mostly repdigits like 222 and 333.

## A bug found and fixed before reporting

The first run had a palindrome check that miscounted numbers when longer
numbers were in the same batch (it flagged 6336 as not a palindrome). The
check against the framework's own values caught it; the fix and a test of the
number tools are in the commit after the plan. Only the corrected run is
reported.
