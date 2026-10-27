# Arribada Scorer

Final scoring for the board game **Arribada** (Bitewing Games) from a photo of the board. Everything runs in the browser on your phone: no account, no server, and the photo is never uploaded.

**Use it:** https://krisrchesney.github.io/arribada-scorer/

1. **Take photo.** Shoot the board from above, from any side of the table.
2. **Line up the grid.** Drag the four dots onto the grid's outer corners. A magnifier helps on phones, and the app remembers the corners for next time.
3. **Score it.** The board is read in well under a second. Spaces the app isn't sure about get a "?"; tap any space to fix it. Rule checks flag impossible boards (too many 8s, too many shells, and so on).
4. Add each player's score-track position to get final totals.

Fan-made and unofficial. Not affiliated with Bitewing Games.

## How the photo is read

- `js/vision.js` flattens the photo to a straight top-down grid from the four corners (a homography), then:
  - sorts each space by color: sand, white neutral tile, or one of the four shell colors (pink, green, blue, purple);
  - crops the middle of each tile and reads its number with a small neural network (`js/digits.js`, about 40k weights, `model/digits.json`). Blank face-down tiles with a shell are wilds;
  - tries all four rotations and keeps the most confident one, so the photo can be taken from any side.
- `js/scoring.js` applies the rulebook's final scoring. `js/checks.js` checks the board against the game's components.

## Rules implemented (final scoring, rulebook p.13)

1. **Stranded tiles.** A tile is safe if it is part of a group: 3+ orthogonally adjacent tiles of one player that form a **set** (same number) or a **sequence** (consecutive numbers along a path). Wilds match any number. Groups may cross quadrant lines. Touching your own color is not enough; the rulebook's p.14 example marks such tiles stranded. Every other owned tile loses its face value (1 loses 1, wild loses 0). Neutral tiles are ignored.
2. **Quadrant majorities** by number of tiles, counted after stranded tiles come off. Quadrants are fixed in a pinwheel around the center rock.
   - **2 players (9×9 side):** most tiles +10. The other player gets −10 with 0 tiles in that quadrant, −5 with 1–2, −2 with 3, 0 with 4+.
   - **3–4 players (11×11 side):** 20 / 16 / 10 / 8 for 1st–4th. A player needs at least one tile to place. Ties add the tied places' points and split them, rounded down.

Two 2-player cases the rulebook leaves open: a tied quadrant splits 10 plus the second-place penalty (rounded down), and a quadrant where neither player has a tile scores nothing.

## Improving the digit reader

The first model was trained only on generated tile images. Real photos make it much better:

1. Score a real board in the app and fix every space.
2. Tap **Save for training**. It downloads a `.json` file with the corrected board, the flattened photo and each tile's crop.
3. Put the files in `training/` (git-ignored) and run:

```
python tools/train_digits.py
```

It prints accuracy on held-out real crops and writes `model/digits.json`. Needs Python with numpy, pillow and torch.

## Development

No build step. Serve the folder with any static server, for example `python -m http.server 8792`, and open:
- `/` for the app
- `/tests/tests.html` for the tests: rulebook scoring examples, rule checks, and the photo pipeline if a sample photo is present locally (photos are git-ignored).

`legacy/claude-artifact.html` is the first version, which read photos with Claude inside claude.ai.
