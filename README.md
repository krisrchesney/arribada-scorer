# Arribada Scorer

Final scoring for the board game **Arribada** (Bitewing Games) from a photo of the board. Everything runs in the browser on your phone: no account, no server, and the photo is never uploaded.

**Use it:** https://krisrchesney.github.io/arribada-scorer/

1. **Take photo.** Get the whole board in frame, from above or at a slight angle, from any side of the table.
2. The app finds the grid, picks the board size (9×9 or 11×11) and reads every space in a few seconds.
3. **Check the board.** Spaces the app isn't sure about get a "?"; tap any space to fix it. Rule checks flag impossible boards (too many 8s, too many shells, and so on). If the grid is off, tap **Adjust grid** and drag the corners.
4. Add each player's score-track position to get final totals.

Fan-made and unofficial. Not affiliated with Bitewing Games.

## How the photo is read

- `js/detect.js` finds the grid. Nest squares are brown and sit on every other row and column (including all four grid corners); everything else is sand. It scores how well a candidate grid lines up with that pattern (and that no brown sits just outside it), sweeps many starting grids, and refines the four corners by local search. It tries both board sizes and keeps the better fit.
- `js/vision.js` flattens the photo to a straight top-down grid (a homography) and white-balances it against the sand, so warm indoor light doesn't shift the colors. Then it:
  - sorts each space by color: sand, neutral tile, or one of the four shell colors (pink, green, blue, purple);
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

The number reader is the weakest part. It learns from generated tile images plus real crops, and every real board helps a lot:

1. Score a real board in the app and fix every space.
2. Tap **Save for training**. It downloads a `.json` file with the corrected board, the flattened photo and each tile's crop.
3. Put the files in `training/` (git-ignored) and run:

```
python tools/train_digits.py
python tools/train_digits.py --holdout <file>.json --out scratch.json   # accuracy on a board it didn't train on
```

Needs Python with numpy, pillow and torch.

## Development

No build step. Run `python tools/dev_server.py 8792` and open:
- `/` for the app
- `/tests/tests.html` for the tests: rulebook scoring examples, rule checks, and the full photo pipeline on sample photos if present locally (photos are git-ignored). On the dev server the test page can save its labeled crops to `training/`.

`legacy/claude-artifact.html` is the first version, which read photos with Claude inside claude.ai.
