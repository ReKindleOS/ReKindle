/**
 * Offline unit tests for the Akinator relay (akinator-service/).
 *
 * These never touch the network: they exercise the pure parsing helpers and the
 * handler's CORS / validation / rate-limit branches with fake req/res objects.
 * Run with `node scripts/test-akinator.js` (wired into `npm test`).
 */

const assert = require("assert");
const path = require("path");

const relay = require(path.join(__dirname, "..", "akinator-service", "akinator.js"));

const {
    akinatorHandler,
    ALLOWED_ORIGINS,
    AkinatorError,
    parseQuestion,
    parseAnswerLabels,
    parseAction,
    parseRegion,
    regionInfo,
    buildForm
} = relay;

let passed = 0;

function test(name, fn) {
    fn();
    passed++;
    console.log("  ok - " + name);
}

async function asyncTest(name, fn) {
    await fn();
    passed++;
    console.log("  ok - " + name);
}

function fakeRes() {
    return {
        headers: {},
        statusCode: 0,
        body: null,
        set: function (key, value) {
            this.headers[key] = value;
            return this;
        },
        status: function (code) {
            this.statusCode = code;
            return this;
        },
        send: function (body) {
            this.body = body;
            return this;
        },
        json: function (body) {
            this.body = body;
            return this;
        }
    };
}

function req(method, body, headers) {
    return {
        method: method,
        body: body,
        headers: headers || {},
        ip: "198.51.100.7"
    };
}

console.log("Akinator relay: parsing");

test("parseQuestion reads the question-label paragraph", function () {
    const html = '<p class="question-text" id="question-label">Is your character real?</p>';
    assert.strictEqual(parseQuestion(html), "Is your character real?");
});

test("parseQuestion handles attributes split over lines", function () {
    const html = '<p\n  id="question-label"\n  class="question-text">\n  Is it a girl?\n</p>';
    assert.strictEqual(parseQuestion(html), "Is it a girl?");
});

test("parseQuestion leaves HTML entities for the client to decode", function () {
    const html = '<p id="question-label">Don&#039;t know?</p>';
    assert.strictEqual(parseQuestion(html), "Don&#039;t know?");
});

test("parseQuestion cannot leave a tag behind", function () {
    // An unclosed "<script" survives a plain tag strip because there is no ">"
    // to match; escaping the leftover "<" is what makes the result inert.
    assert.strictEqual(parseQuestion('<p id="question-label"><script</p>'), "&lt;script");

    // Nested markup must not survive either.
    const nested = parseQuestion(
        '<p id="question-label"><<script>script>alert(1)<</script>/script></p>'
    );
    assert.ok(nested.indexOf("<") === -1, nested);

    // A lone "<" in real question text is escaped, not dropped, so the client's
    // decodeHtml() still displays it.
    assert.strictEqual(parseQuestion('<p id="question-label">is 5 < 6?</p>'), "is 5 &lt; 6?");
});

test("parseAnswerLabels reads all five ids in order", function () {
    const html =
        '<a id="a_yes">Yes</a>' +
        '<a id="a_no">No</a>' +
        '<a id="a_dont_know">Don&#039;t know</a>' +
        '<a id="a_probably">Probably</a>' +
        '<a id="a_probaly_not">Probably not</a>';
    assert.deepStrictEqual(parseAnswerLabels(html), [
        "Yes",
        "No",
        "Don&#039;t know",
        "Probably",
        "Probably not"
    ]);
});

test("parseAnswerLabels returns nulls for missing labels", function () {
    assert.deepStrictEqual(parseAnswerLabels("<html></html>"), [null, null, null, null, null]);
});

test("parseAction reads step/progression/question", function () {
    const out = parseAction(JSON.stringify({ step: "9", progression: "12.5", question: "Next?" }), {
        step: 1,
        progression: 0
    });
    assert.strictEqual(out.step, 9);
    assert.strictEqual(out.progression, 12.5);
    assert.strictEqual(out.question, "Next?");
    assert.strictEqual(out.guess, undefined);
});

test("parseAction falls back when step/progression are missing", function () {
    const out = parseAction(JSON.stringify({ question: "Q" }), { step: 4, progression: 30 });
    assert.strictEqual(out.step, 4);
    assert.strictEqual(out.progression, 30);
});

test("parseAction maps a guess, including no_question", function () {
    const out = parseAction(
        JSON.stringify({
            step: 9,
            progression: 87.5,
            id_proposition: 123,
            name_proposition: "Mario",
            description_proposition: "Plumber",
            photo: "https://en.akinator.com/photo.jpg",
            no_question: "1"
        }),
        { step: 1, progression: 0 }
    );
    assert.deepStrictEqual(out.guess, {
        id: "123",
        name: "Mario",
        description: "Plumber",
        photo: "https://en.akinator.com/photo.jpg",
        noQuestion: true
    });
});

