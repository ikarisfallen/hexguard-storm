// =============================================================================
// VANGUARD STORM - A grid-based tower defense game
// =============================================================================
//
// HOW THE GAME WORKS:
//   - The board is an 8-column by 4-row grid.
//   - The LEFT half (columns 0-3) is where enemies spawn and walk through.
//   - The RIGHT half (columns 4-7) is where YOU place your units.
//   - Enemies march from left to right. If any enemy reaches the right edge, you lose.
//   - Each turn: your units attack, then enemies move one step right.
//   - Between waves you can place more units.
//
// HOW THIS CODE IS ORGANIZED:
//   1. Constants        - Grid size, cell size, etc.
//   2. Unit Definitions - What each unit type can do (attack patterns, stats).
//   3. Game State       - All the live data: which units are placed, which enemies exist, etc.
//   4. Wave Definitions - What enemies appear in each wave.
//   5. UI Setup         - Creates the buttons at the bottom of the screen.
//   6. Player Input     - What happens when you click the grid or press buttons.
//   7. Combat Loop      - The turn-by-turn logic that runs during a fight.
//   8. Drawing          - Everything that paints pixels on screen.
//   9. Helpers          - Small utility functions used in multiple places.
// =============================================================================


// =============================================================================
// 1. CONSTANTS
//    These values control the basic dimensions of the game board.
//    Change these to make the grid bigger/smaller or resize the cells.
// =============================================================================

const COLS = 8;               // Total number of columns on the board
const ROWS = 8;               // Total number of rows on the board (taller field for more vertical depth)
const PLAYER_COLS_START = 4;  // First column where the player can place heroes (cols 0-3 = enemy side)
const MAX_HEROES = 5;         // The most heroes the player can place on the board

// ── Hex grid geometry (POINTY-TOP hexagons, odd-r offset) ──
// "Pointy-top" means each hex has a vertex at the very top and very bottom,
// with flat-ish vertical sides on left and right.
// "Odd-r offset" means odd-numbered rows (1, 3) are shifted HALF A HEX to the right,
// so the hexes interlock nicely. Even rows (0, 2) are not shifted.
const HEX_SIZE = 46;                                      // Distance from hex center to any vertex (= edge length)
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;                // Horizontal span of one hex (~79.7)
const HEX_HEIGHT = 2 * HEX_SIZE;                          // Vertical span of one hex (= 92)
const COL_SPACING = HEX_WIDTH;                            // Distance between hex centers in the same row
const ROW_SPACING = 1.5 * HEX_SIZE;                       // Distance between row centers (= 69)
const GRID_OFFSET_X = 62;                                 // Pixel margin between canvas edge and the leftmost hex
const GRID_OFFSET_Y = 112;                                // Pixel margin between canvas top and the topmost hex
                                                          // (chosen so the 8-row grid is vertically centered in an 800px canvas)

// ── Sprite sizing ──
// Each unit/enemy sprite is drawn inside an imaginary square box of this size,
// centered on the hex. The sprite drawing functions reference CELL internally.
const CELL = 80;

// Get a reference to the <canvas> element in the HTML and its "2d context".
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');


// =============================================================================
// 1b. HEX GRID HELPERS
//     Small utility functions for working with the hex grid:
//       - Convert grid coords (col, row) to pixel coords (x, y) at the hex center
//       - Draw the outline of a hex as a canvas path
//       - Figure out which hex the mouse is over, given pixel coords
//       - Look up a hex's neighbor in a given direction (E, W, NE, NW, SE, SW)
// =============================================================================

// Returns the pixel (x, y) position of the CENTER of the hex at (col, row).
// For pointy-top, odd-r offset: odd rows are shifted right by half a hex.
function hexCenter(col, row) {
    const rowOffset = (row % 2) * (HEX_WIDTH / 2);
    return {
        x: GRID_OFFSET_X + col * COL_SPACING + rowOffset + HEX_WIDTH / 2,
        y: GRID_OFFSET_Y + row * ROW_SPACING + HEX_HEIGHT / 2,
    };
}

// Sets up a hexagon-shaped path centered at (cx, cy). Call ctx.fill() or
// ctx.stroke() afterward to actually draw it. Pass a custom size to make
// the hex smaller than the grid cell (useful for highlights/effects).
function drawHexPath(cx, cy, size = HEX_SIZE) {
    ctx.beginPath();
    // Six vertices around the center, starting at the top and going clockwise.
    // Angles are measured from the positive x-axis. For a pointy-top hex the
    // first vertex is straight up (angle = -π/2 = 270°).
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i - Math.PI / 2;
        const px = cx + size * Math.cos(angle);
        const py = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else         ctx.lineTo(px, py);
    }
    ctx.closePath();
}

// Given a mouse pixel position, returns the {col, row} of the hex it's over,
// or null if the cursor isn't inside any hex.
// Uses the simple "closest center wins" approach — with only 32 hexes this is cheap.
function pixelToHex(px, py) {
    let best = null;
    let bestDist = Infinity;
    for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) {
            const c = hexCenter(col, row);
            const dx = px - c.x;
            const dy = py - c.y;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = { col, row };
            }
        }
    }
    // Only return the hex if the cursor is within roughly the hex's radius.
    // Using HEX_SIZE² as the threshold lets us reject points way outside the grid.
    if (bestDist < HEX_SIZE * HEX_SIZE) return best;
    return null;
}

// Returns the neighbor of (col, row) in a given direction, or null if off-grid.
// Direction must be one of: 'E', 'W', 'NE', 'NW', 'SE', 'SW'.
// Pointy-top hexes don't have a direct N or S neighbor (those are 2 rows away).
// Because odd rows are shifted right, the diagonal-neighbor formula depends
// on whether the current row is even or odd.
function neighbor(col, row, dir) {
    const oddRow = row % 2 === 1;
    let dc = 0, dr = 0;
    switch (dir) {
        case 'E':  dc = +1; dr =  0; break;
        case 'W':  dc = -1; dr =  0; break;
        case 'NE': dc = oddRow ? +1 :  0; dr = -1; break;
        case 'NW': dc = oddRow ?  0 : -1; dr = -1; break;
        case 'SE': dc = oddRow ? +1 :  0; dr = +1; break;
        case 'SW': dc = oddRow ?  0 : -1; dr = +1; break;
    }
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return null;
    return { col: nc, row: nr };
}


// =============================================================================
// 2. UNIT DEFINITIONS
//    Each unit type has:
//      - name:       Display name shown on screen
//      - color:      The color used to draw the unit (will be replaced with sprites later)
//      - hp:         Hit points (how much damage the unit can take before dying)
//      - atk:        Attack power (how much damage it deals per hit)
//      - healPower:  (Optional) How much HP it restores to allies instead of attacking
//      - getTargets: A function that returns which grid cells this unit can hit,
//                    based on where the unit is standing (its col and row).
//
//    ATTACK PATTERN GUIDE (the grid is oriented with enemies on the LEFT):
//
//      Black Mage:  Shoots straight left across 4 cells
//                   [X][X][X][X][MAGE]
//
//      Soldier:     Hits the 3 cells directly to its left (left, up-left, down-left)
//                          [X]
//                       [X]
//                          [X]    [SOLDIER]
//
//      Archer:      Hits diagonally up-left and down-left, all the way across
//                   [X]               [X]
//                      [X]         [X]
//                         [X]   [X]
//                            [ARCHER]
//
//      White Mage:  Doesn't attack! Instead, heals allies at up-left and down-left
//                          [heal]
//                                  [MAGE]
//                          [heal]
// =============================================================================

