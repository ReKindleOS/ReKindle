/*
 * Language-detection entry point for js/lang-detect.js.
 *
 * Bundled by scripts/build-lang-detect.js with a subset of the Efficient
 * Language Detector (ELD) n-gram database (Apache-2.0, see
 * licenses/efficient-language-detector-LICENSE.txt).
 *
 * Why ELD and not a hand-written stopword list:
 *   Chat messages are short. A stopword heuristic reliably separates long
 *   paragraphs but confuses es/pt/fr/it on "podes enviar me o link" or
 *   "a que horas comeca". ELD's 4-byte n-gram model was within ~1 point of
 *   Lingua on the published sentence benchmark and is pure JavaScript, so it
 *   runs in the Kindle browser without WASM or a network call.
 *
 * Why only eight languages:
 *   The app's UI ships en, de, es, fr, it, pl, pt, ru, vi, zh. Russian, Chinese,
 *   Japanese and Korean are settled by Unicode script before ELD runs, so the
 *   bundled model only needs the eight Latin-script languages. That keeps the
 *   bundle at ~420 KB raw (~100 KB gzip) instead of ELD's 940 KB full XS set.
 *
 * Detection is intentionally not loaded on page load: see
 * js/post-language.js. Nothing here touches the network.
 */
import { createEld } from '../node_modules/eld/src/languageDetector.js';
import { ngramsData } from 'virtual:ngrams';

var eldParts = createEld();
var detector = eldParts.instance;
eldParts.loadData(ngramsData);

/* ------------------------------------------------------------------ */
/*  NORMALISATION                                                      */
/* ------------------------------------------------------------------ */

// ISO 639-1 base code. Handles pt-BR / zh-Hans / en_US and the two legacy
// codes browsers still emit.
function normalizeLang(code) {
    if (!code || typeof code !== 'string') return '';
    var base = code.toLowerCase().replace(/_/g, '-').split('-')[0];
    if (base === 'iw') return 'he';
    if (base === 'in') return 'id';
    if (base === 'nb' || base === 'nn') return 'no';
    return base;
}

function sameLanguage(a, b) {
    var left = normalizeLang(a);
    var right = normalizeLang(b);
    return !!left && left === right;
}

/* ------------------------------------------------------------------ */
/*  SCRIPT DETECTION                                                   */
/* ------------------------------------------------------------------ */

// Counts are taken over letters only. A word or two of another script inside
// an otherwise Latin message must not flip the answer.
var SCRIPT_RANGES = [
    { lang: 'ja', re: /[\u3040-\u30ff]/g },              // Hiragana + Katakana
    { lang: 'ko', re: /[\uac00-\ud7af\u1100-\u11ff]/g }, // Hangul
    { lang: 'zh', re: /[\u4e00-\u9fff]/g },              // Han
    { lang: 'ru', re: /[\u0400-\u04ff]/g },              // Cyrillic
    { lang: 'ar', re: /[\u0600-\u06ff]/g },
    { lang: 'he', re: /[\u0590-\u05ff]/g },
    { lang: 'el', re: /[\u0370-\u03ff]/g },
    { lang: 'th', re: /[\u0e00-\u0e7f]/g },
    { lang: 'hi', re: /[\u0900-\u097f]/g }
];
var LATIN_RE = /[A-Za-z\u00c0-\u024f]/g;

function countMatches(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
}

function scriptLanguage(text) {
    var latin = countMatches(text, LATIN_RE);
    var best = null;
    var bestCount = 0;
    for (var i = 0; i < SCRIPT_RANGES.length; i++) {
        var count = countMatches(text, SCRIPT_RANGES[i].re);
        if (count > bestCount) {
            bestCount = count;
            best = SCRIPT_RANGES[i].lang;
        }
    }
    if (!best || bestCount === 0) return '';
    // A single kana/hangul character is usually ASCII art (¯\_(ツ)_/¯), not a
    // language. Two or more is a real message.
    if ((best === 'ja' || best === 'ko') && bestCount < 2) return '';
    // Kana/hangul are unambiguous even in small amounts next to Han.
    if (best === 'ja' || best === 'ko') return best;
    // A single Han/Cyrillic/etc. character inside an English sentence is not a
    // language switch. The non-Latin script has to be at least as common as the
    // Latin one.
    if (latin > 0 && bestCount < latin) return '';
    return best;
}

