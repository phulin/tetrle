import './style.css'
import { PLAYER_1, PLAYER_2, SYSTEM } from '@rcade/plugin-input-classic'
import wordsText from './words.txt?raw'

// ── Constants ──────────────────────────────────────────────────────────────────
const COLS = 8
const ROWS = 10
const TICK_MS = 300       // ms between auto-drops
const FAST_TICK_MS = 75   // ms between drops when P1 holds down
const CLEAR_MS = 500      // ms for clear animation
const MIN_WORD = 3
const SPAWN_COL = Math.floor(COLS / 2)

const WORD_SET = new Set(
  wordsText
    .split('\n')
    .map(w => w.trim().toUpperCase())
    .filter(w => w.length >= MIN_WORD && /^[A-Z]+$/.test(w))
)

const LETTER_BAG = 'EEEEEEEEAAAARRRRIIIOOOTTNNNSSSLLDDGGBCMPFHKUVWY'

// ── Types ──────────────────────────────────────────────────────────────────────
type Cell = string | null
type Pos = [number, number]
type Phase = 'start' | 'playing' | 'clearing' | 'gameover'

interface State {
  grid: Cell[][]
  fLetter: string     // falling letter
  fRow: number
  fCol: number
  p1Score: number
  p2Score: number
  cursor: Pos
  path: Pos[]
  clearing: Set<string>   // 'r:c' keys currently animating clear
  phase: Phase
  lastWord: string
  tickMs: number
  clearMs: number
  clears: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const randLetter = () => LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)]
const key = (r: number, c: number) => `${r}:${c}`
const posKey = ([r, c]: Pos) => key(r, c)

function makeGrid(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null))
}

function collapseGrid(g: Cell[][]): Cell[][] {
  const next = makeGrid()
  for (let c = 0; c < COLS; c++) {
    const stack: string[] = []
    for (let r = ROWS - 1; r >= 0; r--) {
      const cell = g[r][c]
      if (cell) stack.push(cell)
    }
    stack.forEach((letter, i) => { next[ROWS - 1 - i][c] = letter })
  }
  return next
}

function adjacent([r1, c1]: Pos, [r2, c2]: Pos): boolean {
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && (r1 !== r2 || c1 !== c2)
}

function pathWord(g: Cell[][], path: Pos[]): string {
  return path.map(([r, c]) => g[r][c] ?? '').join('')
}

function boggleScore(len: number): number {
  if (len < 3) return 0
  if (len <= 4) return 1
  if (len === 5) return 2
  if (len === 6) return 3
  if (len === 7) return 5
  return 11
}

// ── State ──────────────────────────────────────────────────────────────────────
function initState(): State {
  return {
    grid: makeGrid(),
    fLetter: randLetter(),
    fRow: 0,
    fCol: SPAWN_COL,
    p1Score: 0,
    p2Score: 0,
    cursor: [Math.floor(ROWS / 2), Math.floor(COLS / 2)],
    path: [],
    clearing: new Set(),
    phase: 'start',
    lastWord: '',
    tickMs: 0,
    clearMs: 0,
    clears: 0,
  }
}

let gs = initState()

// ── DOM Setup ──────────────────────────────────────────────────────────────────
const app = document.querySelector('#app') as HTMLDivElement
app.innerHTML = `
  <div id="hdr">
    <span id="s1">P1:0</span>
    <span id="ttl">BOGTRLE</span>
    <span id="s2">P2:0</span>
  </div>
  <div id="board"></div>
  <div id="ftr"><span id="wd">-</span></div>
  <div id="ovl"></div>
`

const boardEl = document.querySelector('#board') as HTMLDivElement
const s1El = document.querySelector('#s1') as HTMLSpanElement
const s2El = document.querySelector('#s2') as HTMLSpanElement
const wdEl = document.querySelector('#wd') as HTMLSpanElement
const ovlEl = document.querySelector('#ovl') as HTMLDivElement