// Helper: walks in a given direction from (col, row) until it leaves the grid,
// collecting every hex along the way. Used by ranged attacks (Black Mage, Archer).
function walkDir(col, row, dir) {
    const out = [];
    let c = col, r = row;
    while (true) {
        const n = neighbor(c, r, dir);
        if (!n) break;
        out.push(n);
        c = n.col;
        r = n.row;
    }
    return out;
}

const UNIT_DEFS = {
    blackmage: {
        name: 'Black Mage',
        color: '#6c5ce7',       // Purple
        hp: 3,
        atk: 2,
        // Attacks in a straight line westward (every hex directly to the west,
        // hex after hex, all the way to the edge of the grid).
        getTargets(col, row) {
            return walkDir(col, row, 'W');
        }
    },

    soldier: {
        name: 'Soldier',
        color: '#e17055',       // Orange-red
        hp: 8,                  // High HP — this is your tank / meat shield
        atk: 2,
        // Attacks the THREE hexes directly in front: W, NW, and SW (the three
        // west-facing neighbors of a pointy-top hex).
        getTargets(col, row) {
            const targets = [];
            const w  = neighbor(col, row, 'W');
            const nw = neighbor(col, row, 'NW');
            const sw = neighbor(col, row, 'SW');
            if (w)  targets.push(w);
            if (nw) targets.push(nw);
            if (sw) targets.push(sw);
            return targets;
        }
    },

    archer: {
        name: 'Archer',
        color: '#00b894',       // Green
        hp: 3,
        atk: 2,
        // Attacks along both diagonals (NW and SW), all the way to the edge.
        // Each step in NW or SW moves one row and shifts one column west.
        getTargets(col, row) {
            return [...walkDir(col, row, 'NW'), ...walkDir(col, row, 'SW')];
        }
    },

    whitemage: {
        name: 'White Mage',
        color: '#dfe6e9',       // Light gray / white
        hp: 3,
        atk: 0,                 // Cannot attack enemies at all
        healPower: 3,           // Heals allies for 3 HP per turn instead
        // Heals the ONE hex directly in front (the W neighbor).
        getTargets(col, row) {
            const w = neighbor(col, row, 'W');
            return w ? [w] : [];
        }
    }
};


// =============================================================================
// 3. GAME STATE
//    This single object holds ALL the live data for the current game.
//    Everything that changes during gameplay is tracked here.
// =============================================================================

let state = {
    phase: 'setup',        // What phase the game is in right now:
                           //   'setup'        = before the player presses Start; timer is paused,
                           //                    units can be placed/moved freely
                           //   'planning'     = timer ticking down, player can place/move units
                           //   'attack'       = heroes are attacking (~1 second, no input)
                           //   'monster_move' = enemies are advancing (~1 second, no input)
                           //   'won'          = player beat all waves
                           //   'lost'         = an enemy reached the right edge

    wave: 1,               // Which wave number we're on (starts at 1)
    stage: 1,              // Which stage we're on

    units: [],             // Array of all player units on the board.
    enemies: [],           // Array of all enemies currently alive on the board.

    selectedType: 'blackmage',  // Which unit type is selected in the bottom bar (for placing new units)

    // ── Drag-and-drop state ──
    // When the player is dragging a unit, this object tracks which unit and where the mouse is.
    // It's null whenever no drag is in progress.
    // Shape: { unitIndex: <int>, mouseX: <pixels>, mouseY: <pixels> }
    dragging: null,

    // ── Timer system ──
    // The turn timer ticks down continuously during the planning phase.
    // When it reaches 0, an automatic combat turn happens.
    turnDuration: 3125,    // How many milliseconds each planning phase lasts (~3.1 seconds)
    turnTimer: 3125,       // Time remaining in the current planning phase (counts down)
    lastFrameTime: 0,      // Used to calculate time elapsed between animation frames

    attackEffects: [],     // Visual flash effects when attacks land
    healEffects: [],       // Visual flash effects when heals land
};


// =============================================================================
// ENEMY FACTORY
//    A helper function to create an enemy object with default values.
//    You pass in which cell it starts on (col, row) and optional overrides
//    like { hp: 10, name: 'Boss', color: '#ff0000' }.
// =============================================================================

function createEnemy(col, row, opts = {}) {
    return {
        col,                          // Which column the enemy's TOP hex is in (starts on the left side)
        row,                          // Which row the enemy's TOP hex is in
        hp: opts.hp || 4,             // Current hit points
        maxHp: opts.hp || 4,          // Maximum hit points (used for the HP bar width)
        atk: opts.atk || 1,           // How much damage this enemy deals when it hits a unit
        speed: opts.speed || 1,       // How many hexes the enemy moves to the right each turn
        color: opts.color || '#e84393',  // Color used to draw the enemy
        name: opts.name || 'Monster', // Display name shown under the enemy
        large: !!opts.large,          // If true, occupies 3 hexes in a triangle: top + SW + SE
    };
}

// Returns the list of hexes a given enemy currently occupies.
// Normal enemies occupy 1 hex. Large enemies occupy a triangle of 3 hexes:
// the "top" hex (enemy.col, enemy.row), plus its SW and SE neighbors.
//
//      [top]
//     /    \
//   [SW]  [SE]
function enemyHexes(enemy) {
    const cells = [{ col: enemy.col, row: enemy.row }];
    if (enemy.large) {
        const sw = neighbor(enemy.col, enemy.row, 'SW');
        const se = neighbor(enemy.col, enemy.row, 'SE');
        if (sw) cells.push(sw);
        if (se) cells.push(se);
    }
    return cells;
}

// Returns the cells the enemy WOULD newly occupy if it advanced east by 1.
// These are the cells that need to be empty for the enemy to be able to advance.
// (Cells the enemy would leave behind don't matter for movement.)
function enemyFrontCells(enemy) {
    const current = enemyHexes(enemy);
    const moved = enemy.large
        ? enemyHexes({ ...enemy, col: enemy.col + 1 })
        : [{ col: enemy.col + 1, row: enemy.row }];
    return moved.filter(m => !current.some(c => c.col === m.col && c.row === m.row));
}


// =============================================================================
// 4. WAVE DEFINITIONS
//    Each wave is a function that returns an array of enemies.
//    Enemies always start in column 0 (the far left edge).
//    To add a new wave, add a new function to this array.
//
//    The row number (0-3) controls which horizontal lane the enemy is in:
//      Row 0 = top lane
//      Row 1 = second lane
//      Row 2 = third lane
//      Row 3 = bottom lane
// =============================================================================

// Helper: picks N distinct random rows from 0..ROWS-1 (used for spawning enemies
// in scattered positions across the taller field).
function pickRandomRows(count) {
    const all = [];
    for (let r = 0; r < ROWS; r++) all.push(r);
    // Fisher-Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count);
}