/* ------------------------------------------------------------------ */
/*  CHAT LEXICON                                                       */
/* ------------------------------------------------------------------ */

// Deliberately folded (no accents) so unaccented typing still matches.
// Function words plus the greetings/thanks that dominate short chat lines.
var WORD_LISTS = {
    en: 'the and is are was were you your to of in for that have has not this with on but they them their what how can could do does did my me we he she it at be will would should there from or if about just very dont cant im ive thanks thank hello hi hey good please want know like going get got one all so no yes yeah lol okay ok see later today tonight sorry love hate people thing really much more some any because when where why who which then than too also well still only even never always again here now time make made take went come came say said tell told think thought feel felt look everyone somebody nobody anything something nothing everything favourite favorite movie book shop dog cat cute nice day morning night tomorrow yesterday maybe sure right wrong big small new old first last next another other same different every each both few many most own such home house work school friend friends family food water coffee beer money happy sad tired hungry funny weird cool awesome great bad better best',
    es: 'el la los las un una unos unas de del que y en es son era fue ser estar estoy estas esta estamos estan por para con sin muy pero como mas menos tambien cuando donde quien porque si no me te se nos os le les lo mi tu su mis tus sus yo ella nosotros usted ustedes ellos ellas tengo tienes tiene tenemos hay he has ha hemos han hola gracias buenos buenas dias noches gusto quiero quieres quiere saber hacer voy vas va vamos van aqui ahi alli ahora luego bien mal mucho poco todo nada algo alguien nadie siempre nunca tampoco aunque entonces pues ya todavia solo cosa cosas vida gente amigo amiga casa dia anos vez veces mundo trabajo tiempo comida deliciosa delicioso aprender ingles espanol frances libro pelicula perro gato bonito bonita guapo guapa nuevo viejo grande pequeno feliz triste cansado hambriento gracioso raro genial bueno buena mejor peor semana mes hoy manana ayer noche tarde comprar tienda escuela dinero agua cafe cerveza familia padres madre padre hijo hija hermano hermana empieza comienza hora horas ahora mismo acabo terminar leerlo deberiamos quedar pronto enviarme enlace sacaste funciono creer perdi mensaje eso suena gran idea',
    fr: 'le la les un une des du de que qui quoi et est sont etait etre ai as a avons avez ont je tu il elle on nous vous ils elles me te se mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs pour avec sans pas ne plus tres mais comme dans sur sous entre chez par au aux ce cette ces cet ca cela quand ou pourquoi comment parce car donc si oui non bien mal tout tous toutes rien quelque chose avoir faire dire aller voir savoir pouvoir vouloir venir prendre merci bonjour salut bonsoir bonne nuit jour journee matin soir aujourdhui demain hier maintenant aussi encore toujours jamais deja ici la voici voila beaucoup peu trop assez vraiment peutetre alors ensuite enfin bref mec gars fille manger boire dormir parler aimer detester adorer vouloir pouvoir devoir savoir connaitre apprendre anglais francais livre film chien chat mignon mignonne beau belle bon bonne meilleur pire nouvelle nouveau vieux grand petit heureux triste fatigue faim drole bizarre genial super semaine mois annee apresmidi acheter magasin ecole argent eau cafe biere famille parents mere pere fils frere soeur ami amie maison travail temps nourriture delicieux delicieuse peux envoyer lien veux jouer jeu quelle heure commence bientot soir ce',
    de: 'der die das den dem des ein eine einen einem einer eines und oder aber doch ist sind war waren sein bin bist habe hast hat haben hatte ich du er sie es wir ihr mich dich sich uns euch mein dein sein unser euer mit fur ohne gegen uber unter auf aus bei nach von zu im am an in nicht kein keine sehr mehr weniger auch nur noch schon so wie was wer wo wann warum weil dass wenn dann als man mal ja nein danke hallo guten morgen abend nacht tag heute gestern jetzt spater gut schlecht viel wenig alles nichts etwas immer nie wieder hier da dort bitte entschuldigung leider vielleicht wirklich suss lecker weiss weisst geht gehen gehe kommt kommen will willst mag magst muss kann kannst soll darf machen mache machst macht sagen sage sagst sagt sehen sehe siehst sieht essen esse isst trinken trinke trinkst trinkt schlafen lieben hasse mochte konnen mussen wissen lernen deutsch englisch buch film hund katze hubsch besser beste schlechter schlechteste glucklich traurig mude hungrig lustig komisch toll super woche monat jahr kaufen laden schule geld wasser kaffee bier familie eltern mutter vater sohn tochter bruder schwester freund freundin haus arbeit zeit',
    it: 'il lo la i gli le un uno una di del dello della dei degli delle che chi cosa e ed e sono era essere ho hai ha abbiamo avete hanno io tu lui lei noi voi loro mi ti ci vi si mio mia miei tuo tua suo sua nostro vostra per con senza su sotto tra fra da in a al alla ai alle non piu molto poco ma come quando dove perche se si no bene male tutto tutti niente qualcosa sempre mai ancora gia qui qua la li adesso ora oggi domani ieri dopo prima poi anche solo pero quindi allora ciao grazie buongiorno buonasera buonanotte salve scusa scusi prego amico amica ragazzo ragazza voglio vuoi vuole posso puoi puo devo deve so sai sa fare fatto dire detto andare vado vai va venire vengo vieni viene vedere vedo vedi vede mangiare bello bella buono buona migliore peggiore nuovo vecchio grande piccolo felice triste stanco affamato divertente strano fantastico settimana mese anno sera mattina pomeriggio comprare negozio scuola soldi acqua caffe birra famiglia genitori madre padre figlio figlia fratello sorella casa lavoro tempo cibo delizioso deliziosa inglese italiano libro film cane gatto carino carina dovremmo vederci presto appena finito leggerlo sembra buona idea scusa perso messaggio ora inizia credere',
    pt: 'o a os as um uma uns umas de do da dos das que quem e e sao era ser estar estou estas esta estamos estao tenho tens tem temos eu tu ele ela nos vos eles elas voce voces me te se lhe lhes meu minha meus minhas teu tua seu sua nosso nossa para por com sem sobre entre em no na nos nas ao aos nao mais menos muito pouco mas como quando onde porque se sim bem mal tudo todo toda nada algo alguem ninguem sempre nunca ainda ja aqui ai ali agora hoje amanha ontem depois antes entao tambem so apenas talvez realmente ola oi obrigado obrigada bom boa dia noite tarde tchau ate logo amigo amiga cara quero queres quer posso podes pode devo deve sei sabe saber fazer feito dizer dito ir vou vai vamos vir venho vem ver vejo ve gosto gosta gostei comer beber dormir falar amar odiar adorar aprender ingles portugues livro filme cachorro gato fofo bonito bonita lindo linda novo velho grande pequeno feliz triste cansado fome engracado estranho legal otimo semana mes ano manha comprar loja escola dinheiro agua cafe cerveja familia pais mae pai filho filha irmao irma casa trabalho tempo comida delicioso deliciosa comeca comecei comecou comecar horas podes podia deviamos encontrar acabei consigo acreditar enviar link estava estavas comido deliciosa desculpa perdi tua mensagem terminei ler',
    pl: 'i a ale lub albo czy ze zeby bo poniewaz wiec jednak tylko juz jeszcze tez takze bardzo malo duzo wiecej mniej wszystko nic cos ktos nikt zawsze nigdy teraz potem wczesniej pozniej dzis dzisiaj wczoraj jutro rano wieczor noc dzien dobry dobra dobre czesc hej witaj dzieki dziekuje przepraszam prosze tak nie moze chyba oczywiscie wlasnie tutaj tam gdzie kiedy jak dlaczego kto co ktory ktora ktore ja ty on ona ono my wy oni one mnie ciebie jego jej nas was ich moj moja moje twoj twoja twoje nasz nasza wasz wasza jest sa byl byla bylo byli byc jestem jestes jestesmy jestescie mam masz ma mamy macie maja miec chce chcesz chcemy chcecie chca chciec moge mozesz mozemy mozecie moga musze musisz musi musimy musicie musza wiem wiesz wie wiemy wiecie wiedza wiedziec robic robie robisz robi isc ide idziesz idzie przyjsc przyjde przyjdziesz przyjdzie widziec widze widzisz widzi jesc jem jesz je pic pije pijesz pijemy lubic lubie lubisz lubi zly zla zle piekny piekna piekne ladny ladna ladne smaczny smaczna smaczne pyszny pyszna pyszne sklep dom praca szkola czas ludzie osoba rzecz sprawa swiat zycie reka glowa oko rok raz sposob miejsce koniec poczatek pomoc problem pytanie odpowiedz rozmowa wiadomosc wiadomosci zdjecie film ksiazka muzyka jedzenie woda kawa piwo pieniadze rodzina matka ojciec syn corka brat siostra przyjaciel przyjaciolka szczesliwy smutny zmeczony glodny smieszny dziwny swietny super lepszy najlepszy gorszy najgorszy nowy stary duzy maly dobranoc zobaczenia sie powinnismy wkrotce spotkac ktorej zaczyna przegapilem wiadomosc skonczylem czytac swietny pomysl zagrac gre mozemy wyslac link',
    vi: 'va la cua co khong duoc trong mot nhung cac cho voi de nay do kia nao gi ai sao tai vi neu thi ma hoac cung rat qua lam hon nhat chi da dang se vua moi sap tung chua chang dau day ay toi minh ban anh chi em ong ba chung ta ho no nguoi cai con chiec viec dieu chuyen luc khi nay gio hom mai sang trua chieu dem ngay thang nam tuan nha truong cong hoc choi an uong ngu di den ve ra vao len xuong noi bao biet hieu thich yeu ghet muon can phai nen the xong roi nhe nha vang da cam on xin chao tam biet hen gap lai khoe vui buon tot xau dep hay gioi ngon dat re nhanh cham nhieu it to nho lon be cu dung sai that thuc su hoi kha cuc vo cung tieng viet tieng anh sach phim cho meo dep trai xinh gai cuoi tuan thang nam qua nay mai buoi gia dinh bo me cha con trai gai nha cua hang tien nuoc ca phe bia thuc an'
};