// Pre-create cell elements for efficient rendering
const cells: HTMLDivElement[][] = Array.from({ length: ROWS }, (_, _r) =>
  Array.from({ length: COLS }, (_, _c) => {
    const d = document.createElement('div')
    d.className = 'cell'
    boardEl.appendChild(d)
    return d
  })
)

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
  const { grid, fLetter, fRow, fCol, cursor, path, clearing, phase, p1Score, p2Score, lastWord } = gs

  const pathSet = new Set(path.map(posKey))
  const [curR, curC] = cursor

  // Ghost: find lowest empty cell in falling column
  let ghostRow = fRow
  while (ghostRow + 1 < ROWS && grid[ghostRow + 1][fCol] === null) ghostRow++
  const showGhost = ghostRow !== fRow && phase === 'playing'

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = cells[r][c]
      const isFalling = phase === 'playing' && r === fRow && c === fCol
      const isGhost = showGhost && r === ghostRow && c === fCol
      const letter = isFalling ? fLetter : grid[r][c]
      const pk = key(r, c)
      const inPath = pathSet.has(pk)
      const isCursor = phase === 'playing' && r === curR && c === curC
      const isClearing = clearing.has(pk)

      let cls = 'cell'
      if (letter) cls += ' filled'
      if (isFalling) cls += ' falling'
      else if (isGhost && !letter) cls += ' ghost'
      if (inPath) cls += ' in-path'
      if (isCursor) cls += ' cursor'
      if (isClearing) cls += ' clearing'

      if (d.className !== cls) d.className = cls

      const display = letter ?? (isGhost ? '\u00B7' : '')
      if (d.textContent !== display) d.textContent = display
    }
  }

  const s1 = `P1:${p1Score}`
  const s2 = `P2:${p2Score}`
  if (s1El.textContent !== s1) s1El.textContent = s1
  if (s2El.textContent !== s2) s2El.textContent = s2

  // Word display: show building word or last result
  const word = pathWord(grid, path)
  const isValid = word.length >= MIN_WORD && WORD_SET.has(word)
  const wdText = word || lastWord || '-'
  const wdCls = word
    ? (isValid ? 'valid' : 'building')
    : (lastWord.startsWith('+') ? 'success' : lastWord.startsWith('\u2717') ? 'fail' : '')
  if (wdEl.textContent !== wdText) wdEl.textContent = wdText
  if (wdEl.className !== wdCls) wdEl.className = wdCls

  // Overlay
  if (phase === 'start') {
    ovlEl.className = ''
    ovlEl.innerHTML = 'BOGTRLE<br><small>P1&nbsp;drops&nbsp;letters&nbsp;&nbsp;P2&nbsp;finds&nbsp;words</small><br><small>PRESS&nbsp;START</small>'
  } else if (phase === 'gameover') {
    ovlEl.className = ''
    ovlEl.innerHTML = `GAME OVER<br>P1:${p1Score}&nbsp;&nbsp;P2:${p2Score}<br><small>press any button</small>`
  } else {
    ovlEl.className = 'hidden'
  }
}

// ── Input ──────────────────────────────────────────────────────────────────────
interface BtnState { up: boolean; down: boolean; left: boolean; right: boolean; a: boolean; b: boolean }

const readP = (p: typeof PLAYER_1): BtnState => ({
  up: p.DPAD.up, down: p.DPAD.down, left: p.DPAD.left, right: p.DPAD.right, a: p.A, b: p.B
})

let prev1: BtnState = { up: false, down: false, left: false, right: false, a: false, b: false }
let prev2: BtnState = { up: false, down: false, left: false, right: false, a: false, b: false }

type Dir = 'up' | 'down' | 'left' | 'right'

interface RepeatState { dir: Dir | null; hold: number; reps: number }
const rep1: RepeatState = { dir: null, hold: 0, reps: 0 }
const rep2: RepeatState = { dir: null, hold: 0, reps: 0 }

const HOLD_DELAY = 200
const HOLD_RATE = 90

// Returns the repeated direction if a repeat fires this frame, else null
function tickRepeat(rep: RepeatState, cur: BtnState, dt: number): Dir | null {
  const dirs: Dir[] = ['up', 'down', 'left', 'right']
  const active = dirs.find(d => cur[d]) ?? null
  if (active !== rep.dir) {
    rep.dir = active
    rep.hold = 0
    rep.reps = 0
    return null
  }
  if (!active) return null
  rep.hold += dt
  const threshold = rep.reps === 0 ? HOLD_DELAY : HOLD_RATE
  if (rep.hold >= threshold) {
    rep.hold -= threshold
    rep.reps++
    return active
  }
  return null
}

// ── Game Logic ─────────────────────────────────────────────────────────────────
function placeFalling(): void {
  const { fRow, fCol, fLetter, grid, p1Score } = gs
  const nextGrid = grid.map(r => [...r])
  nextGrid[fRow][fCol] = fLetter

  const newLetter = randLetter()
  const blocked = nextGrid[0][SPAWN_COL] !== null

  gs = {
    ...gs,
    grid: nextGrid,
    p1Score: p1Score + 5,
    fLetter: newLetter,
    fRow: 0,
    fCol: SPAWN_COL,
    tickMs: 0,
    phase: blocked ? 'gameover' : 'playing',
  }
}

function trySubmitWord(): void {
  const word = pathWord(gs.grid, gs.path)
  if (word.length < MIN_WORD || !WORD_SET.has(word)) {
    gs = { ...gs, path: [], lastWord: `\u2717${word || '?'}` }
    return
  }

  const clearSet = new Set(gs.path.map(posKey))
  const score = boggleScore(word.length)

  // Keep clearing cells IN the grid until animation completes
  gs = {
    ...gs,
    p2Score: gs.p2Score + score,
    clears: gs.clears + 1,
    path: [],
    clearing: clearSet,
    clearMs: CLEAR_MS,
    phase: 'clearing',
    lastWord: `+${score} ${word}`,
  }
}

// ── Game Loop ──────────────────────────────────────────────────────────────────
let lastTime = 0