// Picks a row safe for a LARGE enemy whose top hex is at the given col.
// Large enemies span their top hex + the SW + SE neighbors below it, so:
//   - row must allow row+1 to exist (row <= ROWS - 2)
//   - the SW and SE neighbors must be in-bounds for the given col + row parity
function pickSafeLargeRow(col) {
    const candidates = [];
    for (let r = 0; r < ROWS - 1; r++) {
        const sw = neighbor(col, r, 'SW');
        const se = neighbor(col, r, 'SE');
        if (sw && se) candidates.push(r);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Picks N rows for col-0 spawns that don't collide with any hex already
// occupied by an existing enemy (e.g., a giant whose SW hex extends into col 0).
function pickFreeCol0Rows(count, existingEnemies) {
    const occupied = new Set();
    for (const e of existingEnemies) {
        for (const cell of enemyHexes(e)) {
            if (cell.col === 0) occupied.add(cell.row);
        }
    }
    const free = [];
    for (let r = 0; r < ROWS; r++) {
        if (!occupied.has(r)) free.push(r);
    }
    // Fisher-Yates shuffle
    for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [free[i], free[j]] = [free[j], free[i]];
    }
    return free.slice(0, count);
}

const WAVES = [
    // ── Wave 1: 3 slimes in random rows (easy intro) ──
    () => pickRandomRows(3).map(r => createEnemy(0, r, { hp: 3, name: 'Slime' })),

    // ── Wave 2: 4 enemies spread across the field (mix of slimes and goblins) ──
    () => {
        const rows = pickRandomRows(4);
        return [
            createEnemy(0, rows[0], { hp: 4, name: 'Goblin', color: '#fd79a8' }),
            createEnemy(0, rows[1], { hp: 3, name: 'Slime' }),
            createEnemy(0, rows[2], { hp: 3, name: 'Slime' }),
            createEnemy(0, rows[3], { hp: 4, name: 'Goblin', color: '#fd79a8' }),
        ];
    },

    // ── Wave 3: 5 tougher enemies across the field ──
    () => {
        const rows = pickRandomRows(5);
        return [
            createEnemy(0, rows[0], { hp: 5, name: 'Flan', color: '#fdcb6e' }),
            createEnemy(0, rows[1], { hp: 6, name: 'Bomb', color: '#d63031', atk: 2 }),
            createEnemy(0, rows[2], { hp: 6, name: 'Bomb', color: '#d63031', atk: 2 }),
            createEnemy(0, rows[3], { hp: 5, name: 'Flan', color: '#fdcb6e' }),
            createEnemy(0, rows[4], { hp: 3, name: 'Slime' }),
        ];
    },

    // ── Wave 4: A 3-hex Big Flan giant + slime escort ──
    // The giant spawns FIRST so we can route the slimes around any col-0 hex
    // the giant's SW corner extends into.
    () => {
        const enemies = [];
        enemies.push(createEnemy(1, pickSafeLargeRow(1), {
            hp: 18, name: 'Big Flan', color: '#e17055', atk: 4, large: true,
        }));
        for (const r of pickFreeCol0Rows(4, enemies)) {
            enemies.push(createEnemy(0, r, { hp: 3, name: 'Slime' }));
        }
        return enemies;
    },

    // ── Wave 5: A Big Bomb giant + tonberry swarm ──
    () => {
        const enemies = [];
        enemies.push(createEnemy(1, pickSafeLargeRow(1), {
            hp: 22, name: 'Big Bomb', color: '#d63031', atk: 5, large: true,
        }));
        for (const r of pickFreeCol0Rows(4, enemies)) {
            enemies.push(createEnemy(0, r, {
                hp: 5, name: 'Tonberry', color: '#00cec9', atk: 3,
            }));
        }
        return enemies;
    },
];

// Called when the player presses "Fight!" — picks the right wave and
// fills state.enemies with the enemies for that wave.
// The "% WAVES.length" means if you beat all 5 waves, it loops back to wave 1.
function spawnWave() {
    const waveIndex = (state.wave - 1) % WAVES.length;
    state.enemies = WAVES[waveIndex]();
}


// =============================================================================
// 5. UI SETUP — UNIT SELECTION BUTTONS
//    This code runs once when the page loads. It creates one button for each
//    unit type (Black Mage, Soldier, etc.) and adds it to the bar below the grid.
// =============================================================================

const unitBar = document.getElementById('unit-bar');

// Loop through every unit type defined in UNIT_DEFS.
// "Object.entries" turns { blackmage: {...}, soldier: {...} } into an array of pairs:
//   [ ['blackmage', {...}], ['soldier', {...}], ... ]
for (const [key, def] of Object.entries(UNIT_DEFS)) {
    // Create a new <button> element for this unit type
    const btn = document.createElement('button');
    btn.className = 'unit-btn' + (key === state.selectedType ? ' selected' : '');
    btn.textContent = def.name;                    // e.g. "Black Mage"
    btn.style.borderBottomColor = def.color;       // Color accent on the button
    btn.dataset.type = key;                        // Store the type key for reference

    // When this button is clicked, mark it as the selected unit type.
    btn.addEventListener('click', () => {
        // Remove the "selected" highlight from ALL unit buttons...
        document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
        // ...then add it to the one that was just clicked.
        btn.classList.add('selected');
        state.selectedType = key;  // Now clicking the grid will place this unit type
    });

    // Add the button to the page
    unitBar.appendChild(btn);
}


// =============================================================================
// 6. PLAYER INPUT
//    Handles clicks on the grid (to place units) and button presses.
// =============================================================================

// ── Player input: click to place a new unit, drag to move existing units ──
//
// Behaviors:
//   - mousedown on an existing unit       → start dragging it
//   - mousedown on an empty player cell   → place a new unit of the selected type
//   - mousemove while dragging            → update the cursor position (for the drag preview)
//   - mouseup over a valid empty cell     → drop the unit there (move it)
//   - mouseup elsewhere                   → cancel the drag (unit stays where it was)

// Helper: convert a mouse event into raw pixel coords + the hex it's over (or null)
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hex = pixelToHex(x, y);   // may be null if cursor isn't inside any hex
    return { x, y, hex };
}

canvas.addEventListener('mousedown', (e) => {
    // Input is allowed during 'setup' (before pressing Start) and 'planning' (timer ticking).
    if (state.phase !== 'planning' && state.phase !== 'setup') return;

    const { x, y, hex } = getMousePos(e);
    if (!hex) return;   // Clicked outside the grid

    // If there's a unit in the clicked hex → start a drag
    const unitIdx = state.units.findIndex(u => u.col === hex.col && u.row === hex.row);
    if (unitIdx !== -1) {
        state.dragging = { unitIndex: unitIdx, mouseX: x, mouseY: y };
        canvas.style.cursor = 'grabbing';
        draw();
        return;
    }

    // ── Placing a NEW unit ──
    if (state.phase !== 'setup') {
        setMessage('No new heroes once the game has started — drag to reposition instead.');
        return;
    }
    if (state.units.length >= MAX_HEROES) {
        setMessage(`You can place at most ${MAX_HEROES} heroes. Drag existing ones to reposition.`);
        return;
    }
    if (hex.col < PLAYER_COLS_START) return;

    const def = UNIT_DEFS[state.selectedType];
    state.units.push({
        type: state.selectedType,
        col: hex.col,
        row: hex.row,
        hp: def.hp,
        maxHp: def.hp,
    });
    updateSetupMessage();
    draw();
});

