import './style.css';
import { BaseballGame } from './game/BaseballGame.js';

function registerServiceWorker(game) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
    return;
  }

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      game.notifyServiceWorkerReady();
    } catch (error) {
      console.warn('Service worker registration failed', error);
    }
  });
}

document.querySelector('#app').innerHTML = `
  <div class="game-shell">
    <aside class="hud-column">
      <section class="panel hero-panel">
        <p class="eyebrow">Vite + Three.js</p>
        <h1>3D 棒球對決</h1>
        <p class="hero-copy">投變化球、揮棒、盜壘、守備接殺，和 AI 在手機或電腦上打一場可存檔的 3D 棒球遊戲。</p>
      </section>

      <section class="panel scoreboard-panel">
        <div class="score-line">
          <div class="team-score player-team">
            <span class="team-label">玩家</span>
            <strong id="player-score">0</strong>
          </div>
          <div class="inning-block">
            <span id="inning-label">1 局上</span>
            <span id="role-label">你在進攻</span>
          </div>
          <div class="team-score ai-team">
            <span class="team-label">AI</span>
            <strong id="ai-score">0</strong>
          </div>
        </div>

        <div class="count-grid">
          <div><span>B</span><strong id="balls-count">0</strong></div>
          <div><span>S</span><strong id="strikes-count">0</strong></div>
          <div><span>O</span><strong id="outs-count">0</strong></div>
        </div>

        <div class="base-grid">
          <div id="base-1" class="base-chip">一壘</div>
          <div id="base-2" class="base-chip">二壘</div>
          <div id="base-3" class="base-chip">三壘</div>
        </div>
      </section>

      <section class="panel control-panel">
        <div class="control-row">
          <label for="difficulty">AI 強度</label>
          <select id="difficulty">
            <option value="easy">簡單</option>
            <option value="normal">普通</option>
            <option value="hard">困難</option>
          </select>
        </div>

        <div class="control-group">
          <span class="group-title">球種</span>
          <div class="button-grid pitch-grid">
            <button type="button" class="control-button" data-pitch="fastball">1 四縫線</button>
            <button type="button" class="control-button" data-pitch="curveball">2 曲球</button>
            <button type="button" class="control-button" data-pitch="slider">3 滑球</button>
            <button type="button" class="control-button" data-pitch="changeup">4 變速球</button>
          </div>
        </div>

        <div class="control-group">
          <span class="group-title">投球九宮格</span>
          <div class="zone-grid" id="zone-grid">
            ${Array.from({ length: 9 }, (_, index) => `<button type="button" class="zone-button" data-zone="${index}"></button>`).join('')}
          </div>
        </div>

        <div class="button-stack">
          <button type="button" class="action-button primary-action" id="primary-action">揮棒</button>
          <button type="button" class="action-button secondary-action" id="steal-action">盜壘</button>
          <button type="button" class="action-button secondary-action" id="double-steal-action">雙盜壘</button>
          <div class="mini-actions">
            <button type="button" class="action-button ghost-action" id="save-action">存檔</button>
            <button type="button" class="action-button ghost-action" id="new-game-action">新比賽</button>
            <button type="button" class="action-button ghost-action hidden" id="install-action">安裝到手機</button>
          </div>
        </div>

        <div class="hint-card">
          <p class="group-title">操作</p>
          <p>數字 1-4 選球種，方向鍵選 9 宮格，Enter 投球，Space 揮棒，Shift 盜壘，D 雙盜壘。</p>
          <p>滑鼠拖曳可調整視角，滾輪縮放，雙擊畫面或按 R 可以重設視角。</p>
        </div>
      </section>
    </aside>

    <main class="stadium-column">
      <section class="stadium-frame">
        <canvas id="stadium-canvas" aria-label="3D 棒球場"></canvas>
        <div class="stadium-overlay">
          <div class="overlay-chip" id="phase-chip">準備開打</div>
          <div class="overlay-chip accent">高飛球接殺率 75%</div>
          <div class="overlay-chip">可拖曳調視角</div>
        </div>
      </section>
      <section class="panel event-panel">
        <p class="group-title">即時戰況</p>
        <p id="event-log">比賽準備中...</p>
      </section>
    </main>
  </div>
`;

const ui = {
  stadiumFrame: document.querySelector('.stadium-frame'),
  canvas: document.querySelector('#stadium-canvas'),
  playerScore: document.querySelector('#player-score'),
  aiScore: document.querySelector('#ai-score'),
  inningLabel: document.querySelector('#inning-label'),
  roleLabel: document.querySelector('#role-label'),
  ballsCount: document.querySelector('#balls-count'),
  strikesCount: document.querySelector('#strikes-count'),
  outsCount: document.querySelector('#outs-count'),
  baseChips: [
    document.querySelector('#base-1'),
    document.querySelector('#base-2'),
    document.querySelector('#base-3'),
  ],
  difficulty: document.querySelector('#difficulty'),
  pitchButtons: Array.from(document.querySelectorAll('[data-pitch]')),
  zoneButtons: Array.from(document.querySelectorAll('[data-zone]')),
  primaryAction: document.querySelector('#primary-action'),
  stealAction: document.querySelector('#steal-action'),
  doubleStealAction: document.querySelector('#double-steal-action'),
  saveAction: document.querySelector('#save-action'),
  newGameAction: document.querySelector('#new-game-action'),
  installAction: document.querySelector('#install-action'),
  phaseChip: document.querySelector('#phase-chip'),
  eventLog: document.querySelector('#event-log'),
};

const game = new BaseballGame(ui);
registerServiceWorker(game);
