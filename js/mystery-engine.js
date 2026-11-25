/*
 * Case Files — deterministic whodunit generator and solver.
 *
 * Pure JavaScript with no DOM/Firebase/localStorage access so
 * scripts/test-mystery.js can exercise thousands of cases under Node.
 *
 * Model: n suspects were each in a unique room at a unique time. The crime
 * happened in one room at one time; exactly one suspect was there. Clues are
 * true statements about the assignment. The generator adds clues until the
 * solver finds exactly one solution, so the case is always fair.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.RekindleMystery = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // --- authored narrative skins -----------------------------------------
    var SETTINGS = [
        {
            id: 'manor',
            title: 'The Blackwood Manor Case',
            place: 'Blackwood Manor',
            victim: 'Lord Blackwood',
            story: 'A storm cut the lights at {place}. When the lamps came back, {victim} was found in the {room}, and the doctor said it was no accident. Five guests were staying the night. Each was in a different room at a different time. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Mrs. Vale', role: 'the housekeeper' },
                { name: 'Dr. Penrose', role: 'the family doctor' },
                { name: 'Clara Finch', role: 'the governess' },
                { name: 'Mr. Rook', role: 'the solicitor' },
                { name: 'Ned Carter', role: 'the stable hand' }
            ],
            rooms: ['library', 'conservatory', 'kitchen', 'study', 'cellar'],
            times: ['7:00', '7:30', '8:00', '8:30', '9:00']
        },
        {
            id: 'express',
            title: 'The Midnight Express',
            place: 'the Midnight Express',
            victim: 'the conductor',
            story: 'The express was somewhere between two stations when the lights flickered. {Victim} was found in the {room}, and the train was searched before the next stop. Five passengers had no alibi at {time}, and each was in a different carriage or room. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Miss Ada Bell', role: 'the singer' },
                { name: 'Mr. Quill', role: 'the journalist' },
                { name: 'Captain Hale', role: 'the retired officer' },
                { name: 'Tilly Marsh', role: 'the porter' },
                { name: 'Professor Voss', role: 'the botanist' }
            ],
            rooms: ['dining car', 'sleeping car', 'baggage car', 'guard coach', 'engine room'],
            times: ['10:00', '10:20', '10:40', '11:00', '11:20']
        },
        {
            id: 'camp',
            title: 'The Camp Whispering Pines Case',
            place: 'Camp Whispering Pines',
            victim: 'the camp director',
            story: 'The campfire had burned low when {victim} was found in the {room}. The gate was locked and nobody had left. Five campers were awake at {time}, each in a different place. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Jules', role: 'the archery coach' },
                { name: 'Mina', role: 'the camp nurse' },
                { name: 'Theo', role: 'the boat instructor' },
                { name: 'Priya', role: 'the cook' },
                { name: 'Sam', role: 'the junior counsellor' }
            ],
            rooms: ['boathouse', 'mess hall', 'archery shed', 'nurse cabin', 'storage loft'],
            times: ['8:00', '8:15', '8:30', '8:45', '9:00']
        },
        {
            id: 'museum',
            title: 'The Museum After Hours',
            place: 'the city museum',
            victim: 'the night curator',
            story: 'The museum closed at six, but the alarms stayed quiet until {time}. {Victim} was found in the {room}, and the front door was still chained. Five people with keys were inside, each in a different gallery. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Ms. Okoro', role: 'the conservator' },
                { name: 'Mr. Lang', role: 'the security guard' },
                { name: 'Elena Ruiz', role: 'the visiting artist' },
                { name: 'Dr. Hsu', role: 'the archaeologist' },
                { name: 'Ben Pike', role: 'the electrician' }
            ],
            rooms: ['sculpture hall', 'painting gallery', 'archive', 'workshop', 'loading bay'],
            times: ['6:30', '7:00', '7:30', '8:00', '8:30']
        },
        {
            id: 'hotel',
            title: 'The Seaside Hotel Case',
            place: 'the Seaside Hotel',
            victim: 'the hotel owner',
            story: 'The tide was high and the hotel was full when {victim} was found in the {room}. The storm had knocked out the phone line. Five guests were still awake at {time}, each in a different part of the hotel. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Miss Fairweather', role: 'the travel writer' },
                { name: 'Mr. Doyle', role: 'the chef' },
                { name: 'Nina Park', role: 'the pianist' },
                { name: 'Old Tom', role: 'the porter' },
                { name: 'Mrs. Grant', role: 'the guest in room 12' }
            ],
            rooms: ['ballroom', 'kitchen', 'piano lounge', 'front desk', 'boiler room'],
            times: ['9:00', '9:20', '9:40', '10:00', '10:20']
        },
        {
            id: 'fair',
            title: 'The School Fair Case',
            place: 'the school fair',
            victim: 'the head teacher',
            story: 'The fair was closing and the lanterns were being taken down when {victim} was found in the {room}. The gates were already locked. Five volunteers were still packing up at {time}, each in a different stall or room. One of them was in the {room} at {time}.',
            suspects: [
                { name: 'Mr. Bell', role: 'the science teacher' },
                { name: 'Aisha Khan', role: 'the bake-sale lead' },
                { name: 'Coach Reed', role: 'the games coach' },
                { name: 'Lottie', role: 'the art helper' },
                { name: 'Dev Patel', role: 'the sound volunteer' }
            ],
            rooms: ['hall', 'staff room', 'art room', 'kitchen', 'stage'],
            times: ['4:00', '4:15', '4:30', '4:45', '5:00']
        }
    ];

    var CLUE_KEYS = {
        room: 'mystery.clue.room',
        roomNot: 'mystery.clue.room_not',
        time: 'mystery.clue.time',
        timeNot: 'mystery.clue.time_not',
        roomTime: 'mystery.clue.room_time',
        roomTimeNot: 'mystery.clue.room_time_not',
        either: 'mystery.clue.either',
        order: 'mystery.clue.order',
        orderAfter: 'mystery.clue.order_after'
    };

    // --- deterministic RNG -------------------------------------------------
    function hashSeed(text) {
        var h = 2166136261;
        text = String(text);
        for (var i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function rngFrom(seed) {
        var a = hashSeed(seed) || 1;
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffle(list, rand) {
        var out = list.slice();
        for (var i = out.length - 1; i > 0; i--) {
            var j = Math.floor(rand() * (i + 1));
            var tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }
        return out;
    }

    function permutations(count) {
        var out = [];
        var used = [];
        var current = [];
        function walk() {
            if (current.length === count) {
                out.push(current.slice());
                return;
            }
            for (var i = 0; i < count; i++) {
                if (used[i]) continue;
                used[i] = true;
                current.push(i);
                walk();
                current.pop();
                used[i] = false;
            }
        }
        walk();
        return out;
    }

    function fill(template, values) {
        return String(template).replace(/\{([A-Za-z]+)\}/g, function (m, key) {
            return values[key] === undefined ? m : values[key];
        });
    }

    // --- clue predicates ---------------------------------------------------
    function clueTrue(clue, roomOf, timeOf) {
        switch (clue.kind) {
            case 'room':
                return (roomOf[clue.a] === clue.b) !== !!clue.neg;
            case 'time':
                return (timeOf[clue.a] === clue.b) !== !!clue.neg;
            case 'roomTime': {
                var who = -1;
                for (var s = 0; s < roomOf.length; s++) {
                    if (roomOf[s] === clue.a) { who = s; break; }
                }
                if (who === -1) return false;
                return (timeOf[who] === clue.b) !== !!clue.neg;
            }
            case 'either': {
                var count = 0;
                if (roomOf[clue.a] === clue.c) count++;
                if (roomOf[clue.b] === clue.c) count++;
                return count === 1;
            }
            case 'order':
                return clue.before
                    ? timeOf[clue.a] < timeOf[clue.b]
                    : timeOf[clue.a] > timeOf[clue.b];
            default:
                return false;
        }
    }

    function clueText(clue, ctx) {
        var a = ctx.suspects[clue.a] ? ctx.suspects[clue.a].name : '?';
        var b = ctx.rooms[clue.b] ? ctx.rooms[clue.b] : '?';
        var c = ctx.times[clue.b] ? ctx.times[clue.b] : '?';
        if (clue.kind === 'room') {
            return clue.neg
                ? fill('{name} was not in the {room}.', { name: a, room: b })
                : fill('{name} was in the {room}.', { name: a, room: b });
        }
        if (clue.kind === 'time') {
            return clue.neg
                ? fill('{name} was not there at {time}.', { name: a, time: c })
                : fill('{name} was there at {time}.', { name: a, time: c });
        }
        if (clue.kind === 'roomTime') {
            var roomName = ctx.rooms[clue.a] || '?';
            var timeName = ctx.times[clue.b] || '?';
            return clue.neg
                ? fill('The person in the {room} was not there at {time}.', { room: roomName, time: timeName })
                : fill('The person in the {room} was there at {time}.', { room: roomName, time: timeName });
        }
        if (clue.kind === 'either') {
            var other = ctx.suspects[clue.b] ? ctx.suspects[clue.b].name : '?';
            return fill('One of {a} or {b} was in the {room}.', { a: a, b: other, room: ctx.rooms[clue.c] || '?' });
        }
        if (clue.kind === 'order') {
            var second = ctx.suspects[clue.b] ? ctx.suspects[clue.b].name : '?';
            return clue.before
                ? fill('{a} arrived before {b}.', { a: a, b: second })
                : fill('{a} arrived after {b}.', { a: a, b: second });
        }
        return '';
    }

    function clueKey(clue) {
        if (clue.kind === 'room') return clue.neg ? CLUE_KEYS.roomNot : CLUE_KEYS.room;
        if (clue.kind === 'time') return clue.neg ? CLUE_KEYS.timeNot : CLUE_KEYS.time;
        if (clue.kind === 'roomTime') return clue.neg ? CLUE_KEYS.roomTimeNot : CLUE_KEYS.roomTime;
        if (clue.kind === 'either') return CLUE_KEYS.either;
        if (clue.kind === 'order') return clue.before ? CLUE_KEYS.order : CLUE_KEYS.orderAfter;
        return '';
    }

    function clueArgs(clue, ctx) {
        var names = ctx.suspects;
        var sName = names[clue.a] ? names[clue.a].name : '?';
        if (clue.kind === 'room') return { name: sName, room: ctx.rooms[clue.b] };
        if (clue.kind === 'time') return { name: sName, time: ctx.times[clue.b] };
        if (clue.kind === 'roomTime') return { room: ctx.rooms[clue.a], time: ctx.times[clue.b] };
        if (clue.kind === 'either') {
            return {
                a: sName,
                b: names[clue.b] ? names[clue.b].name : '?',
                room: ctx.rooms[clue.c]
            };
        }
        if (clue.kind === 'order') {
            return { a: sName, b: names[clue.b] ? names[clue.b].name : '?' };
        }
        return {};
    }

    // --- solver ------------------------------------------------------------
    function enumerateSolutions(n, clues, limit) {
        var roomPerms = permutations(n);
        var timePerms = permutations(n);
        var out = [];
        for (var r = 0; r < roomPerms.length; r++) {
            for (var t = 0; t < timePerms.length; t++) {
                var roomOf = roomPerms[r];
                var timeOf = timePerms[t];
                var ok = true;
                for (var c = 0; c < clues.length; c++) {
                    if (!clueTrue(clues[c], roomOf, timeOf)) { ok = false; break; }
                }
                if (ok) {
                    out.push({ roomOf: roomOf.slice(), timeOf: timeOf.slice() });
                    if (limit && out.length >= limit) return out;
                }
            }
        }
        return out;
    }

    function solve(caseData) {
        var n = caseData.suspects.length;
        var solutions = enumerateSolutions(n, caseData.clues, 2);
        return { solutions: solutions, unique: solutions.length === 1 };
    }

    // --- generator ---------------------------------------------------------
    function buildPool(ctx, roomOf, timeOf, rand, difficulty) {
        var n = ctx.suspects.length;
        var pool = [];
        var s, r, t, a, b;
        var directWeight = difficulty === 'easy' ? 3 : difficulty === 'normal' ? 2 : 1;

        for (s = 0; s < n; s++) {
            for (r = 0; r < n; r++) {
                var inRoom = roomOf[s] === r;
                if (inRoom) {
                    for (var k = 0; k < directWeight; k++) {
                        pool.push({ kind: 'room', a: s, b: r, neg: false });
                    }
                } else {
                    pool.push({ kind: 'room', a: s, b: r, neg: true });
                }
            }
            for (t = 0; t < n; t++) {
                var atTime = timeOf[s] === t;
                if (atTime) {
                    for (var k2 = 0; k2 < directWeight; k2++) {
                        pool.push({ kind: 'time', a: s, b: t, neg: false });
                    }
                } else {
                    pool.push({ kind: 'time', a: s, b: t, neg: true });
                }
            }
        }

        // Room/time relations: true for the occupant of that room, false for
        // every other time.
        for (r = 0; r < n; r++) {
            var occupant = -1;
            for (s = 0; s < n; s++) if (roomOf[s] === r) { occupant = s; break; }
            for (t = 0; t < n; t++) {
                if (timeOf[occupant] === t) {
                    pool.push({ kind: 'roomTime', a: r, b: t, neg: false });
                } else {
                    pool.push({ kind: 'roomTime', a: r, b: t, neg: true });
                }
            }
        }

        // Exactly-one disjunctions.
        for (r = 0; r < n; r++) {
            var inThisRoom = [];
            for (s = 0; s < n; s++) if (roomOf[s] === r) inThisRoom.push(s);
            if (!inThisRoom.length) continue;
            var sole = inThisRoom[0];
            for (a = 0; a < n; a++) {
                if (a === sole) continue;
                pool.push({ kind: 'either', a: sole, b: a, c: r });
            }
        }

        // Arrival-order clues (times are ordered).
        for (a = 0; a < n; a++) {
            for (b = 0; b < n; b++) {
                if (a === b) continue;
                if (timeOf[a] < timeOf[b]) pool.push({ kind: 'order', a: a, b: b, before: true });
                if (timeOf[a] > timeOf[b]) pool.push({ kind: 'order', a: a, b: b, before: false });
            }
        }

        return shuffle(pool, rand);
    }

    function generateCase(opts) {
        opts = opts || {};
        var difficulty = opts.difficulty === 'easy' || opts.difficulty === 'hard' ? opts.difficulty : 'normal';
        var n = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 5 : 4;
        var seed = String(opts.seed === undefined ? Date.now() : opts.seed);
        var rand = rngFrom(seed + ':' + difficulty);

        var setting = SETTINGS[Math.floor(rand() * SETTINGS.length)];
        // Shuffle the pools per case so the same setting does not always use
        // the same first n names.
        var suspects = shuffle(setting.suspects.map(function (s, i) {
            return { id: 's' + i, name: s.name, role: s.role };
        }), rand).slice(0, n).map(function (s, i) {
            return { id: 's' + i, name: s.name, role: s.role };
        });
        var rooms = shuffle(setting.rooms.slice(), rand).slice(0, n);
        var times = shuffle(setting.times.slice(), rand).slice(0, n);
        times.sort(function (x, y) {
            var toMin = function (v) { var p = v.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
            return toMin(x) - toMin(y);
        });

        var roomOf = [];
        var timeOf = [];
        var roomOrder = shuffle([0, 1, 2, 3, 4].slice(0, n), rand);
        var timeOrder = shuffle([0, 1, 2, 3, 4].slice(0, n), rand);
        for (var i = 0; i < n; i++) { roomOf[i] = roomOrder[i]; timeOf[i] = timeOrder[i]; }

        var culprit = Math.floor(rand() * n);
        var crimeRoom = roomOf[culprit];
        var crimeTime = timeOf[culprit];

        var ctx = {
            suspects: suspects,
            rooms: rooms,
            times: times,
            roomOf: roomOf,
            timeOf: timeOf
        };

        var pool = buildPool(ctx, roomOf, timeOf, rand, difficulty);
        var solutions = enumerateSolutions(n, [], 0);
        var chosen = [];
        var minClues = difficulty === 'easy' ? 7 : difficulty === 'normal' ? 9 : 11;

        // Prefer clue types the difficulty should teach: easy starts with
        // direct statements, hard avoids them until relations fail.
        for (var p = 0; p < pool.length && solutions.length > 1; p++) {
            var candidate = pool[p];
            if (difficulty === 'hard' && candidate.kind !== 'order' && candidate.kind !== 'either' &&
                candidate.kind !== 'roomTime' && p < pool.length / 2) {
                continue;
            }
            var next = [];
            for (var q = 0; q < solutions.length; q++) {
                if (clueTrue(candidate, solutions[q].roomOf, solutions[q].timeOf)) next.push(solutions[q]);
            }
            if (next.length < solutions.length) {
                chosen.push(candidate);
                solutions = next;
            }
        }

        // Fallback: if the pool/weighting did not make it unique, add the
        // direct facts for the culprit until it is. This is always solvable.
        if (solutions.length > 1) {
            var direct = [
                { kind: 'room', a: culprit, b: crimeRoom, neg: false },
                { kind: 'time', a: culprit, b: crimeTime, neg: false }
            ];
            for (var d = 0; d < direct.length && solutions.length > 1; d++) {
                chosen.push(direct[d]);
                solutions = solutions.filter(function (sol) {
                    return clueTrue(direct[d], sol.roomOf, sol.timeOf);
                });
            }
        }

        // Flavour: add one or two redundant true clues so the case file does
        // not feel minimal, without changing the solution.
        var flavour = 0;
        for (var f = 0; f < pool.length && chosen.length < minClues; f++) {
            if (chosen.indexOf(pool[f]) !== -1) continue;
            if (!clueTrue(pool[f], roomOf, timeOf)) continue;
            chosen.push(pool[f]);
            flavour++;
            if (flavour >= 2) break;
        }

        // Deduplicate by text, then number.
        var seen = {};
        var clues = [];
        for (var c = 0; c < chosen.length; c++) {
            var text = clueText(chosen[c], ctx);
            if (!text || seen[text]) continue;
            seen[text] = true;
            clues.push({
                id: 'c' + clues.length,
                kind: chosen[c].kind,
                a: chosen[c].a,
                b: chosen[c].b,
                c: chosen[c].c,
                neg: !!chosen[c].neg,
                before: chosen[c].before,
                key: clueKey(chosen[c]),
                args: clueArgs(chosen[c], ctx),
                text: text,
                sourceType: chosen[c].kind === 'roomTime' || chosen[c].kind === 'either'
                    ? 'room'
                    : (chosen[c].kind === 'order' ? 'suspect' : (chosen[c].kind === 'room' ? 'suspect' : 'suspect'))
            });
        }

        // Attach clues to suspects/rooms for the interview UI. Keep every
        // clue reachable: a clue that mentions a suspect is interviewed there;
        // room-time clues are searchable in that room.
        for (var ci = 0; ci < clues.length; ci++) {
            var cl = clues[ci];
            if (cl.kind === 'room' || cl.kind === 'time' || cl.kind === 'order') {
                cl.sourceType = 'suspect';
                cl.sourceId = suspects[cl.a].id;
            } else if (cl.kind === 'roomTime') {
                cl.sourceType = 'room';
                cl.sourceId = 'r' + cl.a;
            } else if (cl.kind === 'either') {
                cl.sourceType = 'suspect';
                cl.sourceId = suspects[cl.a].id;
            }
        }

        var victimCap = setting.victim.charAt(0).toUpperCase() + setting.victim.slice(1);
        var story = fill(setting.story, {
            place: setting.place,
            victim: setting.victim,
            Victim: victimCap,
            room: rooms[crimeRoom],
            time: times[crimeTime]
        });

        var suspectPublic = suspects.map(function (s) {
            return { id: s.id, name: s.name, role: s.role };
        });
        var roomPublic = rooms.map(function (r, idx) {
            return { id: 'r' + idx, name: r };
        });
        var timePublic = times.map(function (t, idx) {
            return { id: 't' + idx, label: t };
        });

        var caseData = {
            id: 'mystery-' + seed + '-' + difficulty,
            seed: seed,
            difficulty: difficulty,
            setting: setting.id,
            title: setting.title,
            story: story,
            victim: setting.victim,
            crimeRoom: rooms[crimeRoom],
            crimeTime: times[crimeTime],
            suspects: suspectPublic,
            rooms: roomPublic,
            times: timePublic,
            clues: clues,
            solution: { suspectId: suspects[culprit].id, roomId: 'r' + crimeRoom, timeId: 't' + crimeTime }
        };

        // Guard: never ship an ambiguous case. The fallback above should make
        // this unreachable, but a bad future clue type must fail loudly in
        // tests rather than silently confusing a player.
        var proof = enumerateSolutions(n, clues, 2);
        if (proof.length !== 1) {
            throw new Error('Case Files generated an ambiguous case (' + seed + '/' + difficulty + ')');
        }
        return caseData;
    }

    function checkAccusation(caseData, suspectId) {
        return !!(caseData && caseData.solution && caseData.solution.suspectId === suspectId);
    }

    function scoreCase(opts) {
        opts = opts || {};
        var elapsed = Math.max(0, Number(opts.elapsedMs) || 0);
        var hints = Math.max(0, Number(opts.hintsUsed) || 0);
        var wrong = Math.max(0, Number(opts.wrongAttempts) || 0);
        var score = 1000 - Math.floor(elapsed / 1000) * 2 - hints * 75 - wrong * 150;
        return Math.max(100, score);
    }

    function dailySeed(date) {
        var d = date || new Date();
        var y = d.getFullYear();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }

    return {
        SETTINGS: SETTINGS,
        generateCase: generateCase,
        solve: solve,
        checkAccusation: checkAccusation,
        scoreCase: scoreCase,
        dailySeed: dailySeed,
        _internals: {
            hashSeed: hashSeed,
            rngFrom: rngFrom,
            permutations: permutations,
            clueTrue: clueTrue,
            enumerateSolutions: enumerateSolutions
        }
    };
});