canvas.addEventListener('mousemove', (e) => {
    const { x, y, hex } = getMousePos(e);

    // If currently dragging: update the drag preview position
    if (state.dragging) {
        state.dragging.mouseX = x;
        state.dragging.mouseY = y;
        draw();
        return;
    }

    // Otherwise: change the cursor to "grab" when hovering over a unit (during planning/setup)
    if ((state.phase === 'planning' || state.phase === 'setup') && hex) {
        const overUnit = state.units.some(u => u.col === hex.col && u.row === hex.row);
        canvas.style.cursor = overUnit ? 'grab' : 'pointer';
    } else {
        canvas.style.cursor = 'default';
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (!state.dragging) return;

    const { hex } = getMousePos(e);
    const drag = state.dragging;
    state.dragging = null;
    canvas.style.cursor = 'pointer';

    // Validate the drop target: must be a real hex on the player's side
    if (!hex || hex.col < PLAYER_COLS_START) {
        draw();
        return;   // Invalid drop → unit stays where it was
    }

    // Reject if any enemy is occupying that hex (large enemies span 3 hexes)
    if (state.enemies.some(e => enemyOccupies(e, hex.col, hex.row))) {
        draw();
        return;
    }

    const occupantIdx = state.units.findIndex(u => u.col === hex.col && u.row === hex.row);
    // Allow drop if the hex is empty, OR if it's the unit's own origin hex
    if (occupantIdx === -1 || occupantIdx === drag.unitIndex) {
        const unit = state.units[drag.unitIndex];
        unit.col = hex.col;
        unit.row = hex.row;
    }
    draw();
});

// If the mouse leaves the canvas mid-drag, cancel the drag
canvas.addEventListener('mouseleave', () => {
    if (state.dragging) {
        state.dragging = null;
        canvas.style.cursor = 'default';
        draw();
    }
});

// ── "Start" button — begins the timer cycle ──
// Until pressed, the game sits in 'setup' phase and the timer doesn't tick.
// This lets the player place units at their leisure before the action starts.
document.getElementById('btn-start').addEventListener('click', () => {
    if (state.phase !== 'setup') return;   // Only valid during setup
    state.phase = 'planning';
    state.turnTimer = state.turnDuration;
    setMessage('Timer running! Move units to defend.');
    updateStartButton();
});

// ── "Restart" button — resets everything back to the setup phase ──
document.getElementById('btn-restart').addEventListener('click', () => {
    state.phase = 'setup';
    state.wave = 1;
    state.units = [];
    state.enemies = [];
    state.attackEffects = [];
    state.healEffects = [];
    state.dragging = null;
    state.turnTimer = state.turnDuration;
    spawnWave();           // Spawn the first wave so the player can see what's coming
    updateSetupMessage();  // Shows "Place heroes (0/3)..."
    updateHUD();
    updateStartButton();
    draw();
});

// Helper: enable/disable the Start button based on the current phase.
// Start is only clickable during 'setup'.
function updateStartButton() {
    const btn = document.getElementById('btn-start');
    btn.disabled = (state.phase !== 'setup');
}

// Helper: show the current hero-placement progress during setup.
// Called whenever a unit is placed or removed, or the game is restarted.
function updateSetupMessage() {
    if (state.phase === 'setup') {
        const n = state.units.length;
        if (n < MAX_HEROES) {
            setMessage(`Place heroes (${n}/${MAX_HEROES}). Drag to move. Press Start when ready.`);
        } else {
            setMessage(`All ${MAX_HEROES} heroes placed. Drag to reposition, then press Start.`);
        }
    }
}


// =============================================================================
// 7. COMBAT — runs automatically when the planning timer reaches 0
//
//    The game has 3 distinct combat-related phases that cycle continuously:
//
//      'planning'     — player can place/move units; timer ticks down (~5 sec)
//      'attack'       — heroes attack all at once, then 1-second pause
//      'monster_move' — monsters advance one cell, then 1-second pause
//
//    After 'monster_move' finishes, we go back to 'planning' and the cycle
//    repeats. The timer-driven game loop (see GAME LOOP section) calls
//    runCombatTurn() automatically when the planning timer hits 0.
// =============================================================================

// Runs ONE complete combat turn: hero attacks → pause → monsters move → pause.
// After this finishes, the game returns to the planning phase.
async function runCombatTurn() {
    // ── PHASE A: Heroes attack ──
    state.phase = 'attack';
    state.dragging = null;   // Cancel any in-progress drag (input is locked during combat)
    canvas.style.cursor = 'default';

    // 1. White Mages heal their allies first
    for (const unit of state.units) {
        const def = UNIT_DEFS[unit.type];
        if (def.healPower) {
            const targets = def.getTargets(unit.col, unit.row);
            for (const t of targets) {
                const ally = state.units.find(u => u.col === t.col && u.row === t.row);
                if (ally) {
                    ally.hp = Math.min(ally.maxHp, ally.hp + def.healPower);
                    state.healEffects.push({ col: t.col, row: t.row, timer: 12, color: '#55efc4' });
                }
            }
        }
    }

    // 2. All other units deal damage to enemies in their target cells
    for (const unit of state.units) {
        const def = UNIT_DEFS[unit.type];
        if (def.atk === 0) continue;
        const targets = def.getTargets(unit.col, unit.row);
        for (const t of targets) {
            for (const enemy of state.enemies) {
                if (enemyOccupies(enemy, t.col, t.row)) {
                    enemy.hp -= def.atk;
                    state.attackEffects.push({ col: t.col, row: t.row, timer: 12, color: '#ffeaa7' });
                }
            }
        }
    }

    // 3. Remove dead enemies
    state.enemies = state.enemies.filter(e => e.hp > 0);

    // Wait ~1 second so the player can see the attacks
    await sleep(1000);

    // ── Wave cleared check ──
    if (state.enemies.length === 0) {
        state.wave++;
        // Heal all surviving units by 2 HP as a reward
        for (const u of state.units) {
            u.hp = Math.min(u.maxHp, u.hp + 2);
        }
        spawnWave();           // Start the next wave immediately
        setMessage(`Wave ${state.wave - 1} cleared! Wave ${state.wave} incoming.`);
        updateHUD();
        // Skip monster movement for the new wave's first turn — give the player time to react
        state.phase = 'planning';
        state.turnTimer = state.turnDuration;
        return;
    }

    // ── PHASE B: Monsters move OR attack whatever's in front of them ──
    //
    // Rule: an enemy only advances if the cell(s) directly in front of it are empty.
    // If there's a hero standing in front, the enemy stops and attacks that hero
    // instead. This repeats each turn until the hero dies, after which the enemy
    // can resume advancing.
    state.phase = 'monster_move';

    for (const enemy of state.enemies) {
        // The "front" is the set of hex(es) the enemy would NEWLY occupy if it
        // moved east by one. For normal enemies this is 1 hex; for large
        // (triangle) enemies it can be 1 or 2 hexes depending on row parity.
        const front = enemyFrontCells(enemy);

        // Find heroes standing in any of the front cells
        const blockers = state.units.filter(u =>
            front.some(f => f.col === u.col && f.row === u.row)
        );

        if (blockers.length > 0) {
            // Blocked! Attack every hero in the way (large enemies can hit two heroes at once).
            for (const blocker of blockers) {
                blocker.hp -= enemy.atk;
                state.attackEffects.push({
                    col: blocker.col,
                    row: blocker.row,
                    timer: 12,
                    color: '#ff7675',
                });
            }
        } else {
            // Nothing blocking → advance east one hex
            enemy.col += enemy.speed;
        }
    }

    // Remove any heroes whose HP dropped to 0 or below this turn
    state.units = state.units.filter(u => u.hp > 0);

    // ── Loss condition #1: all heroes dead ──
    // If there are no heroes left on the board, the game ends immediately —
    // no enemies can be defeated and they'll just walk to the edge.
    if (state.units.length === 0) {
        state.phase = 'lost';
        setMessage('Defeated! All your heroes have fallen.');
        return;
    }

    // ── Loss condition #2: enemy reached the final column ──
    // COLS - 1 is the last column (col 7 when COLS = 8). Large enemies span
    // multiple hexes, so check ANY of their occupied cells against the final col.
    for (const enemy of state.enemies) {
        const cells = enemyHexes(enemy);
        if (cells.some(c => c.col >= COLS - 1)) {
            state.phase = 'lost';
            setMessage('Defeated! An enemy reached the final row!');
            return;
        }
    }

    // Wait ~1 second so the player can see the movement
    await sleep(1000);

    // ── Back to planning phase, reset the timer ──
    state.phase = 'planning';
    state.turnTimer = state.turnDuration;
}

// ── Helper: Does this enemy occupy the given hex? ──
// For normal enemies: just (enemy.col, enemy.row).
// For large enemies: any of their 3 triangle hexes.
function enemyOccupies(enemy, col, row) {
    return enemyHexes(enemy).some(c => c.col === col && c.row === row);
}


// =============================================================================
// 8. DRAWING
//    The draw() function is called every time something changes on screen.
//    It clears the entire canvas and redraws everything from scratch:
//    the grid, enemies, units, effects, and any overlays (like "DEFEATED").
//
//    CANVAS COORDINATE SYSTEM:
//      (0,0) is the top-left corner of the canvas.
//      x increases going RIGHT, y increases going DOWN.
//      Each cell is CELL pixels wide and CELL pixels tall.
//      So the cell at column 3, row 2 starts at pixel (300, 200).
// =============================================================================

function draw() {
    // Clear everything — wipe the canvas blank before redrawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Draw the hex grid background ──
    // For each hex on the board, fill its shape with a color (darker on the
    // enemy side, lighter on the player side), then outline it with a grid line.
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            const center = hexCenter(c, r);
            const isPlayerSide = c >= PLAYER_COLS_START;
            drawHexPath(center.x, center.y);
            ctx.fillStyle = isPlayerSide ? '#132a4a' : '#0a2848';
            ctx.fill();
            ctx.strokeStyle = '#1e3a5f';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // ── Highlight every player-side hex with a faint tint during setup/planning ──
    // This makes it clear which hexes accept unit placement/drops.
    if (state.phase === 'planning' || state.phase === 'setup') {
        for (let c = PLAYER_COLS_START; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                if (!state.units.some(u => u.col === c && u.row === r)) {
                    const cen = hexCenter(c, r);
                    drawHexPath(cen.x, cen.y, HEX_SIZE - 3);
                    ctx.fillStyle = 'rgba(126,200,227,0.08)';
                    ctx.fill();
                }
            }
        }
    }

    // ── Draw attack/heal flash effects (colored hex overlays) ──
    // These briefly appear on a hex when that hex was hit by an attack or heal
    // during the combat phase. Each has a timer that counts down so they fade out.
    const allEffects = [...state.attackEffects, ...state.healEffects];
    for (let i = allEffects.length - 1; i >= 0; i--) {
        const ef = allEffects[i];
        ef.timer--;
        const alpha = Math.max(0, ef.timer / 12);
        const cen = hexCenter(ef.col, ef.row);
        drawHexPath(cen.x, cen.y, HEX_SIZE - 2);
        ctx.fillStyle = ef.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.fill();
        if (ef.timer <= 0) allEffects.splice(i, 1);
    }
    state.attackEffects = state.attackEffects.filter(e => e.timer > 0);
    state.healEffects = state.healEffects.filter(e => e.timer > 0);

    // ── Draw enemies (centered on their hex, or spanning a triangle if large) ──
    for (const enemy of state.enemies) {
        const cells = enemyHexes(enemy);

        if (enemy.large && cells.length === 3) {
            // ── LARGE enemy: triangle of 3 hexes (top + SW + SE) ──
            // First, paint a colored "footprint" on each occupied hex so the
            // player can see exactly where the giant is standing.
            for (const cell of cells) {
                const hc = hexCenter(cell.col, cell.row);
                drawHexPath(hc.x, hc.y, HEX_SIZE - 2);
                ctx.fillStyle = enemy.color + '33';   // semi-transparent fill
                ctx.fill();
                ctx.strokeStyle = enemy.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Compute the centroid of the 3 hex centers — the giant's sprite is
            // drawn here, sized to fill the triangle's bounding box.
            let sumX = 0, sumY = 0;
            for (const cell of cells) {
                const hc = hexCenter(cell.col, cell.row);
                sumX += hc.x;
                sumY += hc.y;
            }
            const cx = sumX / cells.length;
            const cy = sumY / cells.length;

            // Bounding box ≈ 2 hexes wide and ~2.5 hexes tall — use 1.6× sprite size
            const bigSize = Math.round(CELL * 1.6);
            const x = cx - bigSize / 2;
            const y = cy - bigSize / 2;
            drawEnemySprite(enemy, x, y, bigSize, bigSize);

            // HP bar across the full top of the bounding box
            drawHPBar(cx - bigSize / 2 + 12, y + 6, bigSize - 24, enemy.hp, enemy.maxHp, '#e84393');

            // Name label at the bottom (outlined)
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(enemy.name, cx, y + bigSize - 4);
            ctx.fillText(enemy.name, cx, y + bigSize - 4);
        } else {
            // ── NORMAL enemy: single hex ──
            const cen = hexCenter(enemy.col, enemy.row);
            const x = cen.x - CELL / 2;
            const y = cen.y - CELL / 2;

            drawEnemySprite(enemy, x, y, CELL, CELL);
            drawHPBar(cen.x - CELL / 2 + 8, y + 4, CELL - 16, enemy.hp, enemy.maxHp, '#e84393');

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(enemy.name, cen.x, y + CELL - 4);
            ctx.fillText(enemy.name, cen.x, y + CELL - 4);
        }
    }

    // ── Draw player units (centered on their hex) ──
    // If a unit is currently being dragged, dim it to 30% so the "picked up"
    // floating copy (drawn later) stands out.
    for (let i = 0; i < state.units.length; i++) {
        const unit = state.units[i];
        const cen = hexCenter(unit.col, unit.row);
        const x = cen.x - CELL / 2;
        const y = cen.y - CELL / 2;
        const isBeingDragged = state.dragging && state.dragging.unitIndex === i;

        ctx.save();
        if (isBeingDragged) ctx.globalAlpha = 0.3;
        drawUnitSprite(unit.type, x, y);
        drawHPBar(cen.x - (CELL - 20) / 2, y + CELL - 6, CELL - 20, unit.hp, unit.maxHp, '#55efc4');
        ctx.restore();
    }

    // ── Drag preview (drawn last so it floats above everything else) ──
    // While the player is dragging a unit, we show:
    //   1. Its attack/heal RANGE highlighted on every hex it would target
    //   2. The drop-target hex outlined (green = valid, red = invalid)
    //   3. The unit sprite itself "floating" at the cursor
    if (state.dragging) {
        const drag = state.dragging;
        const u = state.units[drag.unitIndex];
        if (u) {
            const hoverHex = pixelToHex(drag.mouseX, drag.mouseY);

            // ── ATTACK / HEAL RANGE PREVIEW ──
            if (hoverHex) {
                const def = UNIT_DEFS[u.type];
                const isHealer = !!def.healPower;
                const fillColor   = isHealer ? 'rgba(85,239,196,0.35)' : 'rgba(231,76,60,0.30)';
                const borderColor = isHealer ? '#55efc4' : '#ff7675';
                const targets = def.getTargets(hoverHex.col, hoverHex.row);
                for (const t of targets) {
                    const c = hexCenter(t.col, t.row);
                    drawHexPath(c.x, c.y, HEX_SIZE - 3);
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            // ── DROP TARGET HEX OUTLINE ──
            if (hoverHex) {
                const occupiedByOtherUnit = state.units.some((other, i) =>
                    i !== drag.unitIndex && other.col === hoverHex.col && other.row === hoverHex.row);
                const occupiedByEnemy = state.enemies.some(e =>
                    enemyOccupies(e, hoverHex.col, hoverHex.row));
                const validDrop = hoverHex.col >= PLAYER_COLS_START &&
                                  !occupiedByOtherUnit && !occupiedByEnemy;
                const c = hexCenter(hoverHex.col, hoverHex.row);
                drawHexPath(c.x, c.y, HEX_SIZE - 1);
                ctx.strokeStyle = validDrop ? '#55efc4' : '#e74c3c';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            // ── FLOATING UNIT SPRITE ──
            ctx.save();
            ctx.globalAlpha = 0.85;
            drawUnitSprite(u.type, drag.mouseX - CELL / 2, drag.mouseY - CELL / 2);
            ctx.restore();
        }
    }

    // ── Turn timer progress bar (drawn at the top of the canvas) ──
    drawTimerBar();

    // ── Game over overlay ──
    if (state.phase === 'lost') {
        // Semi-transparent black overlay covering the whole board
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Big red "DEFEATED" text in the center
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('DEFEATED', canvas.width / 2, canvas.height / 2);
    }

    // ── Victory overlay ──
    if (state.phase === 'won') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#55efc4';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('VICTORY!', canvas.width / 2, canvas.height / 2);
    }
}

// ── Draw an HP bar ──
// Draws a small horizontal bar showing current HP vs max HP.
// Parameters:
//   x, y    = top-left corner of the bar (in pixels)
//   width   = total width of the bar (in pixels)
//   hp      = current hit points
//   maxHp   = maximum hit points
//   color   = the color of the filled portion
function drawHPBar(x, y, width, hp, maxHp, color) {
    // Calculate what percentage of HP remains (0.0 to 1.0)
    const pct = Math.max(0, hp / maxHp);
    // Dark background (the "empty" part of the bar)
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, width, 5);
    // Colored foreground (the "filled" part of the bar, proportional to remaining HP)
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * pct, 5);
}

// ── Draw a rounded rectangle path ──
// The HTML canvas doesn't have a built-in rounded rectangle function,
// so we draw one manually using lines and curves.
// Parameters:
//   ctx = the canvas 2D drawing context
//   x, y = top-left corner position
//   w, h = width and height
//   r = corner radius (how rounded the corners are)
//
// NOTE: This only creates the *path* — you still need to call ctx.fill()
// or ctx.stroke() afterward to actually draw it.
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);                                       // Start at top-left (after the corner)
    ctx.lineTo(x + w - r, y);                                   // Top edge
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);               // Top-right corner (curve)
    ctx.lineTo(x + w, y + h - r);                               // Right edge
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);       // Bottom-right corner (curve)
    ctx.lineTo(x + r, y + h);                                   // Bottom edge
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);               // Bottom-left corner (curve)
    ctx.lineTo(x, y + r);                                       // Left edge
    ctx.quadraticCurveTo(x, y, x + r, y);                       // Top-left corner (curve)
    ctx.closePath();
}


