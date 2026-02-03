var requestAnimFrame = (function () {
  return window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function (callback) {
      window.setTimeout(callback, 1000 / 60);
    };
})();

//create the canvas
var canvas = document.createElement("canvas");
var ctx = canvas.getContext('2d');
var updateables = [];
var fireballs = [];
var player = new Mario.Player([0, 0]);
var bgPattern;

const BASE_WIDTH = 256;
const BASE_HEIGHT = 240;

function resizeCanvas() {
  const windowWidth = window.innerWidth - 40; // Subtract padding/margin
  const windowHeight = window.innerHeight - 150; // Subtract title bar and controls

  const scaleX = Math.floor(windowWidth / BASE_WIDTH);
  const scaleY = Math.floor(windowHeight / BASE_HEIGHT);
  const scale = Math.max(1, Math.min(scaleX, scaleY));

  canvas.width = BASE_WIDTH * scale;
  canvas.height = BASE_HEIGHT * scale;

  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.msImageSmoothingEnabled = false;

  ctx.scale(scale, scale);

  // Initialize background pattern
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 2;
  pCanvas.height = 2;
  const pCtx = pCanvas.getContext('2d');
  pCtx.fillStyle = '#000000';
  pCtx.fillRect(0, 0, 1, 1);
  pCtx.fillRect(1, 1, 1, 1);
  pCtx.fillStyle = '#ffffff';
  pCtx.fillRect(1, 0, 1, 1);
  pCtx.fillRect(0, 1, 1, 1);
  bgPattern = ctx.createPattern(pCanvas, 'repeat');
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
document.body.appendChild(canvas);

//viewport
var vX = 0,
  vY = 0,
  vWidth = 256,
  vHeight = 240;

//load our images
resources.load([
  'mario_assets/sprites/player.png',
  'mario_assets/sprites/enemy.png',
  'mario_assets/sprites/tiles.png',
  'mario_assets/sprites/playerl.png',
  'mario_assets/sprites/items.png',
  'mario_assets/sprites/enemyr.png',
]);

resources.onReady(init);
var level;
var sounds;
var music;

//initialize
var lastTime;
function init() {
  music = {
    overworld: { play: function () { }, pause: function () { }, currentTime: 0 },
    underground: { play: function () { }, pause: function () { }, currentTime: 0 },
    clear: { play: function () { }, pause: function () { }, currentTime: 0 },
    death: { play: function () { }, pause: function () { }, currentTime: 0 }
  };
  sounds = {
    smallJump: { play: function () { }, pause: function () { }, currentTime: 0 },
    bigJump: { play: function () { }, pause: function () { }, currentTime: 0 },
    breakBlock: { play: function () { }, pause: function () { }, currentTime: 0 },
    bump: { play: function () { }, pause: function () { }, currentTime: 0 },
    coin: { play: function () { }, pause: function () { }, currentTime: 0 },
    fireball: { play: function () { }, pause: function () { }, currentTime: 0 },
    flagpole: { play: function () { }, pause: function () { }, currentTime: 0 },
    kick: { play: function () { }, pause: function () { }, currentTime: 0 },
    pipe: { play: function () { }, pause: function () { }, currentTime: 0 },
    itemAppear: { play: function () { }, pause: function () { }, currentTime: 0 },
    powerup: { play: function () { }, pause: function () { }, currentTime: 0 },
    stomp: { play: function () { }, pause: function () { }, currentTime: 0 }
  };
  Mario.oneone();
  lastTime = Date.now();
  main();
}

var gameTime = 0;
var gameStarted = false;
var autoRunActive = false;
var lastRightDown = false;
var lastADown = false;
window.resetAutoRun = function () {
  autoRunActive = false;
};

window.toggleAutoRun = function () {
  autoRunActive = !autoRunActive;
};

//set up the game loop
function main() {
  if (gamePaused) {
    requestAnimFrame(main);
    return;
  }
  var now = Date.now();
  var dt = (now - lastTime) / 1000.0;
  if (dt > 0.1) dt = 0.1; // Cap dt to 10 FPS to prevent large physics jumps

  update(dt);
  render();

  lastTime = now;
  requestAnimFrame(main);
}

function update(dt) {
  dt *= 0.65; // Global speed adjustment
  Mario.dt = dt;
  Mario.dt = dt;
  if (gameStarted) {
    // Stop timer if level is complete (100% progress)
    // We need to access the computed progress, so we'll do a quick check here
    var pStart = (level && level.startX !== undefined) ? level.startX : 0;
    var pEnd = (level && level.endX !== undefined) ? level.endX : 0;
    // Tweak pEnd to be slightly shorter to make 99% the new 100% (approx 32px less)
    var effectiveEnd = pEnd - 32;

    var currentProgress = 0;
    if (effectiveEnd > pStart) {
      currentProgress = ((player.pos[0] - pStart) / (effectiveEnd - pStart)) * 100;
    }

    if (currentProgress < 100) {
      gameTime += dt;
    }
  }

  handleInput(dt);
  updateEntities(dt, gameTime);

  checkCollisions();
  updateTitleBar();
}

function updateTitleBar() {
  const distEl = document.getElementById('dist-count');
  const timerEl = document.getElementById('timer-count');
  const coinEl = document.getElementById('coin-count');

  if (distEl && level && (level.exit || level.endX)) {
    const startX = level.startX !== undefined ? level.startX : (level.playerPos ? level.playerPos[0] : 0);
    const endX = level.endX !== undefined ? level.endX : (level.exit * 16);
    // Tweak endX for display to match the timer stop logic (approx 32px shorter)
    const effectiveEnd = endX - 32;

    const progress = Math.max(0, Math.min(100, Math.floor(((player.pos[0] - startX) / (effectiveEnd - startX)) * 100)));
    distEl.innerText = 'Distance: ' + progress + '%';
  }

  if (coinEl) {
    coinEl.innerText = player.coins + ' coins';
  }

  if (timerEl && !gamePaused) {
    timerEl.innerText = 'Time: ' + gameTime.toFixed(2);
  }
}

var gamePaused = false;
var scoreSubmitted = false;

function showCompletionModal() {
  gamePaused = true;
  const modal = document.getElementById('completion-modal');
  const overlay = document.getElementById('modal-overlay');
  const finalTimeEl = document.getElementById('final-time');

  if (modal && overlay && finalTimeEl) {
    const mins = Math.floor(gameTime / 60);
    const secs = Math.floor(gameTime % 60);
    const timeStr = gameTime.toFixed(2);
    finalTimeEl.innerText = 'TIME: ' + timeStr;
    modal.style.display = 'block';
    overlay.style.display = 'block';

    // Submit Scores on Win
    if (window.submitMarioScores && !scoreSubmitted) {
      scoreSubmitted = true;
      // SMB Scoring:
      // Coins: 200 pts each
      // Time Bonus: 50 pts per SECOND REMAINING? 
      //    Wait, SMB counts DOWN. We count UP.
      //    Let's invert it: Assume a "Par Time" of 300s?
      //    Or just reward LOW time differently?
      //    The prompt says "original super mario bros score algorithm".
      //    In SMB, you get 50pts per remaining second.
      //    Let's assume a generous 400s limit. Score = (400 - time) * 50.

      var timeBonus = Math.max(0, Math.floor((400 - gameTime) * 50));
      var coinScore = player.coins * 200;
      var completionBonus = 1000;

      var totalScore = coinScore + timeBonus + completionBonus;

      window.submitMarioScores(100, player.coins, gameTime, totalScore);
    }
  }
}

function restartGame() {
  const modal = document.getElementById('completion-modal');
  const overlay = document.getElementById('modal-overlay');
  if (modal) modal.style.display = 'none';
  if (overlay) overlay.style.display = 'none';

  gamePaused = false;
  gameTime = 0;
  player = new Mario.Player(level.playerPos);
  level.loader();
  input.reset();
  autoRunActive = false;
  gameStarted = false;
  scoreSubmitted = false;
  vX = 0;
}
window.restartGame = restartGame;

function handleInput(dt) {
  if (player.piping || player.dying || player.noInput) return; //don't accept input

  var rightDown = input.isDown('RIGHT');
  var leftDown = input.isDown('LEFT');
  var jumpDown = input.isDown('JUMP');
  var downDown = input.isDown('DOWN');

  if (!gameStarted && (rightDown || leftDown || jumpDown || downDown || input.isDown('A'))) {
    gameStarted = true;
  }

  if (input.isDown('A') && !lastADown) {
    var checkbox = document.getElementById('setting-autorun');
    if (checkbox) checkbox.checked = !checkbox.checked;
  }

  var autoRunEnabled = document.getElementById('setting-autorun') && document.getElementById('setting-autorun').checked;

  if (autoRunEnabled) {
    // Keyboard toggle logic: use lastRightDown to catch the edge
    if (rightDown && !lastRightDown) {
      window.toggleAutoRun();
    }
    // Cancel logic: left or down cancels auto-run
    if (leftDown || downDown) {
      autoRunActive = false;
    }
  } else {
    autoRunActive = false;
  }
  lastRightDown = rightDown;
  lastADown = input.isDown('A');

  if (input.isDown('RUN')) {
    player.run();
  } else {
    player.noRun();
  }
  if (input.isDown('JUMP')) {
    player.jump();
  } else {
    player.noJump();
  }

  if (input.isDown('DOWN')) {
    player.crouch();
  } else {
    player.noCrouch();
  }

  if (input.isDown('LEFT')) {
    player.moveLeft();
  } else if (rightDown || autoRunActive) {
    player.moveRight();
  } else {
    player.noWalk();
  }
  // Update visual state of all buttons
  var btnIds = {
    'RIGHT': 'btn-right',
    'LEFT': 'btn-left',
    'DOWN': 'btn-down',
    'RUN': 'btn-run',
    'JUMP': 'btn-jump'
  };

  for (var key in btnIds) {
    var el = document.getElementById(btnIds[key]);
    if (el) {
      var isPressed = input.isDown(key);
      if (key === 'RIGHT' && autoRunActive) isPressed = true;

      if (isPressed) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  }
}

//update all the moving stuff
function updateEntities(dt, gameTime) {
  player.update(dt, vX);
  updateables.forEach(function (ent) {
    ent.update(dt, gameTime);
  });

  //This should stop the jump when he switches sides on the flag.
  if (player.exiting) {
    if (player.pos[0] > vX + 96)
      vX = player.pos[0] - 96
  } else if (level.scrolling && player.pos[0] > vX + 80) {
    vX = player.pos[0] - 80;
  }

  if (player.powering.length !== 0 || player.dying) { return; }
  level.items.forEach(function (ent) {
    ent.update(dt);
  });

  level.enemies.forEach(function (ent) {
    ent.update(dt, vX);
  });

  fireballs.forEach(function (fireball) {
    fireball.update(dt);
  });
  level.pipes.forEach(function (pipe) {
    pipe.update(dt);
  });
}

//scan for collisions
function checkCollisions() {
  if (player.powering.length !== 0 || player.dying) { return; }
  player.checkCollisions();

  //Apparently for each will just skip indices where things were deleted.
  level.items.forEach(function (item) {
    item.checkCollisions();
  });
  level.enemies.forEach(function (ent) {
    ent.checkCollisions();
  });
  fireballs.forEach(function (fireball) {
    fireball.checkCollisions();
  });
  level.pipes.forEach(function (pipe) {
    pipe.checkCollisions();
  });
}

//draw the game!
function render() {
  updateables = [];
  if (bgPattern) {
    ctx.fillStyle = bgPattern;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  } else {
    ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  }

  //scenery gets drawn first to get layering right.
  for (var i = 0; i < 15; i++) {
    for (var j = Math.floor(vX / 16) - 1; j < Math.floor(vX / 16) + 20; j++) {
      if (level.scenery[i][j]) {
        renderEntity(level.scenery[i][j]);
      }
    }
  }

  //then items
  level.items.forEach(function (item) {
    renderEntity(item);
  });

  level.enemies.forEach(function (enemy) {
    renderEntity(enemy);
  });



  fireballs.forEach(function (fireball) {
    renderEntity(fireball);
  })

  //then we draw every static object.
  for (var i = 0; i < 15; i++) {
    for (var j = Math.floor(vX / 16) - 1; j < Math.floor(vX / 16) + 20; j++) {
      if (level.statics[i][j]) {
        renderEntity(level.statics[i][j]);
      }
      if (level.blocks[i][j]) {
        renderEntity(level.blocks[i][j]);
        updateables.push(level.blocks[i][j]);
      }
    }
  }

  //then the player
  if (player.invincibility > 0) {
    // Flash every 100ms
    if (Math.floor(Date.now() / 100) % 2 === 0) {
      renderEntity(player);
    }
  } else {
    renderEntity(player);
  }

  //Mario goes INTO pipes, so naturally they go after.
  level.pipes.forEach(function (pipe) {
    renderEntity(pipe);
  });
}

function renderEntity(entity) {
  entity.render(ctx, vX, vY);
}
