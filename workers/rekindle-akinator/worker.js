export default {
    async fetch(request, env) {
        const ALLOWED_ORIGINS = [
            "https://rekindle.ink",
            "https://lite.rekindle.ink",
            "https://legacy.rekindle.ink",
            "https://beta.rekindle.ink",
            "http://localhost:8788",
            "http://localhost:3000"
        ];

        const origin = request.headers.get("Origin");
        const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowed && origin ? origin : "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        function errorResponse(message, status) {
            return new Response(JSON.stringify({ error: message }), {
                status: status,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        let body = {};
        if (request.method === "POST") {
            try {
                body = await request.json();
            } catch (e) {
                return errorResponse("Invalid JSON body", 400);
            }
        }

        const region = body.region || "en";
        const childMode = body.childMode === true;

        const lang = region.split("_")[0];
        const theme = region.split("_")[1];
        const baseUrl = "https://" + lang + ".akinator.com";

        let sid = 1;
        if (theme === "objects") sid = 2;
        else if (theme === "animals") sid = 14;

        const akiHeaders = new Headers();
        akiHeaders.set("Content-Type", "application/x-www-form-urlencoded");
        akiHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        akiHeaders.set("X-Requested-With", "XMLHttpRequest");
        akiHeaders.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");

        try {
            if (path === "/" || path === "") {
                return new Response(JSON.stringify({
                    ok: true,
                    version: "1.1.0",
                    deployed: true,
                    path: path,
                    time: new Date().toISOString()
                }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (path.endsWith("/debug-start")) {
                const startBody = "cm=" + (childMode ? "true" : "false") + "&sid=" + sid;
                const res = await fetch(baseUrl + "/game", {
                    method: "POST",
                    headers: akiHeaders,
                    body: startBody
                });
                const html = await res.text();
                return new Response(JSON.stringify({
                    status: res.status,
                    length: html.length,
                    html: html
                }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (path.endsWith("/start")) {
                const startBody = "cm=" + (childMode ? "true" : "false") + "&sid=" + sid;
                const res = await fetch(baseUrl + "/game", {
                    method: "POST",
                    headers: akiHeaders,
                    body: startBody
                });

                if (!res.ok) {
                    return errorResponse("Akinator returned " + res.status + " while starting game", 502);
                }

                const html = await res.text();
                const session = extractFirst(html, [
                    /session:\s*'([^']+)'/,
                    /session\s*[:=]\s*"([^"]+)"/,
                    /uid_ext_session\s*=\s*'([^']+)'/,
                    /id=["']session["'][^>]*value=["']([^"']+)["']/i,
                    /value=["']([^"']+)["'][^>]*id=["']session["']/i
                ]);
                const signature = extractFirst(html, [
                    /signature:\s*'([^']+)'/,
                    /signature\s*[:=]\s*"([^"]+)"/,
                    /id=["']signature["'][^>]*value=["']([^"']+)["']/i,
                    /value=["']([^"']+)["'][^>]*id=["']signature["']/i
                ]);
                const question = extractFirst(html, [
                    /<p[^>]*class=["'][^"']*question-text[^"']*["'][^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\/p>/i,
                    /<[^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\//i
                ]);

                if (!session || !signature || !question) {
                    return errorResponse("Could not parse Akinator session. The site may be using bot protection.", 502);
                }

                const answers = parseAnswerLabels(html);

                return new Response(JSON.stringify({
                    session: session,
                    signature: signature,
                    question: question.trim(),
                    baseUrl: baseUrl,
                    sid: sid,
                    region: region,
                    answers: answers
                }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (path.endsWith("/answer")) {
                if (typeof body.step === "undefined" || typeof body.progression === "undefined" || typeof body.answer === "undefined" || !body.session || !body.signature) {
                    return errorResponse("Missing required answer parameters", 400);
                }

                const answerBody = buildForm({
                    step: body.step,
                    progression: body.progression,
                    sid: sid,
                    cm: childMode ? "true" : "false",
                    answer: body.answer,
                    step_last_proposition: body.stepLast || "",
                    session: body.session,
                    signature: body.signature
                });

                const res = await fetch(baseUrl + "/answer", {
                    method: "POST",
                    headers: akiHeaders,
                    body: answerBody
                });

                if (!res.ok) {
                    return errorResponse("Akinator returned " + res.status + " while answering", 502);
                }

                const text = await res.text();
                return new Response(text, { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (path.endsWith("/back")) {
                if (typeof body.step === "undefined" || typeof body.progression === "undefined" || !body.session || !body.signature) {
                    return errorResponse("Missing required back parameters", 400);
                }

                const backBody = buildForm({
                    step: body.step,
                    progression: body.progression,
                    sid: sid,
                    cm: childMode ? "true" : "false",
                    session: body.session,
                    signature: body.signature
                });

                const res = await fetch(baseUrl + "/cancel_answer", {
                    method: "POST",
                    headers: akiHeaders,
                    body: backBody
                });

                if (!res.ok) {
                    return errorResponse("Akinator returned " + res.status + " while going back", 502);
                }

                const text = await res.text();
                return new Response(text, { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            if (path.endsWith("/continue")) {
                if (typeof body.step === "undefined" || typeof body.progression === "undefined" || !body.session || !body.signature) {
                    return errorResponse("Missing required continue parameters", 400);
                }

                const continueBody = buildForm({
                    step: body.step,
                    progression: body.progression,
                    sid: sid,
                    cm: childMode ? "true" : "false",
                    session: body.session,
                    signature: body.signature,
                    step_last_proposition: body.stepLast || ""
                });

                const res = await fetch(baseUrl + "/exclude", {
                    method: "POST",
                    headers: akiHeaders,
                    body: continueBody
                });

                if (!res.ok) {
                    return errorResponse("Akinator returned " + res.status + " while continuing", 502);
                }

                const text = await res.text();
                return new Response(text, { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }

            return errorResponse("Unknown action. Use /start, /answer, /back, or /continue.", 404);
        } catch (e) {
            console.error("Akinator worker error:", e);
            return errorResponse(e.message || "Internal worker error", 500);
        }
    }
};

function extractFirst(text, patterns) {
    let best = null;
    for (let i = 0; i < patterns.length; i++) {
        const regex = new RegExp(patterns[i].source, patterns[i].flags.includes("g") ? patterns[i].flags : patterns[i].flags + "g");
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match[1] && (!best || match[1].length > best.length)) {
                best = match[1];
            }
            if (match.index === regex.lastIndex) regex.lastIndex++;
        }
    }
    return best;
}

function parseAnswerLabels(html) {
    const ids = ["a_yes", "a_no", "a_dont_know", "a_probably", "a_probaly_not"];
    const answers = [];
    for (let i = 0; i < ids.length; i++) {
        const regex = new RegExp("<a[^>]*id=[\"']" + ids[i] + "[\"'][^>]*>([\\s\\S]*?)<\\/a>", "i");
        const match = html.match(regex);
        let label = match && match[1] ? match[1].replace(/<[^>]*>/g, "").trim() : null;
        answers.push(label || null);
    }
    return answers;
}

function buildForm(params) {
    const parts = [];
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    }
    return parts.join("&");
}