// =============================================================================
// 9. SPRITES
//    Procedurally drawn sprites for each unit and enemy type.
//    Each sprite is built from basic canvas shapes (circles, rectangles,
//    polygons). When you replace these with real PNG art, you'll just swap
//    out the body of these functions to call ctx.drawImage() instead.
//
//    Each function takes (x, y) as the top-left corner of the cell to draw in.
//    For units, the cell is always 100x100 (CELL).
//    For enemies, the cell may be 100x100 (normal) or 200x200 (giant).
// =============================================================================

// ── Sprite helpers ──
// Draws a small filled circle (used for eyes, dots, etc.)
function dot(cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
}

// Draws a "shadow" oval beneath a sprite to ground it visually
function drawShadow(cx, cy, w) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.35, w * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
}

// =============================================================================
// UNIT SPRITES
// =============================================================================

// Dispatcher: picks the right drawing function for a given unit type
function drawUnitSprite(type, x, y) {
    drawShadow(x + CELL / 2, y + CELL - 14, CELL);
    if (type === 'blackmage') drawBlackMage(x, y);
    else if (type === 'soldier') drawSoldier(x, y);
    else if (type === 'archer') drawArcher(x, y);
    else if (type === 'whitemage') drawWhiteMage(x, y);
}

// ── Black Mage: hooded figure with a tall pointed wizard hat and glowing eyes ──
function drawBlackMage(x, y) {
    const cx = x + CELL / 2;     // Cell center X
    const cy = y + CELL / 2;     // Cell center Y

    // Robe body (purple)
    ctx.fillStyle = '#6c5ce7';
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy + 28);   // Bottom-left of robe
    ctx.lineTo(cx + 24, cy + 28);   // Bottom-right
    ctx.lineTo(cx + 18, cy - 6);    // Right shoulder
    ctx.lineTo(cx - 18, cy - 6);    // Left shoulder
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2d2161';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face shadow under the hat (dark void where the face is)
    ctx.fillStyle = '#1a0f3a';
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 14, 0, Math.PI * 2);
    ctx.fill();

    // Glowing yellow eyes
    dot(cx - 5, cy - 8, 2.5, '#ffeaa7');
    dot(cx + 5, cy - 8, 2.5, '#ffeaa7');

    // Tall pointed hat (triangle)
    ctx.fillStyle = '#4834a3';
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 14);   // Hat brim left
    ctx.lineTo(cx + 18, cy - 14);   // Hat brim right
    ctx.lineTo(cx + 4, cy - 38);    // Hat tip (slightly leaning)
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2d2161';
    ctx.stroke();

    // Yellow band on the hat
    ctx.fillStyle = '#ffeaa7';
    ctx.fillRect(cx - 18, cy - 17, 36, 4);
}

