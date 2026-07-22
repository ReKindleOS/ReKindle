/*
 * gamerules.js - Shared "How to Play" help button for game pages.
 *
 * Injects a "?" button into the page's .title-bar and opens a System 7
 * modal with the rules for the current game. The game is detected from
 * the page filename, so pages only need to include this script:
 *
 *   <script src="js/gamerules.js"></script>
 *
 * Rules text is looked up via window.t('gamerules.<key>') so translations
 * can be added to the locale files later; the English strings below are
 * the fallback defaults.
 */
(function () {
    var RULES = {
        g2048: '<p>Slide all tiles in one direction using the arrow keys or on-screen buttons.</p><ul><li>When two tiles with the same number touch, they merge into one tile worth double.</li><li>A new tile (2 or 4) appears after every move.</li><li>Reach the <b>2048</b> tile to win.</li><li>The game ends when the board is full and no merges are possible.</li></ul>',
        akinator: '<p>Think of a real or fictional character, and the genie will try to guess who it is by asking questions.</p><ul><li>Answer each question honestly: Yes, No, Don\'t Know, Probably, or Probably Not.</li><li>The more questions you answer, the better the guess.</li><li>If the first guess is wrong, keep playing - the genie will try again.</li></ul>',
        anagrams: '<p>Unscramble the letters to find words.</p><ul><li>Every word must use only the letters shown.</li><li>Longer words score more points.</li><li>Find as many words as you can before time runs out.</li></ul>',
        battleship: '<p>Sink the enemy fleet before yours is sunk.</p><ul><li>Place your ships on your grid (horizontally or vertically) or use Auto to place them randomly.</li><li>Take turns firing at a square on the enemy grid.</li><li>A <b>hit</b> is marked when you strike a ship; keep firing nearby squares to sink it.</li><li>A ship is sunk when every square it occupies has been hit.</li><li>First player to sink all enemy ships wins.</li></ul>',
        blackjack: '<p>Beat the dealer by getting a hand closer to 21 without going over.</p><ul><li>Number cards are worth their face value, face cards are worth 10, and Aces are worth 1 or 11.</li><li><b>Hit</b> to take another card, <b>Stand</b> to keep your hand.</li><li><b>Double</b> doubles your bet and deals exactly one more card.</li><li>Going over 21 is a bust and loses the hand.</li><li>The dealer must draw to 16 and stand on 17.</li></ul>',
        blockblast: '<p>Place block pieces on the grid to clear lines and score points.</p><ul><li>Drag one of the three pieces onto the board each turn.</li><li>A full row or column is cleared for points.</li><li>Clearing multiple lines at once scores bonus points.</li><li>The game ends when none of the remaining pieces fit on the board.</li></ul>',
        checkers: '<p>Capture all of your opponent\'s pieces or block them so they cannot move.</p><ul><li>Pieces move diagonally forward one square on dark squares.</li><li>Capture by jumping over an adjacent enemy piece to the empty square beyond it.</li><li>Jumps are mandatory when available, and multiple jumps can be chained in one turn.</li><li>Reaching the far row crowns your piece a <b>King</b>, which can move and jump backwards.</li></ul>',
        chess: '<p>Checkmate the enemy king: trap it so it cannot escape capture.</p><ul><li><b>Pawn</b>: moves forward, captures diagonally. <b>Rook</b>: straight lines. <b>Bishop</b>: diagonals. <b>Knight</b>: L-shape, can jump. <b>Queen</b>: any direction. <b>King</b>: one square any direction.</li><li>You cannot make a move that leaves your own king in check.</li><li>Tap a piece to see its legal moves, then tap a highlighted square to move.</li><li>Stalemate (no legal moves but not in check) is a draw.</li></ul>',
        codebreaker: '<p>Crack the hidden color code.</p><ul><li>Each guess is a row of colored pegs.</li><li>After each guess you get feedback: a <b>black</b> peg means a correct color in the correct position, a <b>white</b> peg means a correct color in the wrong position.</li><li>Use the feedback to deduce the code before you run out of guesses.</li></ul>',
        connect4: '<p>Be the first to line up your discs in a row.</p><ul><li>Tap a column to drop your disc into the lowest free slot.</li><li>Connect four (or five, depending on the mode) of your discs horizontally, vertically, or diagonally to win.</li><li>Block your opponent when they have three in a row.</li></ul>',
        crossword: '<p>Fill the grid using the Across and Down clues.</p><ul><li>Tap a square or a clue to select a word, then type to fill it in.</li><li>Letters are shared between crossing words, so solving one word gives hints for others.</li><li>The puzzle is complete when every square matches the solution.</li></ul>',
        dotsandboxes: '<p>Claim more boxes than your opponent.</p><ul><li>Take turns drawing a single line between two adjacent dots.</li><li>Completing the fourth side of a box claims it and scores a point.</li><li>Completing a box earns you another turn - chain boxes together.</li><li>Avoid drawing the third side of a box, which hands it to your opponent.</li></ul>',
        hanoi: '<p>Move the entire stack of discs to another peg.</p><ul><li>Only one disc can be moved at a time.</li><li>A larger disc can never be placed on top of a smaller disc.</li><li>Use the third peg as temporary storage.</li><li>Try to finish in the minimum number of moves.</li></ul>',
        lightsout: '<p>Turn off all the lights.</p><ul><li>Tapping a light toggles it AND its directly adjacent neighbors (up, down, left, right).</li><li>Every tap affects up to five lights at once, so plan ahead.</li><li>Win by switching every light off.</li></ul>',
        minesweeper: '<p>Clear the board without detonating a mine.</p><ul><li>Tap a square to reveal it.</li><li>A number shows how many mines touch that square (including diagonals).</li><li>Use the numbers to deduce where mines are hiding.</li><li>Flag squares you believe contain mines so you don\'t tap them.</li><li>Reveal every safe square to win.</li></ul>',
        nerdle: '<p>Guess the hidden math equation in 6 tries.</p><ul><li>Each guess must be a valid calculation (e.g. 12+35=47) with one = sign.</li><li>After each guess, tiles change color: <b>correct spot</b>, <b>in the equation but wrong spot</b>, or <b>not in the equation</b>.</li><li>The answer is a full equation - both sides must be mathematically correct.</li></ul>',
        nonograms: '<p>Reveal the hidden picture using the number clues.</p><ul><li>The numbers beside each row and column tell you the lengths of consecutive filled blocks in that line.</li><li>For example, "3 1" means a block of 3 filled cells, a gap, then 1 filled cell.</li><li>Fill cells you are sure about and mark known-empty cells with an X.</li><li>Complete the grid to reveal the picture.</li></ul>',
        oregontrail: '<p>Lead your wagon party of five from Independence, Missouri to the Willamette Valley, 2000 miles west.</p><ul><li>Pick a profession, buy oxen, food, bullets, clothing and spare parts at the General Store, then set out between March and June.</li><li><b>Travel</b> each day; manage pace and rations - pushing hard or skimping on food wears your party down. <b>Rest</b> to heal, <b>Hunt</b> for meat (tap an animal to shoot), <b>Trade</b> with passing traders.</li><li>Party members fall ill and get hurt - rest helps them recover. If the leader dies, the journey ends.</li><li>Rivers must be forded, floated, waited out or crossed by ferry. Forts sell supplies at rising prices.</li><li>Clothing protects against the cold. Reach the Blue Mountains before winter or face blizzards.</li><li>Survivors, supplies and cash left at the end decide your score, multiplied by your profession bonus.</li></ul>',
        pictionary: '<p>Draw the secret word and guess what others are drawing.</p><ul><li>One player draws the given word while everyone else guesses.</li><li>Type your guess into the guess box - correct guesses score points.</li><li>The drawer cannot write the word itself.</li><li>Rounds rotate so every player gets a turn to draw.</li></ul>',
        pool: '<p>Pocket all of your balls, then the 8-ball, to win.</p><ul><li>Drag to aim the cue, then release to shoot - longer drags hit harder.</li><li>After the break, the first ball potted decides who has solids and who has stripes.</li><li>Sink all seven of your balls, then legally pot the black 8-ball to win.</li><li>Scratching (potting the cue ball) or potting the 8-ball early loses the game.</li></ul>',
        solitaire: '<p>Build all four suits from Ace to King on the foundations.</p><ul><li>Cards in the tableau stack in descending order, alternating red and black.</li><li>Only Kings can be placed on empty tableau columns.</li><li>Tap the stock pile to draw new cards.</li><li>Move Aces up to the foundation piles, then build each suit upward.</li><li>Reveal every face-down card and complete all four foundations to win.</li></ul>',
        spellbound: '<p>Make as many words as you can from the seven letters.</p><ul><li>Every word must include the center letter.</li><li>Words must be at least four letters long.</li><li>Letters can be reused within a word.</li><li>A word using all seven letters is a <b>pangram</b> and scores bonus points.</li></ul>',
        strands: '<p>Find all the theme words hidden in the letter grid.</p><ul><li>Drag across adjacent letters (including diagonals) to spell a word.</li><li>Every theme word relates to the day\'s theme hint.</li><li>One special word, the <b>spangram</b>, describes the theme and stretches from one edge of the grid to the other.</li><li>Every letter on the board is used exactly once when all words are found.</li></ul>',
        sudoku: '<p>Fill the grid so every row, column, and 3x3 box contains the digits 1-9 exactly once.</p><ul><li>Tap a square, then tap a number to place it.</li><li>Given numbers cannot be changed.</li><li>Use notes/pencil marks to track candidates for tricky squares.</li><li>A number is wrong if it duplicates one already in the same row, column, or box.</li></ul>',
        texasholdem: '<p>Make the best five-card poker hand to win the pot.</p><ul><li>Each player gets two private cards; five community cards are dealt face-up in stages (flop, turn, river).</li><li>Each round you can check, call, raise, or fold.</li><li>Hand rankings, best to worst: Royal Flush, Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, Pair, High Card.</li><li>Win by having the best hand at showdown or by making everyone else fold.</li></ul>',
        uno: '<p>Be the first to get rid of all your cards.</p><ul><li>Play a card matching the top discard by color, number, or symbol.</li><li>If you cannot play, you must draw a card.</li><li>Action cards: <b>Skip</b> skips the next player, <b>Reverse</b> changes direction, <b>Draw Two</b> makes the next player draw 2, <b>Wild</b> changes the color, and <b>Wild Draw Four</b> changes the color and makes the next player draw 4.</li><li>Win the round by playing your last card.</li></ul>',
        wordle: '<p>Guess the hidden word in 6 tries.</p><ul><li>Each guess must be a valid word.</li><li>After each guess the tiles change color: the letter is in the <b>correct spot</b>, in the word but in the <b>wrong spot</b>, or <b>not in the word</b> at all.</li><li>Use the color clues to narrow down the answer.</li></ul>',
        wordsearch: '<p>Find all the hidden words in the letter grid.</p><ul><li>Words can run horizontally, vertically, or diagonally - in either direction.</li><li>Drag across the letters of a word to select it.</li><li>Found words are crossed off the word list.</li><li>Find every word to complete the puzzle.</li></ul>',
        yahtzee: '<p>Score the most points by rolling dice combinations over 13 rounds.</p><ul><li>Each turn you may roll the dice up to three times, holding any dice you want to keep between rolls.</li><li>After rolling, choose an empty category on your scorecard to score the roll (e.g. Three of a Kind, Full House, Straight, Yahtzee).</li><li>Each category can only be used once per game - a bad roll may force you to sacrifice a category for zero.</li><li>A <b>Yahtzee</b> is five of a kind and scores 50 points.</li><li>Scoring 63+ in the upper section earns a 35-point bonus.</li></ul>'
    };

    var ALIASES = {
        '2048': 'g2048',
        'akinator': 'akinator',
        'anagrams': 'anagrams',
        'battleship': 'battleship',
        '2pbattleships': 'battleship',
        'blackjack': 'blackjack',
        'blockblast': 'blockblast',
        'checkers': 'checkers',
        '2pcheckers': 'checkers',
        'livecheckers': 'checkers',
        'chess': 'chess',
        '2pchess': 'chess',
        'livechess': 'chess',
        'codebreaker': 'codebreaker',
        'connect4': 'connect4',
        '2pconnect4': 'connect4',
        'liveconnect4': 'connect4',
        'crossword': 'crossword',
        'dotsandboxes': 'dotsandboxes',
        '2pdotsandboxes': 'dotsandboxes',
        'livedotsandboxes': 'dotsandboxes',
        'hanoi': 'hanoi',
        'lightsout': 'lightsout',
        'livepictionary': 'pictionary',
        'liveuno': 'uno',
        'yahtzee': 'yahtzee',
        'liveyahtzee': 'yahtzee',
        'minesweeper': 'minesweeper',
        'nerdle': 'nerdle',
        'nonograms': 'nonograms',
        'oregontrail': 'oregontrail',
        'pool': 'pool',
        'pool2p': 'pool',
        'solitaire': 'solitaire',
        'spellbound': 'spellbound',
        'strands': 'strands',
        'sudoku': 'sudoku',
        'texasholdem': 'texasholdem',
        'wordle': 'wordle',
        'wordsearch': 'wordsearch'
    };

    var CSS = [
        '#gamerules-help-btn {',
        '    position: absolute;',
        '    right: 10px;',
        '    top: 50%;',
        '    margin-top: -11px;',
        '    width: 18px;',
        '    height: 18px;',
        '    border: 2px solid black;',
        '    background: white;',
        '    z-index: 2;',
        '    box-shadow: 2px 2px 0 black;',
        '    cursor: pointer;',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: center;',
        '    font-family: inherit;',
        '    font-weight: bold;',
        '    font-size: 0.8rem;',
        '    line-height: 1;',
        '    padding: 0;',
        '}',
        '#gamerules-help-btn:active {',
        '    transform: translate(1px, 1px);',
        '    box-shadow: none;',
        '    background: black;',
        '    color: white;',
        '}',
        '#gamerules-overlay {',
        '    display: none;',
        '    position: fixed;',
        '    top: 0; left: 0;',
        '    width: 100%; height: 100%;',
        '    background: rgba(255, 255, 255, 0.9);',
        '    z-index: 10000;',
        '    align-items: center;',
        '    justify-content: center;',
        '}',
        '#gamerules-overlay.open { display: flex; }',
        '#gamerules-overlay .gamerules-box {',
        '    background: white;',
        '    border: 2px solid black;',
        '    box-shadow: 4px 4px 0 #000;',
        '    width: 85%;',
        '    max-width: 480px;',
        '    max-height: 80vh;',
        '    display: flex;',
        '    flex-direction: column;',
        '}',
        '#gamerules-overlay .gamerules-titlebar {',
        '    height: 30px;',
        '    border-bottom: 2px solid black;',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: center;',
        '    background: white;',
        '    position: relative;',
        '    flex-shrink: 0;',
        '}',
        '#gamerules-overlay .gamerules-stripes {',
        '    position: absolute;',
        '    top: 4px; bottom: 4px; left: 4px; right: 4px;',
        '    background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, #000 4px);',
        '    z-index: 0;',
        '}',
        '#gamerules-overlay .gamerules-title {',
        '    background: white;',
        '    padding: 0 15px;',
        '    font-weight: bold;',
        '    font-size: 1rem;',
        '    z-index: 1;',
        '    border: none;',
        '    display: inline-flex;',
        '    align-items: center;',
        '    height: 100%;',
        '    box-sizing: border-box;',
        '}',
        '#gamerules-overlay .gamerules-body {',
        '    padding: 15px;',
        '    overflow-y: auto;',
        '    font-size: 0.95rem;',
        '    line-height: 1.4;',
        '}',
        '#gamerules-overlay .gamerules-body p { margin: 0 0 10px 0; }',
        '#gamerules-overlay .gamerules-body ul { margin: 0; padding-left: 20px; }',
        '#gamerules-overlay .gamerules-body li { margin-bottom: 6px; }',
        '#gamerules-overlay .gamerules-footer {',
        '    padding: 10px 15px 15px 15px;',
        '    text-align: center;',
        '    flex-shrink: 0;',
        '}',
        '#gamerules-overlay .gamerules-close {',
        '    border: 2px solid black;',
        '    background: white;',
        '    box-shadow: 2px 2px 0 black;',
        '    cursor: pointer;',
        '    font-family: inherit;',
        '    font-size: 1rem;',
        '    padding: 6px 24px;',
        '}',
        '#gamerules-overlay .gamerules-close:active {',
        '    transform: translate(2px, 2px);',
        '    box-shadow: none;',
        '    background: black;',
        '    color: white;',
        '}'
    ].join('\n');

    function translate(key, fallback) {
        if (typeof window.t === 'function') {
            return window.t(key, fallback || key);
        }
        return fallback || key;
    }

    function getRulesKey() {
        var path = window.location.pathname;
        var file = path.substring(path.lastIndexOf('/') + 1).replace(/\.html?$/i, '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(ALIASES, file)) {
            return ALIASES[file];
        }
        return null;
    }

    function openModal(rulesKey) {
        var overlay = document.getElementById('gamerules-overlay');
        if (overlay) {
            overlay.classList.add('open');
            return;
        }

        overlay = document.createElement('div');
        overlay.id = 'gamerules-overlay';

        var box = document.createElement('div');
        box.className = 'gamerules-box';

        var titlebar = document.createElement('div');
        titlebar.className = 'gamerules-titlebar';
        var stripes = document.createElement('div');
        stripes.className = 'gamerules-stripes';
        var title = document.createElement('span');
        title.className = 'gamerules-title';
        title.textContent = translate('gamerules.title', 'How to Play');
        titlebar.appendChild(stripes);
        titlebar.appendChild(title);

        var body = document.createElement('div');
        body.className = 'gamerules-body';
        body.innerHTML = translate('gamerules.' + rulesKey, RULES[rulesKey]);

        var footer = document.createElement('div');
        footer.className = 'gamerules-footer';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'gamerules-close';
        closeBtn.textContent = translate('gamerules.close', 'Close');
        closeBtn.onclick = function () {
            overlay.classList.remove('open');
        };
        footer.appendChild(closeBtn);

        box.appendChild(titlebar);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        overlay.onclick = function (e) {
            if (e.target === overlay) {
                overlay.classList.remove('open');
            }
        };

        document.body.appendChild(overlay);
        overlay.classList.add('open');
    }

    function injectButton(rulesKey) {
        var bar = document.querySelector('.title-bar');
        if (!bar) return;
        if (document.getElementById('gamerules-help-btn')) return;

        var barStyle = window.getComputedStyle(bar);
        if (barStyle.position === 'static') {
            bar.style.position = 'relative';
        }

        var btn = document.createElement('button');
        btn.id = 'gamerules-help-btn';
        btn.type = 'button';
        btn.textContent = '?';
        btn.title = translate('gamerules.title', 'How to Play');
        btn.onclick = function () {
            openModal(rulesKey);
        };
        bar.appendChild(btn);

        // Keep clear of any existing right-side controls in the title bar.
        // offsetLeft/offsetWidth are pre-zoom layout units, so this stays
        // correct even when theme.js applies a CSS zoom to the title bar.
        var barWidth = bar.clientWidth;
        var needed = 10;
        for (var i = 0; i < bar.children.length; i++) {
            var child = bar.children[i];
            if (child === btn) continue;
            if (child.classList.contains('title-stripes')) continue;
            if (child.classList.contains('title-text')) continue;
            if (window.getComputedStyle(child).position !== 'absolute') continue;
            var center = child.offsetLeft + child.offsetWidth / 2;
            if (center > barWidth / 2) {
                var gap = barWidth - child.offsetLeft + 8;
                if (gap > needed) needed = gap;
            }
        }
        btn.style.right = needed + 'px';
    }

    function init() {
        var rulesKey = getRulesKey();
        if (!rulesKey || !RULES[rulesKey]) return;

        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        injectButton(rulesKey);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