test("parseAction treats completion KO as session_expired", function () {
    assert.throws(
        function () {
            parseAction('{"completion":"KO"}', { step: 1, progression: 0 });
        },
        function (e) {
            return e instanceof AkinatorError && e.code === "session_expired" && e.status === 409;
        }
    );
});

test("parseAction treats invalid JSON as session_expired", function () {
    assert.throws(
        function () {
            parseAction("<html>nope</html>", { step: 1, progression: 0 });
        },
        function (e) {
            return e.code === "session_expired";
        }
    );
});

test("parseRegion accepts known languages and themes", function () {
    assert.strictEqual(parseRegion("en"), "en");
    assert.strictEqual(parseRegion("en_objects"), "en_objects");
    assert.strictEqual(parseRegion("jp_animals"), "jp_animals");
});

test("parseRegion rejects unknown languages, themes and extra parts", function () {
    ["xx", "gr", "en_bad", "en_objects_extra"].forEach(function (region) {
        assert.throws(
            function () {
                parseRegion(region);
            },
            function (e) {
                return e.code === "bad_request" && e.status === 400;
            },
            region
        );
    });
});

test("regionInfo maps themes to Akinator sid", function () {
    assert.strictEqual(regionInfo("en").sid, 1);
    assert.strictEqual(regionInfo("en_objects").sid, 2);
    assert.strictEqual(regionInfo("en_animals").sid, 14);
    assert.strictEqual(regionInfo("de_objects").baseUrl, "https://de.akinator.com");
});

test("buildForm encodes values and skips null/undefined", function () {
    assert.strictEqual(
        buildForm({ answer: 0, session: "a b&c", empty: null, missing: undefined }),
        "answer=0&session=a%20b%26c"
    );
});

console.log("Akinator relay: HTTP handler");

async function runHandlerTests() {
    await asyncTest("OPTIONS returns 204 with the CORS allowlist", async function () {
        const res = fakeRes();
        await akinatorHandler(req("OPTIONS", {}, { origin: "https://rekindle.ink" }), res);
        assert.strictEqual(res.statusCode, 204);
        assert.strictEqual(res.headers["Access-Control-Allow-Origin"], "https://rekindle.ink");
        assert.strictEqual(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
        assert.strictEqual(res.headers["Access-Control-Max-Age"], "86400");
        assert.strictEqual(res.headers["Cache-Control"], "no-store");
    });

    await asyncTest("OPTIONS from an unknown origin falls back to the first origin", async function () {
        const res = fakeRes();
        await akinatorHandler(req("OPTIONS", {}, { origin: "https://evil.example" }), res);
        assert.strictEqual(res.headers["Access-Control-Allow-Origin"], ALLOWED_ORIGINS[0]);
    });

    await asyncTest("GET returns 405", async function () {
        const res = fakeRes();
        await akinatorHandler(req("GET", null, { origin: "https://rekindle.ink" }), res);
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(res.body.error, "method_not_allowed");
    });

    await asyncTest("unknown action returns 400", async function () {
        const res = fakeRes();
        await akinatorHandler(req("POST", { action: "nope" }, { origin: "https://rekindle.ink" }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.error, "bad_request");
    });

    await asyncTest("unsupported region is rejected before any upstream call", async function () {
        const res = fakeRes();
        await akinatorHandler(req("POST", { action: "start", region: "xx" }, { origin: "https://rekindle.ink" }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.error, "bad_request");
    });

    await asyncTest("invalid session is rejected before any upstream call", async function () {
        const res = fakeRes();
        await akinatorHandler(
            req("POST", { action: "answer", region: "en", session: "short" }, { origin: "https://rekindle.ink" }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.error, "bad_request");
    });

    await asyncTest("per-IP bucket rejects a burst with 429", async function () {
        const headers = { origin: "https://rekindle.ink", "x-forwarded-for": "203.0.113.99" };
        let saw429 = false;
        for (let i = 0; i < 130; i++) {
            const res = fakeRes();
            await akinatorHandler(req("POST", { action: "nope" }, headers), res);
            if (res.statusCode === 429) {
                assert.strictEqual(res.body.error, "rate_limited");
                saw429 = true;
                break;
            }
        }
        assert.strictEqual(saw429, true, "expected a 429 after the burst");
    });

    console.log("\n" + passed + " Akinator relay tests passed.");
}

runHandlerTests().catch(function (e) {
    console.error("\nAkinator relay test FAILED:", e && e.stack ? e.stack : e);
    process.exit(1);
});