// ── Soldier: armored knight with helmet and sword ──
function drawSoldier(x, y) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;

    // Sword (held to the side)
    ctx.fillStyle = '#dfe6e9';
    ctx.fillRect(cx + 22, cy - 22, 4, 36);   // Blade
    ctx.fillStyle = '#8b6f47';
    ctx.fillRect(cx + 19, cy + 14, 10, 4);   // Crossguard
    ctx.fillRect(cx + 22, cy + 18, 4, 8);    // Handle

    // Body / armor (orange-red plate)
    ctx.fillStyle = '#e17055';
    roundRect(ctx, cx - 22, cy - 6, 44, 36, 4);
    ctx.fill();
    ctx.strokeStyle = '#7a3320';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Chest plate detail (V shape)
    ctx.strokeStyle = '#7a3320';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 4);
    ctx.lineTo(cx, cy + 12);
    ctx.lineTo(cx + 12, cy - 4);
    ctx.stroke();

    // Helmet (rounded silver dome)
    ctx.fillStyle = '#b2bec3';
    ctx.beginPath();
    ctx.arc(cx, cy - 14, 16, Math.PI, 0);    // Top half-circle
    ctx.fill();
    ctx.strokeStyle = '#636e72';
    ctx.stroke();

    // Helmet visor slit (dark horizontal line)
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(cx - 12, cy - 12, 24, 4);

    // Red plume on top of helmet
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 28);
    ctx.lineTo(cx + 4, cy - 28);
    ctx.lineTo(cx + 2, cy - 36);
    ctx.lineTo(cx - 2, cy - 36);
    ctx.closePath();
    ctx.fill();
}