function update(time: number) {
  const dt = Math.min(time - lastTime, 100)
  lastTime = time

  const cur1 = readP(PLAYER_1)
  const cur2 = readP(PLAYER_2)

  // Edge detection (rising edge = just pressed)
  const e1 = {
    left:  cur1.left  && !prev1.left,
    right: cur1.right && !prev1.right,
    down:  cur1.down  && !prev1.down,
    up:    cur1.up    && !prev1.up,
    a:     cur1.a     && !prev1.a,
    b:     cur1.b     && !prev1.b,
  }
  const e2 = {
    left:  cur2.left  && !prev2.left,
    right: cur2.right && !prev2.right,
    down:  cur2.down  && !prev2.down,
    up:    cur2.up    && !prev2.up,
    a:     cur2.a     && !prev2.a,
    b:     cur2.b     && !prev2.b,
  }

  const r1dir = tickRepeat(rep1, cur1, dt)
  const r2dir = tickRepeat(rep2, cur2, dt)

  // ── Start screen ────────────────────────────────────────────────────────────
  if (gs.phase === 'start') {
    if (SYSTEM.ONE_PLAYER || SYSTEM.TWO_PLAYER) {
      gs = { ...gs, phase: 'playing' }
    }

  // ── Game over ────────────────────────────────────────────────────────────────
  } else if (gs.phase === 'gameover') {
    if (e1.a || e1.b || e2.a || e2.b || SYSTEM.ONE_PLAYER || SYSTEM.TWO_PLAYER) {
      gs = { ...initState(), phase: 'playing' }
    }

  // ── Clearing animation ───────────────────────────────────────────────────────
  } else if (gs.phase === 'clearing') {
    gs = { ...gs, clearMs: gs.clearMs - dt }
    if (gs.clearMs <= 0) {
      // Now remove cleared cells from grid and collapse
      const nextGrid = gs.grid.map((row, r) =>
        row.map((cell, c) => gs.clearing.has(key(r, c)) ? null : cell)
      )
      gs = { ...gs, grid: collapseGrid(nextGrid), clearing: new Set(), phase: 'playing' }
    }

  // ── Playing ──────────────────────────────────────────────────────────────────
  } else {

    // P1: move falling letter left/right
    if ((e1.left || r1dir === 'left') && gs.fCol > 0) {
      const nc = gs.fCol - 1
      if (gs.grid[gs.fRow][nc] === null) gs = { ...gs, fCol: nc }
    }
    if ((e1.right || r1dir === 'right') && gs.fCol < COLS - 1) {
      const nc = gs.fCol + 1
      if (gs.grid[gs.fRow][nc] === null) gs = { ...gs, fCol: nc }
    }

    // P1: A = hard drop to bottom
    if (e1.a) {
      while (gs.fRow + 1 < ROWS && gs.grid[gs.fRow + 1][gs.fCol] === null) {
        gs = { ...gs, fRow: gs.fRow + 1 }
      }
      placeFalling()
    }

    // P2: move cursor (only if still playing after P1 actions)
    if (gs.phase === 'playing') {
      const [cr, cc] = gs.cursor
      let nr = cr, nc = cc
      if ((e2.up    || r2dir === 'up')    && cr > 0)        nr = cr - 1
      if ((e2.down  || r2dir === 'down')  && cr < ROWS - 1) nr = cr + 1
      if ((e2.left  || r2dir === 'left')  && cc > 0)        nc = cc - 1
      if ((e2.right || r2dir === 'right') && cc < COLS - 1) nc = cc + 1
      if (nr !== cr || nc !== cc) gs = { ...gs, cursor: [nr, nc] }

      // P2: A = select/deselect letter
      if (e2.a) {
        const [r, c] = gs.cursor
        if (gs.grid[r][c] !== null) {
          const last = gs.path[gs.path.length - 1]
          const isLast = last != null && last[0] === r && last[1] === c
          const inPath = gs.path.some(([pr, pc]) => pr === r && pc === c)

          if (isLast) {
            // Backtrack
            gs = { ...gs, path: gs.path.slice(0, -1) }
          } else if (!inPath && (gs.path.length === 0 || adjacent(last, [r, c]))) {
            // Extend path
            gs = { ...gs, path: [...gs.path, [r, c]] }
          }
        }
      }

      // P2: B = submit word or clear path
      if (e2.b) {
        if (gs.path.length >= MIN_WORD) {
          trySubmitWord()
        } else {
          gs = { ...gs, path: [], lastWord: '' }
        }
      }

      // Gravity: auto-fall tick
      gs = { ...gs, tickMs: gs.tickMs + dt }
      const baseInterval = Math.max(80, TICK_MS - gs.clears * 15)
      const interval = cur1.down ? FAST_TICK_MS : baseInterval
      while (gs.tickMs >= interval && gs.phase === 'playing') {
        gs = { ...gs, tickMs: gs.tickMs - interval }
        const nr2 = gs.fRow + 1
        if (nr2 < ROWS && gs.grid[nr2][gs.fCol] === null) {
          gs = { ...gs, fRow: nr2 }
        } else {
          placeFalling()
          break
        }
      }
    }
  }

  prev1 = cur1
  prev2 = cur2

  render()
  requestAnimationFrame(update)
}

requestAnimationFrame(update)
