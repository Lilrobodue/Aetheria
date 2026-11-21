# Aetheria chance test: pre-registration

Written and committed before any result was computed. The code that runs the
test is written to this plan; if the plan changes, the change is a new commit
with its reason, made before rerunning.

## The question

The 27 Aetheria frequencies carry a set of claimed number patterns: magic
squares, digit roots, interval relations, a cube centre. For each claim we ask
one thing: is it

- **by construction**: true of every frequency set built the way Aetheria's
  was built, so it follows from the recipe, not from anything found;
- **common**: true of at least 5% of comparable sets;
- **uncommon**: true of 1% to 5%;
- **rare**: true of fewer than 1%.

Then we ask the same question of the framework as a whole, counting every
pattern in a fixed catalogue at once (the look-elsewhere test), because a set
of numbers examined from enough angles always shows something.

This test says nothing about what the tones do to people. Only measurements on
people can.

## The frequencies under test

From `constants.ts` and `LoShu.md` in the Aetheria player repository.

- GUT (the Solfeggio set, inherited): 174, 285, 396, 417, 528, 639, 741, 852, 963
- HEART: 963 + 243k for k = 1..9, so 1206 to 3150
- HEAD: 3150 + 354k for k = 1..9, so 3504 to 6336
- Lo Shu Perfect GUT (theoretical): 75 + 111(k - 1), so 75 to 963

Lo Shu layout, position n placed in the cell labelled n:

    4 9 2
    3 5 7
    8 1 6

## The claims under test

From `LoShu.md` and the Lo Shu Cube supplementary chapter.

1. HEART forms a perfect Lo Shu magic square (all 8 lines 6534).
2. HEAD forms a perfect Lo Shu magic square (all 8 lines 14760).
3. The Lo Shu Perfect GUT forms a perfect magic square (all 8 lines 1557).
4. Every HEART frequency has digit root 9.
5. HEAD digit roots cycle 3, 6, 9, mirroring GUT.
6. The HEAD interval is the sum of the other two: 111 + 243 = 354.
7. The intervals' digit roots sum to the Lo Shu constant: 3 + 9 + 3 = 15.
8. The HEART interval is a power of three: 243 = 3^5.
9. The cube's centre is 2178 Hz, digit root 9.
10. The central vertical axis reads 528, 2178, 4920 with digit roots 6, 9, 6.
11. The top frequency, 6336, is a mirror number.
12. In the Lo Shu, the Solfeggio GUT has 7 of 8 lines equal (1665) and one
    diagonal off by 81 = 9^2.
13. The Solfeggio is the 111 sequence plus offsets 99, 99, 99, 9, 9, 9, 0, 0, 0:
    one offset per triad, all multiples of 9, falling to zero.

Not tested here, because they are interpretations, not arithmetic: the Wuxing
element fits ("7/9 strong or good") and the names and meanings of the tones.
Those need a blind matching test (listed under Next).

The "Corner-64 vs Edge-64" split is not tested: its definition was not found
in the sources above.

## Comparison families (null models)

**Family S, for claims 1 to 11 (the extension).** GUT is fixed as the Solfeggio.
HEART is 963 + a*k and HEAD is (963 + 9a) + b*k, for k = 1..9: the same recipe
as Aetheria, with the two intervals a and b free. Every pair is enumerated, not
sampled:

- main range: a, b from 100 to 999 (three-digit intervals, like 111, 243, 354);
- sensitivity ranges: 50 to 1500, and 100 to 500.

Aetheria is (a, b) = (243, 354).

**Family T, for claims 12 and 13 (the Solfeggio itself).** The Solfeggio is
built from the digits 1, 7, 4: the seeds 174, 417 and 741 are rotations of each
other, and each seed starts a triad by adding 111 twice (174, 285, 396). Family T
is every set built that way from three digits x, y, z with 1 <= x, y, z <= 7 (so
adding 222 never carries), sorted ascending into positions 1 to 9. For claim 13,
the offsets are measured against the 111 sequence that ends at the set's top
value, as the chapter did.

**Family R, a naive contrast for claim 12.** Nine distinct integers drawn
uniformly from 150 to 1000, sorted. 1,000,000 draws, seed 20261121.

## The look-elsewhere catalogue

Fixed now, before looking. Applied to every member of Family S. A member scores
one point for each item that holds. Items Aetheria does not have are included
on purpose: they are patterns that would have been celebrated if they had
appeared.

1. HEART has one digit root throughout.
2. HEAD has one digit root throughout.
3. HEART digit roots cycle through 3, 6 and 9 (any order).
4. HEAD digit roots cycle through 3, 6 and 9 (any order).
5. One of the three intervals (111, a, b) is the sum of the other two.
6. One interval is a whole multiple (2 to 9 times) of another.
7. a or b is a perfect power (n^k with n >= 2, k >= 2).
8. a or b is a palindrome or a repdigit (like 252 or 444).
9. a or b is a multiple of 111.
10. The digit roots of 111, a and b sum to 9, 15, 18 or 27.
11. The top frequency (end of HEAD) is a palindrome.
12. The end of HEART is a palindrome.
13. A regime centre (HEART or HEAD position 5) is a palindrome or repdigit.
14. A magic constant (HEART's or HEAD's line sum) is a palindrome or repdigit.
15. A regime end (HEART's or HEAD's) is a whole multiple of 432.

The result is the share of Family S that scores at least as high as Aetheria.

## Decision rules

- A claim is **by construction** if it holds for at least 99% of its family.
- Otherwise it is common (5% or more), uncommon (1% to 5%) or rare (under 1%),
  by the share of its family for which it holds.
- The framework as a whole is **unusual** if fewer than 1% of Family S score as
  high as Aetheria on the catalogue, **somewhat unusual** at 1% to 5%, and
  **typical** above 5%.
- Every result is reported, including the ones that go against the framework.

## A limit, stated in advance

We do not know how 243 and 354 were chosen. If either was picked to make one of
these patterns appear (for example, choosing 354 because 111 + 243 = 354, or
choosing the top value 6336), that pattern is by construction whatever its
share in Family S. The shares tell us how unusual each pattern would be if the
intervals had been picked for other reasons.

## Next (not part of this test)

- A blind matching test for the tone meanings and Wuxing fits.
- The Two Rooms no-link simulation.