// ── Archer: hooded figure with a bow ──
function drawArcher(x, y) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;

    // Bow (curved arc on the left side)
    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx - 22, cy + 4, 22, -Math.PI / 2.5, Math.PI / 2.5);
    ctx.stroke();
    // Bowstring (straight line)
    ctx.strokeStyle = '#dfe6e9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 14);
    ctx.lineTo(cx - 14, cy + 22);
    ctx.stroke();

    // Body (green tunic)
    ctx.fillStyle = '#00b894';
    roundRect(ctx, cx - 16, cy - 4, 32, 32, 4);
    ctx.fill();
    ctx.strokeStyle = '#0a5d4a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Belt
    ctx.fillStyle = '#8b6f47';
    ctx.fillRect(cx - 16, cy + 14, 32, 4);

    // Hood (green pointed hood)
    ctx.fillStyle = '#0a5d4a';
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 4);
    ctx.lineTo(cx + 16, cy - 4);
    ctx.lineTo(cx + 12, cy - 26);
    ctx.lineTo(cx - 4, cy - 30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#063d30';
    ctx.stroke();

    // Face peeking out of hood
    ctx.fillStyle = '#fab78a';
    ctx.beginPath();
    ctx.arc(cx + 2, cy - 12, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    dot(cx + 4, cy - 13, 1.5, '#000');
}

// ── White Mage: white-robed healer with a red cross ──
function drawWhiteMage(x, y) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;

    // Staff (held to the side)
    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 22, cy - 24);
    ctx.lineTo(cx + 22, cy + 26);
    ctx.stroke();
    // Staff orb (glowing green)
    dot(cx + 22, cy - 26, 5, '#55efc4');
    dot(cx + 22, cy - 26, 2, '#fff');

    // White robe body
    ctx.fillStyle = '#f5f6fa';
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 28);
    ctx.lineTo(cx + 18, cy + 28);
    ctx.lineTo(cx + 14, cy - 6);
    ctx.lineTo(cx - 18, cy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b2bec3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Red trim along the bottom of the robe
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(cx - 22, cy + 24, 40, 4);

    // Red cross on the chest
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(cx - 2, cy + 2, 4, 14);     // Vertical bar
    ctx.fillRect(cx - 7, cy + 6, 14, 4);     // Horizontal bar

    // Hood (white pointed hood)
    ctx.fillStyle = '#f5f6fa';
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 6);
    ctx.lineTo(cx + 14, cy - 6);
    ctx.lineTo(cx + 8, cy - 28);
    ctx.lineTo(cx - 6, cy - 30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b2bec3';
    ctx.stroke();

    // Red trim on the hood edge
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(cx - 18, cy - 9, 32, 3);

    // Face
    ctx.fillStyle = '#fab78a';
    ctx.beginPath();
    ctx.arc(cx, cy - 14, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    dot(cx - 3, cy - 14, 1.2, '#000');
    dot(cx + 3, cy - 14, 1.2, '#000');
}

// =============================================================================
// ENEMY SPRITES
// =============================================================================

// Dispatcher: picks the right enemy sprite based on the enemy's name
function drawEnemySprite(enemy, x, y, w, h) {
    drawShadow(x + w / 2, y + h - 12, w);
    const name = enemy.name.toLowerCase();
    if (name.includes('slime'))     drawSlime(enemy, x, y, w, h);
    else if (name.includes('goblin'))    drawGoblin(enemy, x, y, w, h);
    else if (name.includes('flan'))      drawFlan(enemy, x, y, w, h);
    else if (name.includes('bomb'))      drawBomb(enemy, x, y, w, h);
    else if (name.includes('tonberry'))  drawTonberry(enemy, x, y, w, h);
    else                                  drawGenericMonster(enemy, x, y, w, h);
}

// ── Slime: blue-pink blob with a wobbly base and big eyes ──
function drawSlime(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 8;
    const r = (w / 2) - 14;

    // Body — top half is a dome, bottom is a wavy line
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);                         // Top dome
    ctx.lineTo(cx + r, cy + 8);
    // Wavy bottom edge
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const px = cx + r - (r * 2 * t);
        const py = cy + 8 + Math.sin(t * Math.PI * 3) * 4;
        ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight (shiny spot on the top)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.4, r * 0.2, r * 0.1, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Big white eyes with black pupils
    dot(cx - r * 0.35, cy - 4, 5, '#fff');
    dot(cx + r * 0.35, cy - 4, 5, '#fff');
    dot(cx - r * 0.35, cy - 4, 2.5, '#000');
    dot(cx + r * 0.35, cy - 4, 2.5, '#000');
}

// ── Goblin: pink imp with pointed ears and fangs ──
function drawGoblin(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 6;
    const r = (w / 2) - 16;

    // Ears (pointed triangles on each side)
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - 4);
    ctx.lineTo(cx - r - 10, cy - 14);
    ctx.lineTo(cx - r + 4, cy - 14);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + r, cy - 4);
    ctx.lineTo(cx + r + 10, cy - 14);
    ctx.lineTo(cx + r - 4, cy - 14);
    ctx.closePath();
    ctx.fill();

    // Head/body (round)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Angry eyes (yellow with black slit pupils)
    dot(cx - r * 0.35, cy - 6, 4, '#ffeaa7');
    dot(cx + r * 0.35, cy - 6, 4, '#ffeaa7');
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - r * 0.35 - 1, cy - 9, 2, 6);
    ctx.fillRect(cx + r * 0.35 - 1, cy - 9, 2, 6);

    // Mouth with two fangs
    ctx.fillStyle = '#1a0f1f';
    ctx.fillRect(cx - 8, cy + 6, 16, 4);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 6);
    ctx.lineTo(cx - 4, cy + 12);
    ctx.lineTo(cx - 2, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy + 6);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.closePath();
    ctx.fill();
}