// Whole-message greetings/thanks. These are the cases ELD is weakest on
// ("merci" is scored as Italian; "hello" as Italian in the Medium model) and
// the cases a reader is most likely to see in a chat room.
var PHRASES = {
    'hello': 'en', 'hi': 'en', 'hey': 'en', 'thanks': 'en', 'thank you': 'en',
    'good morning': 'en', 'good night': 'en', 'how are you': 'en', 'whats up': 'en',
    'see you': 'en', 'i love you': 'en',
    'hola': 'es', 'gracias': 'es', 'buenos dias': 'es', 'buenas noches': 'es',
    'como estas': 'es', 'que tal': 'es', 'te quiero': 'es',
    'hasta luego': 'es', 'adios': 'es', 'no se': 'es',
    'bonjour': 'fr', 'salut': 'fr', 'merci': 'fr', 'bonsoir': 'fr',
    'bonne nuit': 'fr', 'comment ca va': 'fr', 'ca va': 'fr', 'au revoir': 'fr',
    'a bientot': 'fr', 'je taime': 'fr', 'sil vous plait': 'fr',
    'hallo': 'de', 'danke': 'de', 'bitte': 'de', 'guten morgen': 'de',
    'guten abend': 'de', 'gute nacht': 'de', 'wie gehts': 'de', 'tschuss': 'de',
    'auf wiedersehen': 'de', 'ich liebe dich': 'de',
    'ciao': 'it', 'grazie': 'it', 'buongiorno': 'it', 'buonasera': 'it',
    'buonanotte': 'it', 'per favore': 'it', 'come stai': 'it', 'ti amo': 'it',
    'arrivederci': 'it', 'a presto': 'it',
    'ola': 'pt', 'oi': 'pt', 'obrigado': 'pt', 'obrigada': 'pt',
    'bom dia': 'pt', 'boa noite': 'pt', 'tudo bem': 'pt', 'eu te amo': 'pt',
    'ate logo': 'pt',
    'czesc': 'pl', 'hej': 'pl', 'dzien dobry': 'pl', 'dziekuje': 'pl',
    'dzieki': 'pl', 'prosze': 'pl', 'dobranoc': 'pl', 'jak sie masz': 'pl',
    'kocham cie': 'pl', 'do zobaczenia': 'pl',
    'chao': 'vi', 'xin chao': 'vi', 'cam on': 'vi', 'cám ơn': 'vi',
    'tam biet': 'vi', 'hen gap lai': 'vi', 'chuc ngu ngon': 'vi'
};

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function fold(text) {
    var s = String(text).toLowerCase();
    s = s.replace(/\u0142/g, 'l').replace(/\u0111/g, 'd').replace(/\u00df/g, 'ss')
        .replace(/\u00f8/g, 'o').replace(/\u00e6/g, 'ae').replace(/\u0153/g, 'oe');
    if (s.normalize) {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return s;
}

function cleanText(text) {
    var s = String(text === null || text === undefined ? '' : text);
    s = s.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
    s = s.replace(/[A-Za-z0-9.!#$%&'\u2019+_`-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,64}/g, ' ');
    s = s.replace(/@[A-Za-z0-9_.-]+/g, ' '); // @mentions are usernames, not text
    s = s.replace(/\s+/g, ' ').trim();
    return s.substring(0, 1000);
}

function phraseKey(text) {
    return fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// A phrase only counts when it is the whole message, and the first language in
// insertion order wins.
var PHRASE_LOOKUP = {};
for (var phrase in PHRASES) {
    if (Object.prototype.hasOwnProperty.call(PHRASES, phrase)) {
        PHRASE_LOOKUP[phraseKey(phrase)] = PHRASES[phrase];
    }
}

var WORD_WEIGHTS = {};
(function buildWordWeights() {
    var sets = {};
    var lang, i, words, list;
    for (lang in WORD_LISTS) {
        if (!Object.prototype.hasOwnProperty.call(WORD_LISTS, lang)) continue;
        words = WORD_LISTS[lang].split(/\s+/);
        list = {};
        for (i = 0; i < words.length; i++) {
            if (words[i].length > 1) list[words[i]] = true;
        }
        sets[lang] = list;
    }
    var counts = {};
    for (lang in sets) {
        if (!Object.prototype.hasOwnProperty.call(sets, lang)) continue;
        for (var word in sets[lang]) {
            if (Object.prototype.hasOwnProperty.call(sets[lang], word)) {
                counts[word] = (counts[word] || 0) + 1;
            }
        }
    }
    for (lang in sets) {
        if (!Object.prototype.hasOwnProperty.call(sets, lang)) continue;
        var weights = {};
        for (var w in sets[lang]) {
            if (Object.prototype.hasOwnProperty.call(sets[lang], w)) {
                weights[w] = (counts[w] > 1 ? 0.35 : 1) + Math.min(w.length, 10) / 20;
            }
        }
        WORD_WEIGHTS[lang] = weights;
    }
})();

var CHAR_HINTS = {
    es: ['\u00f1', '\u00bf', '\u00a1'],
    de: ['\u00df'],
    fr: ['\u0153', '\u00e7', '\u00ea', '\u00e2', '\u00ee', '\u00f4', '\u00fb', '\u00eb', '\u00ef'],
    pt: ['\u00e3', '\u00f5', '\u00e7', '\u00e2', '\u00ea', '\u00f4', '\u00e0'],
    pl: ['\u0105', '\u0107', '\u0119', '\u0142', '\u0144', '\u00f3', '\u015b', '\u017a', '\u017c'],
    vi: ['\u01a1', '\u01b0', '\u1ea1', '\u1ea3', '\u1ea5', '\u1ea7', '\u1ea9', '\u1eab', '\u1ead', '\u0111', '\u1eb9', '\u1ebb', '\u1ebd', '\u1ebf', '\u1ec1', '\u1ec3', '\u1ec5', '\u1ec7', '\u1ec9', '\u1ecb', '\u1ecd', '\u1ecf', '\u1ed1', '\u1ed3', '\u1ed5', '\u1ed7', '\u1ed9', '\u1edb', '\u1edd', '\u1edf', '\u1ee1', '\u1ee3', '\u1ee5', '\u1ee7', '\u1ee9', '\u1eeb', '\u1eed', '\u1eef', '\u1ef1', '\u1ef3', '\u1ef5', '\u1ef7', '\u1ef9'],
    it: ['\u00ec', '\u00f2', '\u00f9']
};

function lexiconScore(text) {
    var folded = fold(text);
    var rawLower = String(text).toLowerCase();
    var tokens = folded.split(/[^a-z0-9]+/);
    var scores = {};
    var best = '';
    var bestScore = 0;
    var secondScore = 0;
    var lang, i, token, score, hints;
    for (lang in WORD_WEIGHTS) {
        if (!Object.prototype.hasOwnProperty.call(WORD_WEIGHTS, lang)) continue;
        score = 0;
        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (token && WORD_WEIGHTS[lang][token]) score += WORD_WEIGHTS[lang][token];
        }
        hints = CHAR_HINTS[lang] || [];
        for (i = 0; i < hints.length; i++) {
            if (rawLower.indexOf(hints[i]) !== -1) score += 2;
        }
        scores[lang] = score;
        if (score > bestScore) {
            secondScore = bestScore;
            bestScore = score;
            best = lang;
        } else if (score > secondScore) {
            secondScore = score;
        }
    }
    return { lang: best, score: bestScore, margin: bestScore - secondScore };
}

/* ------------------------------------------------------------------ */
/*  PUBLIC API                                                         */
/* ------------------------------------------------------------------ */

function detect(text) {
    var body = cleanText(text);
    if (!body || !/[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(body)) {
        return { lang: '', reliable: false, source: 'none' };
    }

    var script = scriptLanguage(body);
    if (script) return { lang: script, reliable: true, source: 'script' };

    // One Latin letter ("k", "a") or punctuation-only ASCII art carries no
    // usable signal; returning a guess would add a wrong Translate direction.
    if (countMatches(body, LATIN_RE) < 2) return { lang: '', reliable: false, source: 'none' };

    var key = phraseKey(body);
    if (key && PHRASE_LOOKUP[key]) {
        return { lang: PHRASE_LOOKUP[key], reliable: true, source: 'phrase' };
    }

    var eldLang = '';
    var eldReliable = false;
    try {
        var result = detector.detect(body);
        eldLang = normalizeLang(result.language);
        eldReliable = !!(result.isReliable && result.isReliable());
    } catch (e) {
        // A broken/absent model must never break posting; fall through to the
        // word list below.
        eldLang = '';
        eldReliable = false;
    }

    var lex = lexiconScore(body);
    var shortText = body.length <= 48;

    if (lex.lang && lex.score > 0 && (shortText || !eldReliable)) {
        var minScore = eldReliable ? 2.2 : 1.0;
        var minMargin = eldReliable ? 1.0 : 0.4;
        if (lex.score >= minScore && lex.margin >= minMargin) {
            return { lang: lex.lang, reliable: true, source: 'lexicon' };
        }
    }

    if (eldLang) {
        return { lang: eldLang, reliable: eldReliable, source: 'eld' };
    }
    if (lex.lang && lex.score >= 1.5 && lex.margin >= 0.5) {
        return { lang: lex.lang, reliable: false, source: 'lexicon-weak' };
    }
    return { lang: '', reliable: false, source: 'none' };
}

function detectLang(text) {
    return detect(text).lang;
}

window.rekindleLangDetect = {
    detect: detect,
    detectLang: detectLang,
    normalize: normalizeLang,
    sameLanguage: sameLanguage,
    // Exposed for tests and diagnostics only.
    _phraseKey: phraseKey,
    _lexiconScore: lexiconScore,
    _eldDetect: function (text) { var r = detector.detect(String(text)); return { language: r.language, reliable: r.isReliable(), scores: r.getScores() }; },
    _version: '1'
};
