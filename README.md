# Arribada Scorer

End-of-game scoring for the board game **Arribada** (Bitewing Games). Take a photo of the board, let Claude read the tiles, correct anything it misread, and get final scoring.

Live copy (private claude.ai page): https://claude.ai/artifact/BGnHTxzkpXgAwtxnZLC3d1

## How it works

- `index.html` is the whole app: one page, no build step, no dependencies besides Google Fonts.
- Photo reading uses the claude.ai artifact `sample` capability (`claude.use("sample")` with images), so it runs on the viewer's own Claude account and needs no API key. Opened anywhere else, the page still works as a manual scorer: tap spaces to set up the board.
- The score math is plain JavaScript and never uses AI.

## Rules implemented (final scoring, rulebook p.13)

1. **Stranded tiles.** A tile is safe if it is part of a group: 3+ orthogonally adjacent tiles of one player that form a **set** (same number) or a **sequence** (consecutive numbers along a path). Wilds (face-down tiles) match any number. Groups may cross quadrant lines. Every other owned tile is stranded and loses its face value (1 loses 1, wild loses 0). Neutral tiles (no shell) are ignored.
2. **Quadrant majorities**, counted by number of tiles after stranded tiles are removed. Quadrants are fixed in a pinwheel around the center rock.
   - **2 players (9×9 side):** most tiles +10. The other player gets −10 with 0 tiles in that quadrant, −5 with 1–2, −2 with 3, 0 with 4+.
   - **3–4 players (11×11 side):** 20 / 16 / 10 / 8 for 1st–4th. A player needs at least one tile to place. Ties add the tied places' points and split them, rounded down.

Two 2-player cases the rulebook leaves open, and the choice made here:
- A tied quadrant splits 10 plus the second-place penalty, rounded down.
- A quadrant where neither player has a tile scores nothing.

Player colors: pink, green (yellow-green), blue (teal), purple.