// ── Flan: jiggly pudding with a swirl on top ──
function drawFlan(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 10;
    const baseR = (w / 2) - 10;

    // Base (wide bottom)
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, baseR, baseR * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Stacked layers (smaller as they go up)
    for (let i = 0; i < 3; i++) {
        const ry = cy - 4 - i * 10;
        const rx = baseR - 6 - i * 8;
        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.ellipse(cx, ry, rx, rx * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Eyes near the top
    const topY = cy - 26;
    dot(cx - 6, topY, 3, '#fff');
    dot(cx + 6, topY, 3, '#fff');
    dot(cx - 6, topY, 1.5, '#000');
    dot(cx + 6, topY, 1.5, '#000');

    // Cute smile
    ctx.strokeStyle = '#5a3d1f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, topY + 4, 4, 0, Math.PI);
    ctx.stroke();
}

// ── Bomb: round red sphere with a fuse on top ──
function drawBomb(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 6;
    const r = (w / 2) - 14;

    // Fuse line going up from the top
    ctx.strokeStyle = '#5a3d1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx + 8, cy - r - 12, cx + 4, cy - r - 18);
    ctx.stroke();

    // Spark on top of fuse (animated-feeling burst)
    ctx.fillStyle = '#ffeaa7';
    ctx.beginPath();
    ctx.arc(cx + 4, cy - r - 18, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e67e22';
    ctx.beginPath();
    ctx.arc(cx + 4, cy - r - 18, 2, 0, Math.PI * 2);
    ctx.fill();

    // Body (red sphere)
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight (gives it a 3D feel)
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.4, cy - r * 0.4, r * 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Angry eyes (yellow and intense)
    dot(cx - r * 0.4, cy - 4, 4, '#ffeaa7');
    dot(cx + r * 0.4, cy - 4, 4, '#ffeaa7');
    dot(cx - r * 0.4, cy - 4, 2, '#000');
    dot(cx + r * 0.4, cy - 4, 2, '#000');

    // Frowning mouth
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy + 14, 6, Math.PI, 0);
    ctx.stroke();
}

// ── Tonberry: small hooded figure with a knife and lantern ──
function drawTonberry(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 6;
    const bodyW = (w / 2) - 16;

    // Lantern (held to the left)
    ctx.fillStyle = '#f1c40f';
    roundRect(ctx, cx - bodyW - 10, cy + 4, 8, 10, 2);
    ctx.fill();
    // Lantern handle
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx - bodyW - 6, cy + 2, 4, Math.PI, 0);
    ctx.stroke();

    // Knife (held to the right)
    ctx.fillStyle = '#dfe6e9';
    ctx.beginPath();
    ctx.moveTo(cx + bodyW + 2, cy - 2);
    ctx.lineTo(cx + bodyW + 6, cy - 16);
    ctx.lineTo(cx + bodyW + 10, cy - 16);
    ctx.lineTo(cx + bodyW + 6, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Knife handle
    ctx.fillStyle = '#5a3d1f';
    ctx.fillRect(cx + bodyW + 2, cy + 2, 8, 4);

    // Cloaked body (teal robe shaped like a bell)
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW, cy + 22);
    ctx.lineTo(cx + bodyW, cy + 22);
    ctx.lineTo(cx + bodyW * 0.6, cy - 16);
    ctx.lineTo(cx - bodyW * 0.6, cy - 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hood (pointed top)
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.6, cy - 14);
    ctx.lineTo(cx + bodyW * 0.6, cy - 14);
    ctx.lineTo(cx + 3, cy - 28);
    ctx.lineTo(cx - 3, cy - 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Beady glowing eyes inside the hood shadow
    ctx.fillStyle = '#1a3a3a';
    ctx.fillRect(cx - 10, cy - 12, 20, 6);
    dot(cx - 5, cy - 9, 1.5, '#ff7675');
    dot(cx + 5, cy - 9, 1.5, '#ff7675');
}

// ── Fallback for any unknown monster type ──
function drawGenericMonster(enemy, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(cx, cy, (w / 2) - 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    dot(cx - 6, cy - 4, 3, '#fff');
    dot(cx + 6, cy - 4, 3, '#fff');
    dot(cx - 6, cy - 4, 1.5, '#000');
    dot(cx + 6, cy - 4, 1.5, '#000');
}


// =============================================================================
// 10. HELPER FUNCTIONS
//    Small utilities used by the code above.
// =============================================================================

// Pauses execution for the given number of milliseconds.
// Used in the combat loop to add delays between turns so the player can watch.
// Example: await sleep(400)  →  waits 0.4 seconds before continuing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Updates the message text shown below the game board.
function setMessage(msg) {
    document.getElementById('message').textContent = msg;
}

// Updates the "Wave: X | Stage: Y" display above the game board.
function updateHUD() {
    document.getElementById('wave-num').textContent = state.wave;
    document.getElementById('stage-num').textContent = state.stage;
}


// ── Draw the turn timer bar at the top of the canvas ──
// During the planning phase, this bar drains from full to empty.
// When it hits 0, the combat turn fires automatically.
// During the attack/monster_move phases, the bar shows full red as a "locked" indicator.
function drawTimerBar() {
    const barH = 8;            // Height of the bar in pixels
    const y = 0;               // Position at the very top of the canvas

    // Dark background
    ctx.fillStyle = '#222';
    ctx.fillRect(0, y, canvas.width, barH);

    if (state.phase === 'setup') {
        // Setup phase — bar is full and blue, indicating "ready to start"
        ctx.fillStyle = '#7ec8e3';
        ctx.fillRect(0, y, canvas.width, barH);
    } else if (state.phase === 'planning') {
        // Fraction of time remaining (1.0 = full, 0.0 = empty)
        const pct = Math.max(0, state.turnTimer / state.turnDuration);

        // Color shifts as time runs out: green → yellow → red
        let color = '#55efc4';
        if (pct < 0.5) color = '#ffeaa7';
        if (pct < 0.25) color = '#ff7675';

        ctx.fillStyle = color;
        ctx.fillRect(0, y, canvas.width * pct, barH);
    } else if (state.phase === 'attack' || state.phase === 'monster_move') {
        // Combat phase — show a solid red bar to signal "input locked"
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(0, y, canvas.width, barH);
    }
}


// =============================================================================
// 11. GAME LOOP
//    Runs every frame (~60 times per second) using requestAnimationFrame.
//    Its job is to:
//      1. Decrement the turn timer when in 'planning' phase
//      2. Trigger a combat turn when the timer hits 0
//      3. Redraw the screen every frame so animations stay smooth
//
//    requestAnimationFrame(gameLoop) tells the browser:
//    "call gameLoop again on the next frame, with the current timestamp."
// =============================================================================

function gameLoop(timestamp) {
    // Calculate how many milliseconds passed since the last frame
    const dt = state.lastFrameTime ? timestamp - state.lastFrameTime : 0;
    state.lastFrameTime = timestamp;

    // Keep the Start button's enabled state in sync with the current phase
    updateStartButton();

    // Tick down the planning timer
    if (state.phase === 'planning') {
        state.turnTimer -= dt;
        if (state.turnTimer <= 0) {
            state.turnTimer = 0;
            // Time's up! Run a combat turn (heroes attack, then monsters move).
            // We don't await — the combat function manages its own timing,
            // and meanwhile the game loop keeps redrawing.
            runCombatTurn();
        }
    }

    // Always redraw, so the timer bar animates smoothly
    draw();

    // Schedule the next frame
    requestAnimationFrame(gameLoop);
}


// =============================================================================
// 12. START THE GAME
// =============================================================================

spawnWave();                              // Spawn the first wave immediately so player can plan
state.turnTimer = state.turnDuration;     // Initialize the timer (won't tick until 'planning')
updateSetupMessage();                     // "Place heroes (0/3)..."
updateHUD();
updateStartButton();                      // Make sure the Start button is enabled
requestAnimationFrame(gameLoop);          // Kick off the render loop (timer only ticks in 'planning')
