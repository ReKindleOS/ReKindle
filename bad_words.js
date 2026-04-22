(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __commonJS = (cb, mod2) => function __require() {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
    mod2
  ));
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/obscenity/dist/util/Char.js
  var require_Char = __commonJS({
    "node_modules/obscenity/dist/util/Char.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.isHighSurrogate = isHighSurrogate;
      exports.isLowSurrogate = isLowSurrogate;
      exports.convertSurrogatePairToCodePoint = convertSurrogatePairToCodePoint;
      exports.isWordChar = isWordChar;
      exports.isDigit = isDigit;
      exports.isAlphabetic = isAlphabetic;
      exports.isLowerCase = isLowerCase;
      exports.isUpperCase = isUpperCase;
      exports.invertCaseOfAlphabeticChar = invertCaseOfAlphabeticChar;
      exports.getAndAssertSingleCodePoint = getAndAssertSingleCodePoint;
      function isHighSurrogate(char) {
        return 55296 <= char && char <= 56319;
      }
      function isLowSurrogate(char) {
        return 56320 <= char && char <= 57343;
      }
      function convertSurrogatePairToCodePoint(highSurrogate, lowSurrogate) {
        return (highSurrogate - 55296) * 1024 + lowSurrogate - 56320 + 65536;
      }
      function isWordChar(char) {
        return isDigit(char) || isAlphabetic(char);
      }
      function isDigit(char) {
        return 48 <= char && char <= 57;
      }
      function isAlphabetic(char) {
        return isLowerCase(char) || isUpperCase(char);
      }
      function isLowerCase(char) {
        return 97 <= char && char <= 122;
      }
      function isUpperCase(char) {
        return 65 <= char && char <= 90;
      }
      function invertCaseOfAlphabeticChar(char) {
        return char ^ 32;
      }
      function getAndAssertSingleCodePoint(str) {
        if ([...str].length !== 1)
          throw new RangeError(`Expected the input string to be one code point in length.`);
        return str.codePointAt(0);
      }
    }
  });

  // node_modules/obscenity/dist/censor/BuiltinStrategies.js
  var require_BuiltinStrategies = __commonJS({
    "node_modules/obscenity/dist/censor/BuiltinStrategies.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.keepStartCensorStrategy = keepStartCensorStrategy2;
      exports.keepEndCensorStrategy = keepEndCensorStrategy2;
      exports.asteriskCensorStrategy = asteriskCensorStrategy2;
      exports.grawlixCensorStrategy = grawlixCensorStrategy2;
      exports.fixedPhraseCensorStrategy = fixedPhraseCensorStrategy2;
      exports.fixedCharCensorStrategy = fixedCharCensorStrategy2;
      exports.randomCharFromSetCensorStrategy = randomCharFromSetCensorStrategy2;
      var Char_1 = require_Char();
      function keepStartCensorStrategy2(baseStrategy) {
        return (ctx) => {
          if (ctx.overlapsAtStart)
            return baseStrategy(ctx);
          const firstChar = String.fromCodePoint(ctx.input.codePointAt(ctx.startIndex));
          return firstChar + baseStrategy({ ...ctx, matchLength: ctx.matchLength - 1 });
        };
      }
      function keepEndCensorStrategy2(baseStrategy) {
        return (ctx) => {
          if (ctx.overlapsAtEnd)
            return baseStrategy(ctx);
          const lastChar = String.fromCodePoint(ctx.input.codePointAt(ctx.endIndex));
          return baseStrategy({ ...ctx, matchLength: ctx.matchLength - 1 }) + lastChar;
        };
      }
      function asteriskCensorStrategy2() {
        return fixedCharCensorStrategy2("*");
      }
      function grawlixCensorStrategy2() {
        return randomCharFromSetCensorStrategy2("%@$&*");
      }
      function fixedPhraseCensorStrategy2(phrase) {
        return () => phrase;
      }
      function fixedCharCensorStrategy2(char) {
        (0, Char_1.getAndAssertSingleCodePoint)(char);
        return (ctx) => char.repeat(ctx.matchLength);
      }
      function randomCharFromSetCensorStrategy2(charset) {
        const chars = [...charset];
        if (chars.length < 2)
          throw new Error("The character set passed must have at least 2 characters.");
        return (ctx) => {
          if (ctx.matchLength === 0)
            return "";
          let lastIdx = Math.floor(Math.random() * chars.length);
          let censored = chars[lastIdx];
          for (let i = 1; i < ctx.matchLength; i++) {
            let idx = Math.floor(Math.random() * (chars.length - 1));
            if (idx >= lastIdx)
              idx++;
            lastIdx = idx;
            censored += chars[idx];
          }
          return censored;
        };
      }
    }
  });

  // node_modules/obscenity/dist/util/Interval.js
  var require_Interval = __commonJS({
    "node_modules/obscenity/dist/util/Interval.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.compareIntervals = compareIntervals;
      function compareIntervals(lowerBound0, upperBound0, lowerBound1, upperBound1) {
        if (lowerBound0 < lowerBound1)
          return -1;
        if (lowerBound1 < lowerBound0)
          return 1;
        if (upperBound0 < upperBound1)
          return -1;
        if (upperBound1 < upperBound0)
          return 1;
        return 0;
      }
    }
  });

  // node_modules/obscenity/dist/matcher/MatchPayload.js
  var require_MatchPayload = __commonJS({
    "node_modules/obscenity/dist/matcher/MatchPayload.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.compareMatchByPositionAndId = compareMatchByPositionAndId2;
      var Interval_1 = require_Interval();
      function compareMatchByPositionAndId2(a, b) {
        const result = (0, Interval_1.compareIntervals)(a.startIndex, a.endIndex, b.startIndex, b.endIndex);
        if (result !== 0)
          return result;
        return a.termId === b.termId ? 0 : a.termId < b.termId ? -1 : 1;
      }
    }
  });

  // node_modules/obscenity/dist/censor/TextCensor.js
  var require_TextCensor = __commonJS({
    "node_modules/obscenity/dist/censor/TextCensor.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.TextCensor = void 0;
      var MatchPayload_1 = require_MatchPayload();
      var BuiltinStrategies_1 = require_BuiltinStrategies();
      var TextCensor2 = class {
        constructor() {
          __publicField(this, "strategy", (0, BuiltinStrategies_1.grawlixCensorStrategy)());
        }
        /**
         * Sets the censoring strategy, which is responsible for generating
         * replacement text for regions of the text that should be censored.
         *
         * The default censoring strategy is the [[grawlixCensorStrategy]],
         * generating text like `$%@*`. There are several other built-in strategies
         * available:
         * - [[keepStartCensorStrategy]] - extends another strategy and keeps the
         *   first character matched, e.g. `f***`.
         * - [[keepEndCensorStrategy]] - extends another strategy and keeps the last
         *   character matched, e.g. `***k`.
         * - [[asteriskCensorStrategy]] - replaces the text with asterisks, e.g.
         *   `****`.
         * - [[grawlixCensorStrategy]] - the default strategy, discussed earlier.
         *
         * Note that since censoring strategies are just functions (see the
         * documentation for [[TextCensorStrategy]]), it is relatively simple to
         * create your own.
         *
         * To ease creation of common censoring strategies, we provide a number of
         * utility functions:
         * - [[fixedPhraseCensorStrategy]] - generates a fixed phrase, e.g. `fudge`.
         * - [[fixedCharCensorStrategy]] - generates replacement strings constructed
         *   from the character given, repeated as many times as needed.
         * - [[randomCharFromSetCensorStrategy]] - generates replacement strings
         *   made up of random characters from the set of characters provided.
         *
         * @param strategy - Text censoring strategy to use.
         */
        setStrategy(strategy) {
          this.strategy = strategy;
          return this;
        }
        /**
         * Applies the censoring strategy to the text, returning the censored text.
         *
         * **Overlapping regions**
         *
         * Overlapping regions are an annoying edge case to deal with when censoring
         * text. There is no single best way to handle them, but the implementation
         * of this method guarantees that overlapping regions will always be
         * replaced, following the rules below:
         *
         * - Replacement text for matched regions will be generated in the order
         *   specified by [[compareMatchByPositionAndId]];
         * - When generating replacements for regions that overlap at the start with
         *   some other region, the start index of the censor context passed to the
         *   censoring strategy will be the end index of the first region, plus one.
         *
         * @param input - Input text.
         * @param matches - A list of matches.
         * @returns The censored text.
         */
        applyTo(input, matches) {
          if (matches.length === 0)
            return input;
          const sorted = [...matches].sort(MatchPayload_1.compareMatchByPositionAndId);
          let censored = "";
          let lastIndex = 0;
          for (let i = 0; i < sorted.length; i++) {
            const match = sorted[i];
            if (lastIndex > match.endIndex)
              continue;
            const overlapsAtStart = match.startIndex < lastIndex;
            if (!overlapsAtStart)
              censored += input.slice(lastIndex, match.startIndex);
            const actualStartIndex = Math.max(lastIndex, match.startIndex);
            const overlapsAtEnd = i < sorted.length - 1 && // not the last match
            match.endIndex >= sorted[i + 1].startIndex && // end index of this match and start index of next one overlap
            match.endIndex < sorted[i + 1].endIndex;
            censored += this.strategy({ ...match, startIndex: actualStartIndex, input, overlapsAtStart, overlapsAtEnd });
            lastIndex = match.endIndex + 1;
          }
          censored += input.slice(lastIndex);
          return censored;
        }
      };
      exports.TextCensor = TextCensor2;
    }
  });

  // node_modules/obscenity/dist/matcher/BlacklistedTerm.js
  var require_BlacklistedTerm = __commonJS({
    "node_modules/obscenity/dist/matcher/BlacklistedTerm.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.assignIncrementingIds = assignIncrementingIds2;
      function assignIncrementingIds2(patterns) {
        let currentId = 0;
        return patterns.map((pattern2) => ({ id: currentId++, pattern: pattern2 }));
      }
    }
  });

  // node_modules/obscenity/dist/dataset/DataSet.js
  var require_DataSet = __commonJS({
    "node_modules/obscenity/dist/dataset/DataSet.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.PhraseBuilder = exports.DataSet = void 0;
      var BlacklistedTerm_1 = require_BlacklistedTerm();
      var DataSet2 = class {
        constructor() {
          __publicField(this, "containers", []);
          __publicField(this, "patternCount", 0);
          __publicField(this, "patternIdToPhraseContainer", /* @__PURE__ */ new Map());
        }
        // pattern ID => index of its container
        /**
         * Adds all the phrases from the dataset provided to this one.
         *
         * @example
         * ```typescript
         * const customDataset = new DataSet().addAll(englishDataset);
         * ```
         * @param other - Other dataset.
         */
        addAll(other) {
          for (const container of other.containers)
            this.registerContainer(container);
          return this;
        }
        /**
         * Removes phrases that match the predicate given.
         *
         * @example
         * ```typescript
         * const customDataset = new DataSet<{ originalWord: string }>()
         * 	.addAll(englishDataset)
         * 	.removePhrasesIf((phrase) => phrase.metadata.originalWord === 'fuck');
         * ```
         * @param predicate - A predicate that determines whether or not a phrase should be removed.
         * Return `true` to remove, `false` to keep.
         */
        removePhrasesIf(predicate) {
          this.patternCount = 0;
          this.patternIdToPhraseContainer.clear();
          const containers = this.containers.splice(0);
          for (const container of containers) {
            const remove = predicate(container);
            if (!remove)
              this.registerContainer(container);
          }
          return this;
        }
        /**
         * Adds a phrase to this dataset.
         *
         * @example
         * ```typescript
         * const data = new DataSet<{ originalWord: string }>()
         * 	.addPhrase((phrase) => phrase.setMetadata({ originalWord: 'fuck' })
         * 		.addPattern(pattern`fuck`)
         * 		.addPattern(pattern`f[?]ck`)
         * 		.addWhitelistedTerm('Afck'))
         * 	.build();
         * ```
         * @param fn - A function that takes a [[PhraseBuilder]], adds
         * patterns/whitelisted terms/metadata to it, and returns it.
         */
        addPhrase(fn) {
          const container = fn(new PhraseBuilder2()).build();
          this.registerContainer(container);
          return this;
        }
        /**
         * Retrieves the phrase metadata associated with a pattern and returns a
         * copy of the match payload with said metadata attached to it.
         *
         * @example
         * ```typescript
         * const matches = matcher.getAllMatches(input);
         * const matchesWithPhraseMetadata = matches.map((match) => dataset.getPayloadWithPhraseMetadata(match));
         * // Now we can access the 'phraseMetadata' property:
         * const phraseMetadata = matchesWithPhraseMetadata[0].phraseMetadata;
         * ```
         * @param payload - Original match payload.
         */
        getPayloadWithPhraseMetadata(payload) {
          const offset = this.patternIdToPhraseContainer.get(payload.termId);
          if (offset === void 0) {
            throw new Error(`The pattern with ID ${payload.termId} does not exist in this dataset.`);
          }
          return {
            ...payload,
            phraseMetadata: this.containers[offset].metadata
          };
        }
        /**
         * Returns the dataset in a format suitable for usage with the [[RegExpMatcher]].
         *
         * @example
         * ```typescript
         * // With the RegExpMatcher:
         * const matcher = new RegExpMatcher({
         * 	...dataset.build(),
         * 	// additional options here
         * });
         * ```
         */
        build() {
          return {
            blacklistedTerms: (0, BlacklistedTerm_1.assignIncrementingIds)(this.containers.flatMap((p) => p.patterns)),
            whitelistedTerms: this.containers.flatMap((p) => p.whitelistedTerms)
          };
        }
        registerContainer(container) {
          const offset = this.containers.push(container) - 1;
          for (let i = 0, phraseId = this.patternCount; i < container.patterns.length; i++, phraseId++) {
            this.patternIdToPhraseContainer.set(phraseId, offset);
            this.patternCount++;
          }
        }
      };
      exports.DataSet = DataSet2;
      var PhraseBuilder2 = class {
        constructor() {
          __publicField(this, "patterns", []);
          __publicField(this, "whitelistedTerms", []);
          __publicField(this, "metadata");
        }
        /**
         * Associates a pattern with this phrase.
         *
         * @param pattern - Pattern to add.
         */
        addPattern(pattern2) {
          this.patterns.push(pattern2);
          return this;
        }
        /**
         * Associates a whitelisted pattern with this phrase.
         *
         * @param term - Whitelisted term to add.
         */
        addWhitelistedTerm(term) {
          this.whitelistedTerms.push(term);
          return this;
        }
        /**
         * Associates some metadata with this phrase.
         *
         * @param metadata - Metadata to use.
         */
        setMetadata(metadata) {
          this.metadata = metadata;
          return this;
        }
        /**
         * Builds the phrase, returning a [[PhraseContainer]] for use with the
         * [[DataSet]].
         */
        build() {
          return {
            patterns: this.patterns,
            whitelistedTerms: this.whitelistedTerms,
            metadata: this.metadata
          };
        }
      };
      exports.PhraseBuilder = PhraseBuilder2;
    }
  });

  // node_modules/obscenity/dist/matcher/Matcher.js
  var require_Matcher = __commonJS({
    "node_modules/obscenity/dist/matcher/Matcher.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
    }
  });

  // node_modules/obscenity/dist/pattern/Nodes.js
  var require_Nodes = __commonJS({
    "node_modules/obscenity/dist/pattern/Nodes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.SyntaxKind = void 0;
      var SyntaxKind2;
      (function(SyntaxKind3) {
        SyntaxKind3[SyntaxKind3["Optional"] = 0] = "Optional";
        SyntaxKind3[SyntaxKind3["Wildcard"] = 1] = "Wildcard";
        SyntaxKind3[SyntaxKind3["Literal"] = 2] = "Literal";
        SyntaxKind3[SyntaxKind3["BoundaryAssertion"] = 3] = "BoundaryAssertion";
      })(SyntaxKind2 || (exports.SyntaxKind = SyntaxKind2 = {}));
    }
  });

  // node_modules/obscenity/dist/pattern/Util.js
  var require_Util = __commonJS({
    "node_modules/obscenity/dist/pattern/Util.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.potentiallyMatchesEmptyString = potentiallyMatchesEmptyString;
      exports.compilePatternToRegExp = compilePatternToRegExp;
      exports.getRegExpStringForNode = getRegExpStringForNode;
      var Nodes_1 = require_Nodes();
      function potentiallyMatchesEmptyString(pattern2) {
        return pattern2.nodes.every((node) => node.kind === Nodes_1.SyntaxKind.Optional);
      }
      function compilePatternToRegExp(pattern2) {
        let regExpStr = "";
        if (pattern2.requireWordBoundaryAtStart)
          regExpStr += "\\b";
        for (const node of pattern2.nodes)
          regExpStr += getRegExpStringForNode(node);
        if (pattern2.requireWordBoundaryAtEnd)
          regExpStr += `\\b`;
        return new RegExp(regExpStr, "gs");
      }
      var regExpSpecialChars = ["[", ".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "\\", "]"].map((str) => str.charCodeAt(0));
      function getRegExpStringForNode(node) {
        switch (node.kind) {
          case Nodes_1.SyntaxKind.Literal: {
            let str = "";
            for (const char of node.chars) {
              if (regExpSpecialChars.includes(char))
                str += "\\";
              str += String.fromCodePoint(char);
            }
            return str;
          }
          case Nodes_1.SyntaxKind.Optional:
            return `(?:${getRegExpStringForNode(node.childNode)})?`;
          case Nodes_1.SyntaxKind.Wildcard:
            return `.`;
        }
      }
    }
  });

  // node_modules/obscenity/dist/transformer/TransformerSet.js
  var require_TransformerSet = __commonJS({
    "node_modules/obscenity/dist/transformer/TransformerSet.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.TransformerSet = void 0;
      var TransformerSet = class {
        constructor(transformers) {
          __publicField(this, "transformers");
          __publicField(this, "statefulTransformers");
          this.transformers = transformers;
          this.statefulTransformers = Array.from({ length: this.transformers.length });
          for (let i = 0; i < this.transformers.length; i++) {
            const transformer = this.transformers[i];
            if (transformer.type === 1) {
              this.statefulTransformers[i] = transformer.factory();
            }
          }
        }
        applyTo(char) {
          let transformed = char;
          for (let i = 0; i < this.transformers.length && transformed !== void 0; i++) {
            const transformer = this.transformers[i];
            if (transformer.type === 0)
              transformed = transformer.transform(transformed);
            else
              transformed = this.statefulTransformers[i].transform(transformed);
          }
          return transformed;
        }
        resetAll() {
          for (let i = 0; i < this.transformers.length; i++) {
            if (this.transformers[i].type === 1) {
              this.statefulTransformers[i].reset();
            }
          }
        }
      };
      exports.TransformerSet = TransformerSet;
    }
  });

  // node_modules/obscenity/dist/util/CharacterIterator.js
  var require_CharacterIterator = __commonJS({
    "node_modules/obscenity/dist/util/CharacterIterator.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.CharacterIterator = void 0;
      var Char_1 = require_Char();
      var CharacterIterator = class {
        constructor(input) {
          __publicField(this, "_input");
          __publicField(this, "lastPosition", -1);
          __publicField(this, "currentPosition", 0);
          __publicField(this, "_lastWidth", 0);
          this._input = input != null ? input : "";
        }
        get input() {
          return this._input;
        }
        setInput(input) {
          this._input = input;
          this.reset();
          return this;
        }
        reset() {
          this.lastPosition = -1;
          this.currentPosition = 0;
          this._lastWidth = 0;
        }
        next() {
          if (this.done)
            return { done: true, value: void 0 };
          this.lastPosition = this.currentPosition;
          const char = this._input.charCodeAt(this.currentPosition++);
          this._lastWidth = 1;
          if (this.done || !(0, Char_1.isHighSurrogate)(char))
            return { done: false, value: char };
          const next = this._input.charCodeAt(this.currentPosition);
          if ((0, Char_1.isLowSurrogate)(next)) {
            this._lastWidth++;
            this.currentPosition++;
            return { done: false, value: (0, Char_1.convertSurrogatePairToCodePoint)(char, next) };
          }
          return { done: false, value: char };
        }
        // Position of the iterator; equals the start index of the last character consumed.
        // -1 if no characters were consumed yet.
        get position() {
          return this.lastPosition;
        }
        // Width of the last character consumed; 2 if it was a surrogate pair and 1 otherwise.
        // 0 if no characters were consumed yet.
        get lastWidth() {
          return this._lastWidth;
        }
        get done() {
          return this.currentPosition >= this._input.length;
        }
        [Symbol.iterator]() {
          return this;
        }
      };
      exports.CharacterIterator = CharacterIterator;
    }
  });

  // node_modules/obscenity/dist/matcher/IntervalCollection.js
  var require_IntervalCollection = __commonJS({
    "node_modules/obscenity/dist/matcher/IntervalCollection.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.IntervalCollection = void 0;
      var IntervalCollection = class {
        constructor() {
          __publicField(this, "dirty", false);
          __publicField(this, "intervals", []);
        }
        insert(lowerBound, upperBound) {
          this.intervals.push([lowerBound, upperBound]);
          this.dirty = true;
        }
        query(lowerBound, upperBound) {
          if (this.intervals.length === 0)
            return false;
          if (this.dirty) {
            this.dirty = false;
            this.intervals.sort(
              /* istanbul ignore next: not possible to write a robust test for this */
              (a, b) => a[0] < b[0] ? -1 : b[0] < a[0] ? 1 : 0
            );
          }
          for (const interval of this.intervals) {
            if (interval[0] > lowerBound)
              break;
            if (interval[0] <= lowerBound && upperBound <= interval[1])
              return true;
          }
          return false;
        }
        values() {
          return this.intervals.values();
        }
        [Symbol.iterator]() {
          return this.values();
        }
      };
      exports.IntervalCollection = IntervalCollection;
    }
  });

  // node_modules/obscenity/dist/matcher/regexp/RegExpMatcher.js
  var require_RegExpMatcher = __commonJS({
    "node_modules/obscenity/dist/matcher/regexp/RegExpMatcher.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.RegExpMatcher = void 0;
      var Util_1 = require_Util();
      var TransformerSet_1 = require_TransformerSet();
      var Char_1 = require_Char();
      var CharacterIterator_1 = require_CharacterIterator();
      var IntervalCollection_1 = require_IntervalCollection();
      var MatchPayload_1 = require_MatchPayload();
      var RegExpMatcher2 = class {
        /**
         * Creates a new [[RegExpMatcher]] with the options given.
         *
         * @example
         * ```typescript
         * // Use the options provided by the English preset.
         * const matcher = new RegExpMatcher({
         * 	...englishDataset.build(),
         * 	...englishRecommendedTransformers,
         * });
         * ```
         * @example
         * ```typescript
         * // Simple matcher that only has blacklisted patterns.
         * const matcher = new RegExpMatcher({
         *  blacklistedTerms: assignIncrementingIds([
         *      pattern`fuck`,
         *      pattern`f?uck`, // wildcards (?)
         *      pattern`bitch`,
         *      pattern`b[i]tch` // optionals ([i] matches either "i" or "")
         *  ]),
         * });
         *
         * // Check whether some string matches any of the patterns.
         * const doesMatch = matcher.hasMatch('fuck you bitch');
         * ```
         * @example
         * ```typescript
         * // A more advanced example, with transformers and whitelisted terms.
         * const matcher = new RegExpMatcher({
         *  blacklistedTerms: [
         *      { id: 1, pattern: pattern`penis` },
         *      { id: 2, pattern: pattern`fuck` },
         *  ],
         *  whitelistedTerms: ['pen is'],
         *  blacklistMatcherTransformers: [
         *      resolveConfusablesTransformer(), // '🅰' => 'a'
         *      resolveLeetSpeakTransformer(), // '$' => 's'
         *      foldAsciiCharCaseTransformer(), // case insensitive matching
         *      skipNonAlphabeticTransformer(), // 'f.u...c.k' => 'fuck'
         *      collapseDuplicatesTransformer(), // 'aaaa' => 'a'
         *  ],
         * });
         *
         * // Output all matches.
         * console.log(matcher.getAllMatches('fu.....uuuuCK the pen is mightier than the sword!'));
         * ```
         * @param options - Options to use.
         */
        constructor({ blacklistedTerms, whitelistedTerms = [], blacklistMatcherTransformers = [], whitelistMatcherTransformers = [] }) {
          __publicField(this, "blacklistedTerms");
          __publicField(this, "whitelistedTerms");
          __publicField(this, "blacklistMatcherTransformers");
          __publicField(this, "whitelistMatcherTransformers");
          this.blacklistedTerms = this.compileTerms(blacklistedTerms);
          this.validateWhitelistedTerms(whitelistedTerms);
          this.whitelistedTerms = whitelistedTerms;
          this.blacklistMatcherTransformers = new TransformerSet_1.TransformerSet(blacklistMatcherTransformers);
          this.whitelistMatcherTransformers = new TransformerSet_1.TransformerSet(whitelistMatcherTransformers);
        }
        getAllMatches(input, sorted = false) {
          const whitelistedIntervals = this.getWhitelistedIntervals(input);
          const [transformedToOrigIndex, transformed] = this.applyTransformers(input, this.blacklistMatcherTransformers);
          const matches = [];
          for (const blacklistedTerm of this.blacklistedTerms) {
            for (const match of transformed.matchAll(blacklistedTerm.regExp)) {
              const origStartIndex = transformedToOrigIndex[match.index];
              let origEndIndex = transformedToOrigIndex[match.index + match[0].length - 1];
              if (origEndIndex < input.length - 1 && // not the last character
              (0, Char_1.isHighSurrogate)(input.charCodeAt(origEndIndex)) && // character is a high surrogate
              (0, Char_1.isLowSurrogate)(input.charCodeAt(origEndIndex + 1))) {
                origEndIndex++;
              }
              if (!whitelistedIntervals.query(origStartIndex, origEndIndex)) {
                matches.push({
                  termId: blacklistedTerm.id,
                  startIndex: origStartIndex,
                  endIndex: origEndIndex,
                  matchLength: [...match[0]].length
                });
              }
            }
          }
          if (sorted)
            matches.sort(MatchPayload_1.compareMatchByPositionAndId);
          return matches;
        }
        hasMatch(input) {
          const whitelistedIntervals = this.getWhitelistedIntervals(input);
          const [transformedToOrigIndex, transformed] = this.applyTransformers(input, this.blacklistMatcherTransformers);
          for (const blacklistedTerm of this.blacklistedTerms) {
            for (const match of transformed.matchAll(blacklistedTerm.regExp)) {
              const origStartIndex = transformedToOrigIndex[match.index];
              let origEndIndex = transformedToOrigIndex[match.index + match[0].length - 1];
              if (origEndIndex < input.length - 1 && // not the last character
              (0, Char_1.isHighSurrogate)(input.charCodeAt(origEndIndex)) && // character is a high surrogate
              (0, Char_1.isLowSurrogate)(input.charCodeAt(origEndIndex + 1))) {
                origEndIndex++;
              }
              if (!whitelistedIntervals.query(origStartIndex, origEndIndex))
                return true;
            }
          }
          return false;
        }
        getWhitelistedIntervals(input) {
          const matches = new IntervalCollection_1.IntervalCollection();
          const [transformedToOrigIndex, transformed] = this.applyTransformers(input, this.whitelistMatcherTransformers);
          for (const whitelistedTerm of this.whitelistedTerms) {
            let lastEnd = 0;
            for (let startIndex = transformed.indexOf(whitelistedTerm, lastEnd); startIndex !== -1; startIndex = transformed.indexOf(whitelistedTerm, lastEnd)) {
              let origEndIndex = transformedToOrigIndex[startIndex + whitelistedTerm.length - 1];
              if (origEndIndex < input.length - 1 && // not the last character
              (0, Char_1.isHighSurrogate)(input.charCodeAt(origEndIndex)) && // character is a high surrogate
              (0, Char_1.isLowSurrogate)(input.charCodeAt(origEndIndex + 1))) {
                origEndIndex++;
              }
              matches.insert(transformedToOrigIndex[startIndex], origEndIndex);
              lastEnd = startIndex + whitelistedTerm.length;
            }
          }
          return matches;
        }
        applyTransformers(input, transformers) {
          const transformedToOrigIndex = [];
          let transformed = "";
          const iter = new CharacterIterator_1.CharacterIterator(input);
          for (const char of iter) {
            const transformedChar = transformers.applyTo(char);
            if (transformedChar !== void 0) {
              transformed += String.fromCodePoint(transformedChar);
              while (transformedToOrigIndex.length < transformed.length)
                transformedToOrigIndex.push(iter.position);
            }
          }
          transformers.resetAll();
          return [transformedToOrigIndex, transformed];
        }
        compileTerms(terms) {
          const compiled = [];
          const seenIds = /* @__PURE__ */ new Set();
          for (const term of terms) {
            if (seenIds.has(term.id))
              throw new Error(`Duplicate blacklisted term ID ${term.id}.`);
            if ((0, Util_1.potentiallyMatchesEmptyString)(term.pattern)) {
              throw new Error(`Pattern with ID ${term.id} potentially matches empty string; this is unsupported.`);
            }
            compiled.push({
              id: term.id,
              regExp: (0, Util_1.compilePatternToRegExp)(term.pattern)
            });
            seenIds.add(term.id);
          }
          return compiled;
        }
        validateWhitelistedTerms(whitelist) {
          if (whitelist.some((term) => term.length === 0)) {
            throw new Error("Whitelisted term set contains empty string; this is unsupported.");
          }
        }
      };
      exports.RegExpMatcher = RegExpMatcher2;
    }
  });

  // node_modules/obscenity/dist/pattern/ParserError.js
  var require_ParserError = __commonJS({
    "node_modules/obscenity/dist/pattern/ParserError.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ParserError = void 0;
      var ParserError2 = class extends Error {
        constructor(message, line, column) {
          super(`${line}:${column}: ${message}`);
          __publicField(this, "name", "ParserError");
          /**
           * The line on which the error occurred (one-based).
           */
          __publicField(this, "line");
          /**
           * The column on which the error occurred (one-based).
           * Note that surrogate pairs are counted as 1 column wide, not 2.
           */
          __publicField(this, "column");
          this.line = line;
          this.column = column;
        }
      };
      exports.ParserError = ParserError2;
    }
  });

  // node_modules/obscenity/dist/pattern/Parser.js
  var require_Parser = __commonJS({
    "node_modules/obscenity/dist/pattern/Parser.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Parser = void 0;
      var Char_1 = require_Char();
      var CharacterIterator_1 = require_CharacterIterator();
      var Nodes_1 = require_Nodes();
      var ParserError_1 = require_ParserError();
      var supportsEscaping = [
        92,
        91,
        93,
        63,
        124
      ];
      var supportsEscapingList = supportsEscaping.map((char) => `'${String.fromCodePoint(char)}'`).join(", ");
      var eof = -1;
      var Parser = class {
        constructor() {
          __publicField(this, "input", "");
          __publicField(this, "line", 1);
          __publicField(this, "column", 1);
          __publicField(this, "position", 0);
          __publicField(this, "lastColumn", 1);
          __publicField(this, "lastWidth", 0);
        }
        parse(input) {
          this.setInput(input);
          const nodes = [];
          const firstNode = this.nextNode();
          const requireWordBoundaryAtStart = (firstNode == null ? void 0 : firstNode.kind) === Nodes_1.SyntaxKind.BoundaryAssertion;
          if (firstNode && !requireWordBoundaryAtStart)
            nodes.push(firstNode);
          let requireWordBoundaryAtEnd = false;
          while (!this.done) {
            const pos = this.mark();
            const node = this.nextNode();
            if (node.kind !== Nodes_1.SyntaxKind.BoundaryAssertion) {
              nodes.push(node);
              continue;
            }
            if (!this.done) {
              this.reportError("Boundary assertions are not supported in this position; they are only allowed at the start / end of the pattern.", pos);
            }
            requireWordBoundaryAtEnd = true;
          }
          return { requireWordBoundaryAtStart, requireWordBoundaryAtEnd, nodes };
        }
        setInput(input) {
          this.input = input;
          this.line = 1;
          this.column = 1;
          this.position = 0;
          this.lastColumn = 1;
          this.lastWidth = 0;
          return this;
        }
        nextNode() {
          switch (this.peek()) {
            case eof:
              return void 0;
            case 91:
              return this.parseOptional();
            case 93:
              this.reportError(`Unexpected ']' with no corresponding '['.`);
            case 63:
              return this.parseWildcard();
            case 124:
              return this.parseBoundaryAssertion();
            default:
              return this.parseLiteral();
          }
        }
        get done() {
          return this.position >= this.input.length;
        }
        // Optional ::= '[' Wildcard | Text ']'
        parseOptional() {
          const preOpenBracketPos = this.mark();
          this.next();
          const postOpenBracketPos = this.mark();
          if (this.done)
            this.reportError("Unexpected unclosed '['.", preOpenBracketPos);
          if (this.accept("["))
            this.reportError("Unexpected nested optional node.", postOpenBracketPos);
          const childNode = this.nextNode();
          if (childNode.kind === Nodes_1.SyntaxKind.BoundaryAssertion) {
            this.reportError("Boundary assertions are not supported in this position; they are only allowed at the start / end of the pattern.", postOpenBracketPos);
          }
          if (!this.accept("]"))
            this.reportError("Unexpected unclosed '['.");
          return { kind: Nodes_1.SyntaxKind.Optional, childNode };
        }
        // Wildcard ::= '?'
        parseWildcard() {
          this.next();
          return { kind: Nodes_1.SyntaxKind.Wildcard };
        }
        // BoundaryAssertion ::= '|'
        parseBoundaryAssertion() {
          this.next();
          return { kind: Nodes_1.SyntaxKind.BoundaryAssertion };
        }
        // Literal              ::= (NON_SPECIAL | '\' SUPPORTS_ESCAPING)+
        // NON_SPECIAL         ::= _any character other than '\', '?', '[', ']', or '|'_
        // SUPPORTS_ESCAPING   ::= '\' | '[' | ']' | '?' | '|'
        parseLiteral() {
          const chars = [];
          while (!this.done) {
            if (this.accept("[]?|")) {
              this.backup();
              break;
            }
            const next = this.next();
            if (next === 92) {
              if (this.done) {
                this.backup();
                this.reportError("Unexpected trailing backslash.");
              }
              const escaped = this.next();
              if (!supportsEscaping.includes(escaped)) {
                const repr = String.fromCodePoint(escaped);
                this.backup();
                this.reportError(`Cannot escape character '${repr}'; the only characters that can be escaped are the following: ${supportsEscapingList}.`);
              }
              chars.push(escaped);
            } else {
              chars.push(next);
            }
          }
          return { kind: Nodes_1.SyntaxKind.Literal, chars };
        }
        reportError(message, { line = this.line, column = this.column } = {}) {
          throw new ParserError_1.ParserError(message, line, column);
        }
        // Marks the current position.
        mark() {
          return { line: this.line, column: this.column };
        }
        // Accepts any code point in the charset provided. Iff accepted, the character is consumed.
        accept(charset) {
          const next = this.next();
          const iter = new CharacterIterator_1.CharacterIterator(charset);
          for (const char of iter) {
            if (char === next)
              return true;
          }
          this.backup();
          return false;
        }
        // Reads one code point from the input, without consuming it.
        peek() {
          const next = this.next();
          this.backup();
          return next;
        }
        // Consumes one code point from the input.
        next() {
          if (this.done)
            return eof;
          const char = this.input.charCodeAt(this.position++);
          this.lastWidth = 1;
          if (char === 10) {
            this.lastColumn = this.column;
            this.column = 1;
            this.line++;
            return char;
          }
          this.lastColumn = this.column++;
          if (!(0, Char_1.isHighSurrogate)(char) || this.done)
            return char;
          const next = this.input.charCodeAt(this.position);
          if ((0, Char_1.isLowSurrogate)(next)) {
            this.position++;
            this.lastWidth++;
            return (0, Char_1.convertSurrogatePairToCodePoint)(char, next);
          }
          return char;
        }
        // Steps back one character; can only be called once per call to next().
        backup() {
          this.position -= this.lastWidth;
          this.column = this.lastColumn;
          if (this.lastWidth === 1 && this.input.charCodeAt(this.position) === 10) {
            this.line--;
          }
        }
      };
      exports.Parser = Parser;
    }
  });

  // node_modules/obscenity/dist/pattern/Pattern.js
  var require_Pattern = __commonJS({
    "node_modules/obscenity/dist/pattern/Pattern.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.pattern = pattern2;
      exports.parseRawPattern = parseRawPattern2;
      var Parser_1 = require_Parser();
      var parser = new Parser_1.Parser();
      function pattern2(strings, ...expressions) {
        let result = strings.raw[0];
        for (const [i, expression] of expressions.entries()) {
          result += String(expression);
          result += strings.raw[i + 1];
        }
        return parser.parse(result);
      }
      function parseRawPattern2(pattern3) {
        return parser.parse(pattern3);
      }
    }
  });

  // node_modules/obscenity/dist/transformer/Transformers.js
  var require_Transformers = __commonJS({
    "node_modules/obscenity/dist/transformer/Transformers.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.createSimpleTransformer = createSimpleTransformer2;
      exports.createStatefulTransformer = createStatefulTransformer2;
      function createSimpleTransformer2(transformer) {
        return { type: 0, transform: transformer };
      }
      function createStatefulTransformer2(factory) {
        return { type: 1, factory };
      }
    }
  });

  // node_modules/obscenity/dist/transformer/collapse-duplicates/transformer.js
  var require_transformer = __commonJS({
    "node_modules/obscenity/dist/transformer/collapse-duplicates/transformer.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.CollapseDuplicatesTransformer = void 0;
      var CollapseDuplicatesTransformer = class {
        constructor({ defaultThreshold, customThresholds }) {
          __publicField(this, "defaultThreshold");
          __publicField(this, "customThresholds");
          __publicField(this, "remaining", -1);
          __publicField(this, "lastChar", -1);
          this.defaultThreshold = defaultThreshold;
          this.customThresholds = customThresholds;
        }
        transform(char) {
          var _a;
          if (char === this.lastChar) {
            return this.remaining-- > 0 ? char : void 0;
          }
          const threshold = (_a = this.customThresholds.get(char)) != null ? _a : this.defaultThreshold;
          this.remaining = threshold - 1;
          this.lastChar = char;
          return threshold > 0 ? char : void 0;
        }
        reset() {
          this.remaining = -1;
          this.lastChar = -1;
        }
      };
      exports.CollapseDuplicatesTransformer = CollapseDuplicatesTransformer;
    }
  });

  // node_modules/obscenity/dist/transformer/collapse-duplicates/index.js
  var require_collapse_duplicates = __commonJS({
    "node_modules/obscenity/dist/transformer/collapse-duplicates/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.collapseDuplicatesTransformer = collapseDuplicatesTransformer2;
      var Char_1 = require_Char();
      var Transformers_1 = require_Transformers();
      var transformer_1 = require_transformer();
      function collapseDuplicatesTransformer2({ defaultThreshold = 1, customThresholds = /* @__PURE__ */ new Map() } = {}) {
        const map = createCharacterToThresholdMap(customThresholds);
        return (0, Transformers_1.createStatefulTransformer)(() => new transformer_1.CollapseDuplicatesTransformer({ defaultThreshold, customThresholds: map }));
      }
      function createCharacterToThresholdMap(customThresholds) {
        const map = /* @__PURE__ */ new Map();
        for (const [str, threshold] of customThresholds) {
          if (threshold < 0)
            throw new RangeError("Expected all thresholds to be non-negative.");
          const char = (0, Char_1.getAndAssertSingleCodePoint)(str);
          map.set(char, threshold);
        }
        return map;
      }
    }
  });

  // node_modules/obscenity/dist/transformer/remap-characters/index.js
  var require_remap_characters = __commonJS({
    "node_modules/obscenity/dist/transformer/remap-characters/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.remapCharactersTransformer = remapCharactersTransformer2;
      var Char_1 = require_Char();
      var CharacterIterator_1 = require_CharacterIterator();
      var Transformers_1 = require_Transformers();
      function remapCharactersTransformer2(mapping) {
        const map = createOneToOneMap(mapping);
        return (0, Transformers_1.createSimpleTransformer)((c) => {
          var _a;
          return (_a = map.get(c)) != null ? _a : c;
        });
      }
      function createOneToOneMap(mapping) {
        const map = /* @__PURE__ */ new Map();
        const iterable = mapping instanceof Map ? mapping.entries() : Object.entries(mapping);
        for (const [original, equivalents] of iterable) {
          const originalChar = (0, Char_1.getAndAssertSingleCodePoint)(original);
          const iter = new CharacterIterator_1.CharacterIterator(equivalents);
          for (const equivalent of iter)
            map.set(equivalent, originalChar);
        }
        return map;
      }
    }
  });

  // node_modules/obscenity/dist/transformer/resolve-confusables/confusables.js
  var require_confusables = __commonJS({
    "node_modules/obscenity/dist/transformer/resolve-confusables/confusables.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.confusables = void 0;
      exports.confusables = /* @__PURE__ */ new Map([
        [" ", " "],
        ["0", "\u24FF"],
        ["1", "\u24F5\u278A\u2474\xB9\u{1D7CF}\u{1D7D9}\uFF11\u{1D7F7}\u{1D7E3}\u2488\u{1D7ED}1\u2780\u2081\u2460\u2776\u2960"],
        ["2", "\u24F6\u2489\u2475\u278B\u01BB\xB2\u14BF\u{1D7DA}\uFF12\u{1D7EE}\u{1D7E4}\u14BE\u{1D7F8}\u01A7\u{1D7D0}\u2461\u1D24\u2082\u2781\u2777\u161D\u01A8"],
        ["3", "\xB3\u2CCC\uA7AB\u{1D7D1}\u2128\u{1D7DB}\u{1D7EF}\u{1D7E5}\uA76A\u278C\u0417\u021C\u24F7\u04E0\u01B7\uFF13\u{1D7F9}\u2476\u248A\u0292\u0293\u01EF\u01EE\u01BA\u{1D574}\u1DBE\u0437\u19A1\u2782\u2462\u2083\u1D9A\u1D23\u1D1F\u2778\u0498\u0499\u04EC\u04E1\u04ED\u04DF\u04DE"],
        ["4", "\u278D\u04B6\u13CE\u{1D7DC}\u04B7\u24F8\u04B8\u04B9\u04F4\u04F5\u1DA3\uFF14\u0447\u3129\u2074\u2783\u2084\u2463\u2779\u04CB\u2477\u248B"],
        ["5", "\u{1D7F1}\u24F9\u278E\u01BC\u{1D7D3}\u{1D7FB}\u{1D7DD}\u{1D7E7}\uFF15\u2784\u2085\u2464\u2075\u277A\u01BD\u2478\u248C"],
        ["6", "\u2CD2\u13EE\u{1D7DE}\u{1D7E8}\u{1D7D4}\u278F\u24FA\u03EC\u03ED\u2076\u0431\uFF16\u19C8\u2465\u2785\u2086\u277B\u2479\u248D"],
        ["7", "\u24FB\u{104D2}\u2790\uFF17\u2077\u2466\u2087\u277C\u2786\u247A\u248E"],
        ["8", "\u{1031A}\u2791\u24FC\uFF18\u{1D7E0}\u{1D7EA}\u09EA\u2078\u2088\u{1D7F4}\u2787\u2467\u277D\u{1D7FE}\u{1D7D6}\u247B\u248F"],
        ["9", "\uA76E\u2CCA\u24FD\u2792\u0A67\u09ED\u0B68\uFF19\u{1D7EB}\u{1D7FF}\u{1D7D7}\u2079\u2089\u0533\u2788\u2468\u277E\u247C\u2490"],
        ["A", "\u{1F130}\u13AF\u{102A0}\u{1D56C}\u{1D71C}\u{1D434}\uA4EE\u13AA\u{1D6A8}\uAB7A\u{1D756}\u{1F150}\u212B\u2200\u{1F1E6}\u20B3\u{1F170}\u{1D49C}\u{1D608}\u{1D400}\u{1D538}\u0434\u01FA\u15C5\u24B6\uFF21\u0391\u1F8B\u15E9\u0102\xC3\xC5\u01CD\u0200\u0202\u0100\u023A\u0104\u028C\u039B\u03BB\u019B\u1D00\u1D2C\u0414\u0410\u120D\xC4\u2090\u1571\xAA\u01DE\u04D2\u0386\u1EA0\u1EA2\u1EA6\u1EA8\u1EAC\u1EAE\u1EB0\u1EB2\u1EB4\u1EB6\u1FB8\u1FB9\u1FBA\u1FBB\u1FBC\u1F88\u1F89\u1F8A\u1F8C\u1F8D\u1F8E\u1F8F\u1F08\u1F09\u1F0A\u1F0B\u1F0C\u1F0D\u1F0E\u1F0F\u1E00\u0226\u01E0\u04D0\xC0\xC1\xC2\u1EA4\u1EAA\u{1D6E2}\u{1D4D0}\u{1D670}\u{1D63C}"],
        ["a", "\u2202\u237A\u24D0\u0571\u01DF\u1D43\u1D8F\u249C\u0430\u0252\uFF41\u03B1\u0203\u0201\u0E04\u01CE\u10DB\xE4\u0251\u0101\u0250\u0105\u1F84\u1E9A\u1EA1\u1EA3\u01E1\u1EA7\u1EB5\u1E01\u0227\u04D1\u04D3\xE3\xE5\u03AC\u1F70\u1F71\u0103\u1EA9\u1EB1\u1EB3\u1EB7\u1F80\u1F81\u1F82\u1F83\u1F85\u1F86\u1FB0\u1FB1\u1FB2\u1FB3\u1FB4\u1D90\u1FB6\u1FB7\u1F00\u1F01\u1F02\u1F03\u1F04\u1F05\u1F06\u1F07\u1F87\u1EAD\u1EAF\xE0\xE1\xE2\u1EA5\u1EAB\u01FB\u2C65\u{1D41A}\u{1D44E}\u{1D482}\u{1D4B6}\u{1D4EA}\u{1D51E}\u{1D552}\u{1D586}\u{1D5BA}\u{1D5EE}\u{1D622}\u{1D656}\u{1D68A}\u{1D6C2}\u{1D6FC}\u{1D736}\u{1D770}\u{1D7AA}\u2376"],
        ["B", "\u{10301}\u{1D469}\u{1D56D}\u{1F131}\u{102A1}\u{1D5A1}\u{1D63D}\uA4D0\u{1D5D5}\u{1D609}\u{1D71D}\u{10282}\u{1D6A9}\u{1D401}\u{1D6E3}\u{1D757}\u{1D435}\u{1D671}\u{1D539}\u13F4\u13FC\u{1D791}\uA7B4\u{1D505}\u{1F151}\u0E3F\u{1D4D1}\u15FF\u15FE\u15FD\u{1F171}\u24B7\uFF22\u0432\u03D0\u15F7\u0181\u4E43\xDF\u10EA\u10E9\u0E56\u03B2\u026E\u0411\u0545\u0E52\u1656\u0299\u1D2E\u1D47\u130C\u1E04\u212C\u0392\u0412\u1E9E\u1E02\u1E06\u0243\u0D26\u15F9\u15F8\u1D5D\u165E\u165F\u165D\u16D2\u1657\u1658\u1D03\u{1F1E7}"],
        ["b", "\u13CF\u{1D41B}\u{1D623}\u{1D4B7}\u{1D51F}\u{1D4EB}\u{1D587}\u{1D5BB}\u{1D44F}\u{1D657}\u{1D553}\u{1D483}\u{1D5EF}\u{1D68B}\u266D\u1473\u1488\uFF42\u159A\u1579\u157A\u24D1\u1E03\u1E05\u048D\u044A\u1E07\u0183\u0253\u0185\u15AF\u0184\u042C\u1472\xFE\u0182\u249D\u042A\u1D80\u147F\u1480\u1482\u1481\u147E\u044C\u0180\u048C\u0462\u0463\u150E"],
        ["C", "\u13DF\u2CA4\u{1F132}\uA4DA\u{102A2}\u{10302}\u{1F172}\u{10415}\u{1F152}\u263E\u010C\xC7\u24B8\uFF23\u2183\u0187\u1455\u3108\xA2\u096E\u21BB\u0108\u03FE\u0547\u023B\u1645\u1D9C\u249E\u0106\u0480\u010A\xA9\u091F\u0186\u2102\u212D\u03F9\u0421\u531A\u1E08\u04AA\u0297\u1456\u1461\u1462\u1463\u1464\u1465\u216D\u{1D402}\u{1D436}\u{1D46A}\u{1D49E}\u{1D4D2}\u{1D56E}\u{1D5A2}\u{1D5D6}\u{1D60A}\u{1D63E}\u150D"],
        ["c", "\u2CA5\u{1043D}\uABAF\u0109\uFF43\u24D2\u0107\u010D\u010B\xE7\u0481\u0188\u1E09\u023C\u2184\u0441\u122D\u1D04\u03F2\u04AB\uA49D\u03C2\u027D\u03DB\u{1D672}\u1466\u19DA\u{1D41C}\u{1D450}\u{1D484}\u{1D4B8}\u{1D4EC}\u{1D520}\u{1D554}\u{1D588}\u{1D5BC}\u{1D5F0}\u{1D624}\u{1D658}\u{1D68C}\u20B5\u{1F1E8}\u1974\u14BC\u217D"],
        ["D", "\u13A0\u{1F133}\u{1D521}\u{1D589}\u{1D53B}\u{1D5D7}\u{1D60B}\u{1D673}\u{1D437}\u{1D4D3}\u{1D403}\u{1D46B}\u{1D56F}\u{1D5A3}\u{1D507}\u{1D63F}\uAB70\u2145\u{1D49F}\uA4D3\u{1F173}\u{1F153}\u24B9\uFF24\u0189\u15EA\u018A\xD0\u053A\u1D05\u1D30\u2181\u1E0A\u0110\xDE\u216E\u15DE\u146F\u010E\u1E0C\u1E10\u1E12\u1E0E\u15EB\u15EC\u15DF\u15E0\u1D9B\u1D06\u{1F1E9}"],
        ["d", "\u13E7\uA4D2\u{1D4ED}\u1D6D\u20AB\u0503\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\u1D48\u249F\u0501\u217E\u1D81\u0500\u147A\u147B\u147C\u147D\u1484\u1470\u1471\u1D91\u{1D555}\u{1D5BD}\u{1D451}\u{1D625}\u{1D485}\u{1D659}\u{1D41D}\u{1D5F1}\u{1D68D}\u2146\u{1D4B9}\u02A0\u056A"],
        ["E", "\uAB7C\u{1F134}\u{1D640}\u{1D53C}\u{10286}\u{1D6AC}\uA4F0\u{1D75A}\u{1D794}\u{1D4D4}\u{1D46C}\u{1D5D8}\u{1F174}\u{1F154}\u24BA\u0388\uFF25\u018E\u1F1D\u156E\u0190\u30E2\u0404\u1D07\u1D31\u1D49\xC9\u4E47\u0401\u0246\uA085\u20AC\xC8\u2130\u0395\u0415\u2D39\u13AC\u0112\u0114\u0116\u0118\u011A\xCA\xCB\u0510\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u1E14\u1E16\u1EBA\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u1E18\u1E1A\u1F18\u1F19\u1F1A\u1F1B\u1F1C\u1FC8\u1FC9\u04D6\u1F72\u1F73\u0400\u03F5\u{1F1EA}"],
        ["e", "\u{1D452}\u{1D4EE}\u{1D556}\u{1D58A}\u{1D626}\u{1D5F2}\u{1D68E}\u{1D65A}\u{1D486}\u{1D522}\u{1D5BE}\u{1D41E}\u04BE\u04BF\u24D4\uFF45\u24A0\xE8\u19C9\xE9\u1D92\xEA\u0258\u1F14\u1EC1\u1EBF\u1EC5\u0AEF\u01DD\u0454\u03B5\u0113\u04BD\u025B\u1EC3\u1EBD\u1E15\u1E17\u0115\u0117\xEB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u0247\u2091\u0119\u1E1D\u1E19\u1E1B\u212E\u0435\u0511\u0450\u04D7\u1971\u0451\u1F10\u1F11\u1F12\u1F13\u1F15\u212F"],
        ["F", "\u{1F135}\u{10287}\u{1D509}\u{1D60D}\u{102A5}\uA4DD\uA798\u{1F175}\u{1F155}\u{1D4D5}\u24BB\uFF26\u0493\u0492\u15B4\u0191\u0532\u03DD\u127B\u1E1E\u2131\u03DC\u20A3\u{1F1EB}\u2132"],
        ["f", "\u{1D41F}\u{1D58B}\u24D5\uFF46\u0192\u1E1F\u0283\u0562\u1DA0\u24A1\u017F\uA2B0\u0284\u2231\u1D82\u{1D627}"],
        ["G", "\uA4D6\u13F3\u{1F136}\u13C0\u13FB\u{1D53E}\u{1D4D6}\u{1D46E}\u{1D572}\uAB90\u{1D4A2}\u{1D642}\u{1D5A6}\u{1D676}\u{1D50A}\u{1D43A}\u{1D406}\u{1F176}\u{1F156}\u24BC\uFF27\u0262\u0193\u029B\u0122\u161C\u1D33\u01F4\u0120\u050C\u011C\u1E20\u011E\u01E6\u01E4\u050D\u20B2\u{1F1EC}\u2141"],
        ["g", "\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u0581\u0AED\u01E5\u0260\uFEED\uFEEE\u1D4D\u24A2\u210A\u0261\u19C1\u{1D420}\u{1D454}\u{1D488}\u{1D4F0}\u{1D524}\u{1D558}\u{1D58C}\u{1D5C0}\u{1D5F4}\u{1D628}\u{1D65C}\u{1D690}"],
        ["H", "\u{1F137}\u{1D722}\uA4E7\u{1D60F}\u{1D43B}\u{1D75C}\u{1D5A7}\u{102CF}\u{1D5DB}\uAB8B\u210D\u13BB\u210C\u2C8E\u{1D46F}\u{1D796}\u{1F177}\u{1F157}\u12DE\u01F6\u050B\u24BD\uFF28\u0124\u16BA\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u04A2\u04A3\u04A4\u1FCA\u1FCB\u1FCC\u1F28\u1F29\u1F2A\u1F2B\u1F2D\u1F2E\u1F2F\u1F98\u1F99\u1F9A\u1F9B\u1F9C\u1F9D\u1F9E\u1F9F\u04C9\u04C8\u04A5\u0389\u043D\u5344\u2653\u{1D4D7}\u210B\u041D\u{1D407}\u{1D643}\u{1D677}\u029C\u{1D6E8}\u0397\u{1D6AE}\u157C\u04C7\u1D34\u1D78\u{1F1ED}"],
        ["h", "\u04BA\u24A3\u0452\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u0570\u04BB\u12A8\u12A9\u12AA\u12AB\u0266\u210E\u{1D421}\u{1D489}\u{1D4BD}\u{1D4F1}\u{1D525}\u{1D559}\u{1D58D}\u{1D5C1}\u{1D5F5}\u{1D629}\u{1D65D}\u{1D691}\u056B\u02B0\u144B\u15C1\u0267\u3093\u0265"],
        ["I", "\u{1F138}\u0407\uA024\u13C6\u{1F178}\u{1F158}\u0625\uFE87\u0673\u0623\uFE83\u0672\u0675\u24BE\uFF29\u17F8\xCC\xCD\xCE\u0128\u012A\u012C\u0130\xCF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197\u30A7\u30A8\u1FD8\u1FD9\u1FDA\u1FDB\u1F38\u1F39\u1F3A\u1F3B\u1F3C\u1F3D\u1F3E\u2160\u03AA\u038A\u026A\u1DA6\u144A\u1963\u{1D6EA}\u{1D408}\u{1D644}\u{1D678}\u{1D4F5}\u{1D661}\u{1D43C}\u1D35\u{1D6B0}\u{1D470}\u{1F1EE}"],
        ["i", "\u24D8\uFF49\xEC\xED\xEE\u0129\u012B\u012D\xEF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u1E2D\u1FD0\u1FD1\u1FD2\u1FD3\u1FD6\u1FD7\u1F30\u1F31\u1F32\u2170\u217C\u2223\u2D4F\uFFE8\u05C0\u0627\u0661\u06F1\u07CA\u16C1\u1F33\u1F34\u1F35\u0268\u0456\u1F76\u1F77\u1D96\u{1D526}\u{1D692}\u{1D778}\u{1D5C2}\u{1D422}\u{1D55A}\u{1D58E}\u{1D5F6}\u{1D62A}\u{1D65E}\u03AF\u2071\u1D62\u{1D4F2}\u24A4"],
        ["J", "\u{1F139}\u{1F179}\u{1F159}\u24BF\uFF2A\u0408\u029D\u148D\u05E0\uFF8C\u0134\u0286\u0E27\u0644\u0575\u0296\u1D0A\u1D36\uFEDD\u130B\u0248\u2C7C\u0542\u0E45\u10B1\u012F\u13AB\u0237\u4E3F\u2110\u2111\u1498\u1499\u149A\u149B\u14B4\u14B5\u148E\u148F\u{1F1EF}"],
        ["j", "\u24D9\uFF4A\u03F3\u02B2\u24A5\u0249\u0135\u01F0\u0458\u06B6\u1DA8\u{1D4BF}\u{1D62B}\u{1D5F7}\u{1D457}\u{1D65F}\u{1D527}\u{1D48B}\u{1D5C3}\u{1D4F3}\u{1D55B}\u{1D693}\u{1D58F}\u{1D423}"],
        ["K", "\u{1D5DE}\u{1F13A}\u{1D725}\u{1D612}\uA4D7\u{1D646}\u{1D542}\u2C94\u{1D50E}\u{1D6EB}\u13E6\u{1D799}\u{1D4A6}\u{1F17A}\u{1F15A}\u20AD\u24C0\uFF2B\u0138\u1E30\u045C\u0198\u043A\u04A0\u03BA\u049B\u049F\u04C4\u029E\u049A\u041A\u04A1\u1D0B\u1D37\u1D4F\u24A6\u16D5\u040C\u1315\u1E32\u039A\u212A\u049C\u049D\u049E\u0136\u1E34\u01E8\u2C69\u03D7\u04C3\u{1F1F0}"],
        ["k", "\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\u1D84\u{1D424}\u{1D62C}\u{1D5C4}\u{1D55C}\u{1D705}\u{1D718}\u{1D73F}\u{1D752}\u{1D779}\u{1D78C}\u{1D7B3}\u{1D660}\u{1D694}\u{1D458}\u{1D48C}\u03F0\u{1D6CB}\u{1D6DE}\u{1D7C6}\u{1D5F8}\u{1D4F4}\u{1D4C0}"],
        ["L", "\u{1F13B}\u{1041B}\u2CD0\u{1D473}\u{1D67B}\u{10443}\u{1D4DB}\u2CD1\uABAE\u13DE\uA4E1\u{1F17B}\u{1F15B}\uFE88\u2514\u24C1\u0582\uFF2C\u013F\u14AA\u4E5A\u0546\u029F\uA4F6\u03B9\u053C\u1D38\u02E1\u0139\u1228\u1E36\u2097\u0393\u056C\u013B\u1102\u216C\u2112\u2C62\u1967\u1968\u14BB\u14B6\u14B7\u1DAB\uFE8E\u14BA\u14B9\u14B8\u14AB\u23B3\u3125\u0141\u2C60\uFE84\u023D\u{1F1F1}"],
        ["l", "\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u04C0\u2113\u1E3D\u1E3B\u0142\uFF9A\u026D\u019A\u026B\u2C61|\u0196\u24A7\u0285\u01C0\u05D5\u05DF\u0399\u0406\uFF5C\u1DA9\u04CF\u{1D4D8}\u{1D540}\u{1D5A8}\u{1D5DC}\u{1D610}\u{1D425}\u{1D459}\u{1D48D}\u{1D4C1}\u{1D529}\u{1D55D}\u{1D591}\u{1D5C5}\u{1D5F9}\u{1D62D}\u{1D695}\u{1D724}\u{1D75E}\u0131\u{1D6A4}\u0269\u1FBE\u{1D6CA}\u{1D704}\u{1D73E}\u{1D7B2}"],
        ["M", "\u{1F13C}\u{10311}\u{102B0}\uA4DF\u2C98\u13B7\u{1F17C}\u{1F15C}\u24C2\uFF2D\u043C\u1E42\u0D71\u15F0\u5DDE\u163B\u10DD\u0E53\u264F\u028D\u164F\u1D0D\u1D39\u1D50\u24A8\u1E3E\u041C\u1E40\u0BF1\u216F\u2133\u039C\u03FA\u16D6\u04CD\u04CE\u{1D40C}\u{1D440}\u{1D474}\u{1D4DC}\u{1D510}\u{1D544}\u{1D578}\u{1D5AC}\u{1D5E0}\u{1D614}\u{1D648}\u{1D67C}\u{1D6B3}\u{1D6ED}\u{1D727}\u{1D761}\u{1D79B}\u{1F1F2}"],
        ["m", "\u20A5\u1D6F\u{1D592}\u{1D426}\u{1D5C6}\u{1D52A}\u{1D55E}\u{1D4C2}\u24DC\uFF4D\u0D28\u1662\u0D69\u1E3F\u1E41\u217F\u03FB\u1E43\u1320\u0271\u17F3\u1D86\u{1D662}\u{1D4F6}\u{1D696}\u{1D45A}\u{1D5FA}\u19D5\u19D7"],
        ["N", "\u{1F13D}\u2115\uA4E0\u{1D6EE}\u{1D762}\u{1D67D}\u{1D6B4}\u{1D475}\u{1D441}\u2C9A\u{1D40D}\u{1D4A9}\u{1D79C}\u{1D5E1}\u{1D615}\u{1D728}\u{1D4DD}\u{1D5AD}\u{1F17D}\u20A6\u{1F15D}\u0419\u040D\u24C3\u048B\u17F7\uFF2E\u1D0E\u0274\u019D\u144E\u51E0\u0438\u0548\u057C\u0418\u05D4\u041B\u03C0\u1D3A\u1DB0\u0143\u5200\u12AD\u1E44\u207F\xD1\u041F\u039D\u1D28\u0578\u03D6\u01F8\u0147\u1E46\u0145\u1E4A\u1E48\u0E17\u014A\u04E2\u04E3\u04E4\u04E5\u045B\u045D\u0439\u1962\u048A\u1D3B\u{1F1F3}"],
        ["n", "\u05D7\u{1D48F}\u{1D4F7}\u{1D663}\u{1D45B}\u{1D593}\u{1D52B}\u{1D5C7}\u{1D697}\u{1D5FB}\u1952\u24DD\u03AE\uFF4E\u01F9\u1D12\u0144\xF1\u1F97\u03B7\u1E45\u0148\u1E47\u0272\u0146\u1E4B\u1E49\u0572\u0E96\u054C\u019E\u014B\u24A9\u0E20\u0E01\u0273\u043F\u0149\u043B\u0509\u0220\u1F20\u1F21\u1FC3\u0564\u1F90\u1F91\u1F92\u1F93\u1F94\u1F95\u1F96\u1FC4\u1FC6\u1FC7\u1FC2\u1F22\u1F23\u1F24\u1F25\u1F26\u1F27\u1F74\u1F75\u1260\u1261\u1262\u1263\u1264\u1265\u1266\u0235\u{1D6C8}\u{1D702}\u{1D73C}\u{1D776}\u{1D7B0}\u{1D55F}\u{1D62F}\u{1D427}\u{1D4C3}\u1D87\u1D70\u1965\u2229"],
        [
          "O",
          "\uA132\u{1F13E}\u{10292}\u{1D7EC}\uA4F3\u2C9E\u{10404}\u{102AB}\u{104C2}\u{1D79E}\u{1F15E}\u2365\u25EF\u2D41\u2296\uFF10\u229D\u{1D764}\u0472\u03F4\u{1D6B6}\u{1D72A}\u047A\u04E6\u04E8\u04EA\u038C\u0298\u{1D40E}\u01D1\xD2\u014E\xD3\xD4\xD5\u020C\u020E\u31FF\u274D\u24C4\uFF2F\u1F4B\u30ED\u2764\u0AE6\u2295\xD8\u0424\u053E\u0398\u01A0\u1D3C\u1D52\u24AA\u0150\xD6\u2092\xA4\u25CA\u03A6\u3007\u039F\u041E\u0555\u0B20\u0D20\u0BE6\u05E1\u1ED2\u1ED0\u1ED6\u1ED4\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u022E\u0230\u022A\u1ECE\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u01FE\u019F\u2D54\u07C0\u17F0\u235C\u2394\u2395\u29B0\u29B1\u29B2\u29B3\u29B4\u29B5\u29B6\u29B7\u29B8\u29B9\u29BA\u29BB\u29BC\u29BD\u29BE\u29BF\u29C0\u29C1\u29C2\u29C3\u1F48\u1F49\u1F4A\u1F4C\u1F4D"
        ],
        [
          "o",
          "\u{1D698}\u{1D6D0}\u{1D5C8}\u{1D7BC}\u101D\u2C9F\u{1D664}\u1040\u{1042C}\u{1D52C}\u{104EA}\u{1D4F8}\u{1F1F4}\u2364\u25CB\u03D9\u{1F17E}\u{1D4AA}\u{1D5AE}\u{1D7E2}\u{1D7F6}\u{1D67E}\u{1D630}\u{1D5FC}\u{1D560}\u{1D70A}\u{1D428}\u{1D77E}\u{1D7B8}\u1424\u24DE\u0473\u19D0\u1972\xF0\uFF4F\u0C20\u199E\u0553\xF2\u04E9\u04E7\xF3\xBA\u014D\xF4\u01D2\u020F\u014F\u1ED3\u1ED1\u020D\u1ED7\u1ED5\xF5\u03C3\u1E4D\u022D\u1E4F\u1F44\u1E51\u1E53\u022F\u022B\u0E4F\u1D0F\u0151\xF6\u047B\u043E\u12D0\u01ED\u0231\u09E6\u0B66\u0665\u0C66\u0CE6\u0D66\u0E50\u0ED0\u03BF\u0585\u1D11\u0966\u0A66\u1ECF\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\xF8\u01FF\u0275\u056E\u1F40\u1F41\u03CC\u1F78\u1F79\u1F42\u1F43\u1F45"
        ],
        ["P", "\u{1F13F}\uA4D1\u{1D6B8}\u{1D67F}\u{1D7A0}\u{1D64B}\uABB2\u2CA2\u{1D4AB}\u{1D766}\u{1D443}\u{1D477}\u{1D5E3}\u{1D40F}\u{10295}\u{1D72C}\u{1D617}\u{1D4DF}\u{1D5AF}\u{1D6F2}\u13E2\u{1F15F}\u048E\u{1F17F}\u24C5\uFF30\u01A4\u146D\u5C38\u1E56\u0580\u03C6\u0584\u1D18\u1D3E\u1D56\u24AB\u1E54\uFF71\u05E7\u0420\u12E8\u1D29\u2C63\u2119\u03A1\u1FEC\u1478\u1476\u1477\u1479\u146C\u146E\u{1F1F5}\u20B1"],
        ["p", "\u048F\u2117\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\u1FE5\u03C1\u0440\u01BF\u01F7\u1FE4\u2374\u{1D4F9}\u{1D4C5}\u{1D429}\u{1D45D}\u{1D491}\u{1D52D}\u{1D561}\u{1D595}\u{1D5C9}\u{1D5FD}\u{1D631}\u{1D665}\u{1D699}\u{1D6D2}\u{1D746}\u{1D7BA}\u{1D70C}\u{1D780}"],
        ["Q", "\u{1F140}\u{1F180}\u{1F160}\u24C6\uFF31\u211A\u2D55\u051A\u{1D410}\u{1D444}\u{1D478}\u{1D4AC}\u{1D4E0}\u{1D680}\u{1D618}\u{1D64C}\u{1D5B0}\u{1D57C}\u{1D514}\u{1D5E4}\u{1F1F6}"],
        ["q", "\u24E0\uFF51\u0563\u24AC\u06F9\u0566\u146B\u024B\u024A\u051B\u{1D5CA}\u{1D45E}\u{1D632}\u{1D562}\u{1D69A}\u{1D492}\u{1D596}\u{1D42A}\u{1D52E}\u{1D4FA}\u{1D666}"],
        ["R", "\u211E\u211F\uAB71\u13D2\u{104B4}\uABA2\u13A1\uA4E3\u{1F181}\u{1F161}\u24C7\uFF32\u1D19\u0212\u0280\u1587\u044F\u5C3A\u0154\u042F\u0AB0\u01A6\u1D3F\u12EA\u1E5A\u024C\u0281\u211B\u211C\u211D\u1E58\u0158\u0210\u1E5C\u0156\u1E5E\u2C64\u{1D411}\u{1D445}\u{1D479}\u{1D4E1}\u{1D57D}\u{1D5B1}\u{1D5E5}\u{1D619}\u{1D64D}\u{1D681}\u16B1\u{1F1F7}\u1D1A"],
        ["r", "\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u0433\u0550\u027E\u196C\u1E5F\u024D\u02B3\u24AD\u027C\u0453\u1D26\u1D89\u{1D42B}\u{1D45F}\u{1D493}\u{1D4C7}\u{1D4FB}\u{1D52F}\u{1D563}\u{1D597}\u{1D5CB}\u{1D5FF}\u{1D633}\u{1D667}\u1D72\u0491\u1D63"],
        ["S", "\u{1F142}\uA1D9\u{1D4E2}\u{1D5E6}\u13DA\u{1D4AE}\u13D5\u{1D682}\u{1D412}\uA4E2\u{1D5B2}\u{1D516}\u{1D64E}\u{10296}\u{1D57E}\u{10420}\u{1D61A}\u{1D54A}\u{1D446}\u{1D47A}\u{1F182}\u{1F162}\u24C8\uFF33\u1E68\u015E\u0586\u054F\u0218\u02E2\u24AE\u0405\u1E60\u0160\u015A\u1E64\u015C\u1E66\u1E62\u0D1F\u1515\u1516\u1522\u1521\u1523\u1524"],
        ["s", "\u24E2\uA731\u{10448}\uABAA\uFF53\u015B\u1E65\u015D\u1E61\u0161\u1E67\u0282\u1E63\u1E69\u0455\u015F\u0219\u023F\u1D8A\u0C15\u{1D42C}\u{1D460}\u{1D494}\u{1D4C8}\u{1D4FC}\u{1D530}\u{1D564}\u{1D598}\u{1D5CC}\u{1D600}\u{1D634}\u{1D668}\u{1D69C}\u078E\u{1F1F8}"],
        ["T", "\u{1F143}\u{1F183}\u{10315}\u{1D6BB}\u{1D6F5}\u{1D54B}\u{1D57F}\u{1D47B}\u{102B1}\u{10297}\u{1D5B3}\u{1D64F}\u{1F768}\u{1D769}\u{1D7A3}\u{1D683}\u{1D61B}\u{1D447}\uA4D4\u27D9\u{1D413}\u2CA6\u{1D5E7}\u22A4\u{1D517}\u13A2\uAB72\u{1D4AF}\u{1F163}\u23C7\u23C9\u24C9\uFF34\u0442\u04AC\u04AD\u01AC\u30A4\u0166\u0535\u03C4\u1D1B\u1D40\uFF72\u1355\u03EE\u0164\u22A5\u01AE\u03A4\u0422\u4E0B\u1E6A\u1E6C\u021A\u0162\u1E70\u1E6E\u4E05\u4E01\u142A\u{1D6D5}\u{1D70F}\u{1D749}\u{1D783}\u{1D7BD}\u{1D4E3}\u3112\u{1F1F9}\u1325"],
        ["t", "\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0236\u0A6E\u0567\u0287\u2020\u0163\u1E71\u1E6F\u01AD\u0167\u1D57\u24AF\u0288\u0565\u01AB\u{1D42D}\u{1D461}\u{1D495}\u{1D4C9}\u{1D4FD}\u{1D531}\u{1D565}\u{1D599}\u{1D5CD}\u{1D601}\u{1D635}\u{1D669}\u{1D69D}\u30CA"],
        ["U", "\u{1F144}\uA4F4\u{104CE}\uA4A4\u{1F184}\u{1F164}\u0168\u016C\u016E\u1457\u1458\u01D3\u01D5\u01D7\u01D9\u24CA\uFF35\u0216\u144C\u51F5\u01B1\u0574\u0531\uA4F5\u0426\u016A\u0544\u01B2\u1640\u1D41\u1D58\u24B0\u0170\u0AAA\xDC\u054D\xD9\xDA\xDB\u1E78\u1E7A\u01DB\u1EE6\u0214\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244\u1969\u1467\u222A\u162E\u22C3\u{1D414}\u{1D448}\u{1D47C}\u{1D4B0}\u{1D4E4}\u{1D518}\u{1D54C}\u{1D580}\u{1D5B4}\u{1D5E8}\u{1D61C}\u{1D650}\u{1D684}\u{1F1FA}"],
        ["u", "\u1F7A\u1F7B\u24E4\uFF55\xF9\u0169\u016B\u1EEB\u1E77\u1E79\u016D\u01D6\u1EEF\u1959\u01DA\u01DC\u1F57\u03C5\u03B0\u0E19\u057D\u028A\u01D8\u01D4\xFA\u016F\u1D1C\u0171\u0173\u0E22\xFB\u1E7B\u0446\u1201\xFC\u1D7E\u1D64\xB5\u028B\u1EE7\u0215\u0217\u01B0\u1EE9\u1EED\u1EF1\u1EE5\u1E73\u1E75\u0289\u1FE0\u1FE1\u1FE2\u1FE3\u1FE6\u1FE7\u1F50\u1F51\u03CB\u03CD\u1F52\u1F53\u1F54\u1F55\u1F56\u1954\u{1D42E}\u{1D462}\u{1D496}\u{1D4CA}\u{1D4FE}\u{1D532}\u{1D566}\u{1D59A}\u{1D5CE}\u1D99"],
        ["V", "\u{1F145}\uA4E6\u{1D47D}\u{1D5B5}\u{1D61D}\u13D9\u{1D685}\u{1D651}\u{1D415}\u{1F185}\u{1F165}\u24CB\uFF36\u142F\u0474\u1D5B\u24B1\u06F7\u1E7E\u2174\u2164\u1E7C\u0667\u2D38\u0476\u143A\u143B\u{1F1FB}\u{1D4E5}"],
        ["v", "\u1200\u24E5\uFF56\u{1D710}\u{1D74A}\u1E7D\u1E7F\u0C6E\u0E07\u0475\u05E2\u1D20\u03BD\u05D8\u1D65\u0477\u17F4\u1601\u{1D66B}\u{1D69F}\u{1D6CE}\u{1D708}\u{1D742}\u{1D77C}\u{1D7B6}\u{1D637}\u{1D603}\u{1D4FF}"],
        ["W", "\u{1F146}\u13D4\u13B3\u{1D47E}\uA4EA\u{1D4B2}\u{1D61E}\u{1F186}\u24CC\u{1F166}\uFF57\uFF37\u1E82\u1FA7\u15EF\u1955\u5C71\u0460\u0E9F\u0C1A\u0561\u0429\u0428\u03CE\u0449\u0E2C\u0448\u164E\u1D42\u02B7\u24B2\u0E1D\u1220\u1E84\u051C\u1E80\u0174\u1E86\u1E88\u0D27\u163A\u047F\u1661\u019C\u20A9\u{1F1FC}"],
        ["w", "\u1E81\uAB83\u1E83\u24E6\u2375\u0175\u1E87\u1E85\u1E98\u1E89\u2C73\u1F7C\u1F60\u1F61\u1F62\u1F63\u03C9\u1F64\u1F65\u1F66\u1F67\u1FF2\u1FF3\u1FF4\u1FF6\u1FF7\u2C72\u0461\u051D\u1D21\u1F7D\u1FA0\u1FA1\u1FA2\u1FA3\u1FA4\u1FA5\u1FA6\u026F\u{1D755}\u{1D7C9}\u{1D78F}"],
        ["X", "\u{1F7A8}\u{1F7A9}\u{1F7AA}\u{1F147}\u{1F7AB}\u{1F7AC}\u{10317}\u2CAC\uA4EB\u{1D583}\u{1D7A6}\u{1D61F}\u{10290}\u{1D6BE}\u{1D76C}\u{1D732}\uA7B3\u{10322}\u{1D5B7}\u{1D44B}\u{1D54F}\u{1D51B}\u{102B4}\u{1D5EB}\u{1F187}\u{1F167}\u274C\u24CD\u{1D4E7}\uFF38\u1E8A\u166D\u03C7\u3128\u{1D4B3}\u04FE\u10EF\u04FC\u04B3\u0416\u03A7\u04B2\u1D61\u02E3\u24B3\u05D0\u1238\u1E8C\uA2BC\u2169\u0425\u2573\u166E\u1541\u157D\u2179\u16B7\u2D5D\u{1D653}\u{1D687}\u4E42\u{1D417}\u{1F1FD}"],
        ["x", "\u24E7\uFF58\u0445\u1E8B\xD7\u2093\u292B\u292C\u2A2F\u1E8D\u1D8D\u{1D66D}\u04FD\u{1D639}\u{1D431}\u{1D6A1}\u2A30\uFF92\u{1D501}"],
        ["Y", "\u2CA8\u{1D688}\u{1D44C}\u{1D5EC}\u{1D418}\uA4EC\u{1D480}\u{1D730}\u{102B2}\u{1F188}\u{1F168}\u24CE\uFF39\u1F5B\u01B3\u311A\u028F\u2144\u03D4\uFFE5\xA5\u054E\u03D3\u03B3\u05E5\u04F2\u0427\u040E\u1203\u0178\u024E\u03E4\u03A5\u03D2\u04AE\u1EF2\xDD\u0176\u1EF8\u0232\u1E8E\u1EF6\u1EF4\u1FE8\u1FE9\u1FEA\u1FEB\u1F59\u1F5D\u1F5F\u03AB\u038E\u04EE\u04F0\u04B0\u04B1\u{1D550}\u{1F1FE}"],
        ["y", "\u{1F148}\u13BD\u13A9\u24E8\uFF59\u1EF3\xFD\u0177\u1EF9\u0233\u1E8F\xFF\u1EF7\u0443\u10E7\u1E99\u1EF5\u01B4\u024F\u1D5E\u0263\u02B8\u1D8C\u04AF\u24B4\u04F3\u04F1\u04EF\u045E\u0423\u028E"],
        ["Z", "\u{1F149}\uA4DC\u{1D5ED}\u{1D419}\u2621\u13C3\u{1D621}\u{1F189}\u{1F169}\u24CF\uFF3A\u1E94\u01B5\u4E59\u1E90\u0224\u1DBB\u24B5\u0179\u2124\u0396\u017B\u017D\u1E92\u2C6B\u{1F1FF}"],
        ["z", "\uAB93\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u1D22\u130A\u0290\u2C6C\u1D8E\u0291\u1646"]
      ]);
    }
  });

  // node_modules/obscenity/dist/transformer/resolve-confusables/index.js
  var require_resolve_confusables = __commonJS({
    "node_modules/obscenity/dist/transformer/resolve-confusables/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.resolveConfusablesTransformer = resolveConfusablesTransformer2;
      var remap_characters_1 = require_remap_characters();
      var confusables_1 = require_confusables();
      function resolveConfusablesTransformer2() {
        return (0, remap_characters_1.remapCharactersTransformer)(confusables_1.confusables);
      }
    }
  });

  // node_modules/obscenity/dist/transformer/resolve-leetspeak/dictionary.js
  var require_dictionary = __commonJS({
    "node_modules/obscenity/dist/transformer/resolve-leetspeak/dictionary.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.dictionary = void 0;
      exports.dictionary = /* @__PURE__ */ new Map([
        ["a", "@4"],
        ["c", "("],
        ["e", "3"],
        ["g", "6"],
        ["i", "1|!"],
        ["l", "/"],
        ["o", "0"],
        ["s", "$5"],
        ["t", "7"],
        ["z", "2"]
      ]);
    }
  });

  // node_modules/obscenity/dist/transformer/resolve-leetspeak/index.js
  var require_resolve_leetspeak = __commonJS({
    "node_modules/obscenity/dist/transformer/resolve-leetspeak/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.resolveLeetSpeakTransformer = resolveLeetSpeakTransformer2;
      var remap_characters_1 = require_remap_characters();
      var dictionary_1 = require_dictionary();
      function resolveLeetSpeakTransformer2() {
        return (0, remap_characters_1.remapCharactersTransformer)(dictionary_1.dictionary);
      }
    }
  });

  // node_modules/obscenity/dist/transformer/to-ascii-lowercase/index.js
  var require_to_ascii_lowercase = __commonJS({
    "node_modules/obscenity/dist/transformer/to-ascii-lowercase/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.toAsciiLowerCaseTransformer = toAsciiLowerCaseTransformer2;
      var Char_1 = require_Char();
      var Transformers_1 = require_Transformers();
      function toAsciiLowerCaseTransformer2() {
        return (0, Transformers_1.createSimpleTransformer)((c) => (0, Char_1.isUpperCase)(c) ? (0, Char_1.invertCaseOfAlphabeticChar)(c) : c);
      }
    }
  });

  // node_modules/obscenity/dist/preset/english.js
  var require_english = __commonJS({
    "node_modules/obscenity/dist/preset/english.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.englishDataset = exports.englishRecommendedTransformers = exports.englishRecommendedWhitelistMatcherTransformers = exports.englishRecommendedBlacklistMatcherTransformers = void 0;
      var DataSet_1 = require_DataSet();
      var Pattern_1 = require_Pattern();
      var collapse_duplicates_1 = require_collapse_duplicates();
      var resolve_confusables_1 = require_resolve_confusables();
      var resolve_leetspeak_1 = require_resolve_leetspeak();
      var to_ascii_lowercase_1 = require_to_ascii_lowercase();
      exports.englishRecommendedBlacklistMatcherTransformers = [
        (0, resolve_confusables_1.resolveConfusablesTransformer)(),
        (0, resolve_leetspeak_1.resolveLeetSpeakTransformer)(),
        (0, to_ascii_lowercase_1.toAsciiLowerCaseTransformer)(),
        // See #23 and #46.
        // skipNonAlphabeticTransformer(),
        (0, collapse_duplicates_1.collapseDuplicatesTransformer)({
          defaultThreshold: 1,
          customThresholds: /* @__PURE__ */ new Map([
            ["b", 2],
            // a_bb_o
            ["e", 2],
            // ab_ee_d
            ["o", 2],
            // b_oo_nga
            ["l", 2],
            // fe_ll_atio
            ["s", 2],
            // a_ss_
            ["g", 2]
            // ni_gg_er
          ])
        })
      ];
      exports.englishRecommendedWhitelistMatcherTransformers = [
        (0, to_ascii_lowercase_1.toAsciiLowerCaseTransformer)(),
        (0, collapse_duplicates_1.collapseDuplicatesTransformer)({
          defaultThreshold: Number.POSITIVE_INFINITY,
          customThresholds: /* @__PURE__ */ new Map([[" ", 1]])
          // collapse spaces
        })
      ];
      exports.englishRecommendedTransformers = {
        blacklistMatcherTransformers: exports.englishRecommendedBlacklistMatcherTransformers,
        whitelistMatcherTransformers: exports.englishRecommendedWhitelistMatcherTransformers
      };
      exports.englishDataset = new DataSet_1.DataSet().addPhrase((phrase) => phrase.setMetadata({ originalWord: "abo" }).addPattern((0, Pattern_1.pattern)`|ab[b]o[s]|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "abeed" }).addPattern((0, Pattern_1.pattern)`ab[b]eed`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "africoon" }).addPattern((0, Pattern_1.pattern)`africoon`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "anal" }).addPattern((0, Pattern_1.pattern)`|anal`).addWhitelistedTerm("analabos").addWhitelistedTerm("analagous").addWhitelistedTerm("analav").addWhitelistedTerm("analy").addWhitelistedTerm("analog").addWhitelistedTerm("an al").addPattern((0, Pattern_1.pattern)`danal`).addPattern((0, Pattern_1.pattern)`eanal`).addPattern((0, Pattern_1.pattern)`fanal`).addWhitelistedTerm("fan al").addPattern((0, Pattern_1.pattern)`ganal`).addWhitelistedTerm("gan al").addPattern((0, Pattern_1.pattern)`ianal`).addWhitelistedTerm("ian al").addPattern((0, Pattern_1.pattern)`janal`).addWhitelistedTerm("trojan al").addPattern((0, Pattern_1.pattern)`kanal`).addPattern((0, Pattern_1.pattern)`lanal`).addWhitelistedTerm("lan al").addPattern((0, Pattern_1.pattern)`lanal`).addWhitelistedTerm("lan al").addPattern((0, Pattern_1.pattern)`oanal|`).addPattern((0, Pattern_1.pattern)`panal`).addWhitelistedTerm("pan al").addPattern((0, Pattern_1.pattern)`qanal`).addPattern((0, Pattern_1.pattern)`ranal`).addPattern((0, Pattern_1.pattern)`sanal`).addPattern((0, Pattern_1.pattern)`tanal`).addWhitelistedTerm("tan al").addPattern((0, Pattern_1.pattern)`uanal`).addWhitelistedTerm("uan al").addPattern((0, Pattern_1.pattern)`vanal`).addWhitelistedTerm("van al").addPattern((0, Pattern_1.pattern)`wanal`).addPattern((0, Pattern_1.pattern)`xanal`).addWhitelistedTerm("texan al").addPattern((0, Pattern_1.pattern)`yanal`).addPattern((0, Pattern_1.pattern)`zanal`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "anus" }).addPattern((0, Pattern_1.pattern)`anus`).addWhitelistedTerm("an us").addWhitelistedTerm("tetanus").addWhitelistedTerm("uranus").addWhitelistedTerm("janus").addWhitelistedTerm("manus")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "arabush" }).addPattern((0, Pattern_1.pattern)`arab[b]ush`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "arse" }).addPattern((0, Pattern_1.pattern)`|ars[s]e`).addWhitelistedTerm("arsen")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "ass" }).addPattern((0, Pattern_1.pattern)`|ass`).addWhitelistedTerm("45s").addWhitelistedTerm("assa").addWhitelistedTerm("assem").addWhitelistedTerm("assen").addWhitelistedTerm("asser").addWhitelistedTerm("assess").addWhitelistedTerm("asset").addWhitelistedTerm("assev").addWhitelistedTerm("assi").addWhitelistedTerm("assoc").addWhitelistedTerm("assoi").addWhitelistedTerm("assu")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "bastard" }).addPattern((0, Pattern_1.pattern)`bas[s]tard`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "bestiality" }).addPattern((0, Pattern_1.pattern)`be[e][a]s[s]tial`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "bitch" }).addPattern((0, Pattern_1.pattern)`bitch`).addPattern((0, Pattern_1.pattern)`bich|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "blowjob" }).addPattern((0, Pattern_1.pattern)`b[b]l[l][o]wj[o]b`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "bollocks" }).addPattern((0, Pattern_1.pattern)`bol[l]ock`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "boob" }).addPattern((0, Pattern_1.pattern)`boob`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "boonga" }).addPattern((0, Pattern_1.pattern)`boonga`).addWhitelistedTerm("baboon ga")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "buttplug" }).addPattern((0, Pattern_1.pattern)`buttplug`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "chingchong" }).addPattern((0, Pattern_1.pattern)`chingchong`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "chink" }).addPattern((0, Pattern_1.pattern)`chink`).addWhitelistedTerm("chin k")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "cock" }).addPattern((0, Pattern_1.pattern)`|cock|`).addPattern((0, Pattern_1.pattern)`|cocks`).addPattern((0, Pattern_1.pattern)`|cockp`).addPattern((0, Pattern_1.pattern)`|cocke[e]|`).addWhitelistedTerm("cockney")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "cuck" }).addPattern((0, Pattern_1.pattern)`cuck`).addWhitelistedTerm("cuckoo")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "cum" }).addPattern((0, Pattern_1.pattern)`|cum`).addWhitelistedTerm("cumu").addWhitelistedTerm("cumb")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "cunt" }).addPattern((0, Pattern_1.pattern)`|cunt`).addPattern((0, Pattern_1.pattern)`cunt|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "deepthroat" }).addPattern((0, Pattern_1.pattern)`deepthro[o]at`).addPattern((0, Pattern_1.pattern)`deepthro[o]t`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "dick" }).addPattern((0, Pattern_1.pattern)`|dck|`).addPattern((0, Pattern_1.pattern)`dick`).addWhitelistedTerm("benedick").addWhitelistedTerm("dickens").addWhitelistedTerm("dickety").addWhitelistedTerm("dickory")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "dildo" }).addPattern((0, Pattern_1.pattern)`dildo`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "doggystyle" }).addPattern((0, Pattern_1.pattern)`d[o]g[g]ys[s]t[y]l[l]`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "double penetration" }).addPattern((0, Pattern_1.pattern)`double penetra`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "dyke" }).addPattern((0, Pattern_1.pattern)`dyke`).addWhitelistedTerm("van dyke")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "ejaculate" }).addPattern((0, Pattern_1.pattern)`e[e]jacul`).addPattern((0, Pattern_1.pattern)`e[e]jakul`).addPattern((0, Pattern_1.pattern)`e[e]acul[l]ate`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "fag" }).addPattern((0, Pattern_1.pattern)`|fag`).addPattern((0, Pattern_1.pattern)`fggot`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "felch" }).addPattern((0, Pattern_1.pattern)`fe[e]l[l]ch`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "fellatio" }).addPattern((0, Pattern_1.pattern)`f[e][e]llat`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "finger bang" }).addPattern((0, Pattern_1.pattern)`fingerbang`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "fisting" }).addPattern((0, Pattern_1.pattern)`fistin`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "fuck" }).addPattern((0, Pattern_1.pattern)`f[?]ck`).addPattern((0, Pattern_1.pattern)`|fk`).addPattern((0, Pattern_1.pattern)`|fu|`).addPattern((0, Pattern_1.pattern)`|fuk`).addWhitelistedTerm("fick").addWhitelistedTerm("kung-fu").addWhitelistedTerm("kung fu")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "gangbang" }).addPattern((0, Pattern_1.pattern)`g[?]ngbang`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "handjob" }).addPattern((0, Pattern_1.pattern)`h[?]ndjob`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "hentai" }).addPattern((0, Pattern_1.pattern)`h[e][e]ntai`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "hooker" }).addPattern((0, Pattern_1.pattern)`hooker`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "incest" }).addPattern((0, Pattern_1.pattern)`incest`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "jerk off" }).addPattern((0, Pattern_1.pattern)`jerkoff`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "jizz" }).addPattern((0, Pattern_1.pattern)`jizz`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "kike" }).addPattern((0, Pattern_1.pattern)`kike`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "lubejob" }).addPattern((0, Pattern_1.pattern)`lubejob`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "masturbate" }).addPattern((0, Pattern_1.pattern)`m[?]sturbate`).addPattern((0, Pattern_1.pattern)`masterbate`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "negro" }).addPattern((0, Pattern_1.pattern)`negro`).addWhitelistedTerm("montenegro").addWhitelistedTerm("negron").addWhitelistedTerm("stoneground").addWhitelistedTerm("winegrow")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "nigger" }).addPattern((0, Pattern_1.pattern)`n[i]gger`).addPattern((0, Pattern_1.pattern)`n[i]gga`).addPattern((0, Pattern_1.pattern)`|nig|`).addPattern((0, Pattern_1.pattern)`|nigs|`).addWhitelistedTerm("snigger")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "orgasm" }).addPattern((0, Pattern_1.pattern)`[or]gasm`).addWhitelistedTerm("gasma")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "orgy" }).addPattern((0, Pattern_1.pattern)`orgy`).addPattern((0, Pattern_1.pattern)`orgies`).addWhitelistedTerm("porgy")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "penis" }).addPattern((0, Pattern_1.pattern)`pe[e]nis`).addPattern((0, Pattern_1.pattern)`|pnis`).addWhitelistedTerm("pen is")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "piss" }).addPattern((0, Pattern_1.pattern)`|piss`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "porn" }).addPattern((0, Pattern_1.pattern)`|prn|`).addPattern((0, Pattern_1.pattern)`porn`).addWhitelistedTerm("p orna")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "prick" }).addPattern((0, Pattern_1.pattern)`|prick[s]|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "pussy" }).addPattern((0, Pattern_1.pattern)`p[u]ssy`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "rape" }).addPattern((0, Pattern_1.pattern)`|rape`).addPattern((0, Pattern_1.pattern)`|rapis[s]t`).addWhitelistedTerm("rapper")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "retard" }).addPattern((0, Pattern_1.pattern)`retard`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "scat" }).addPattern((0, Pattern_1.pattern)`|s[s]cat|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "semen" }).addPattern((0, Pattern_1.pattern)`|s[s]e[e]me[e]n`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "sex" }).addPattern((0, Pattern_1.pattern)`|s[s]e[e]x|`).addPattern((0, Pattern_1.pattern)`|s[s]e[e]xy|`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "shit" }).addPattern((0, Pattern_1.pattern)`|shit`).addPattern((0, Pattern_1.pattern)`shit|`).addWhitelistedTerm("s hit").addWhitelistedTerm("sh it").addWhitelistedTerm("shi t").addWhitelistedTerm("shitake")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "slut" }).addPattern((0, Pattern_1.pattern)`s[s]lut`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "spastic" }).addPattern((0, Pattern_1.pattern)`|spastic`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "tit" }).addPattern((0, Pattern_1.pattern)`|tit|`).addPattern((0, Pattern_1.pattern)`|tits|`).addPattern((0, Pattern_1.pattern)`|titt`).addPattern((0, Pattern_1.pattern)`|tiddies`).addPattern((0, Pattern_1.pattern)`|tities`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "tranny" }).addPattern((0, Pattern_1.pattern)`|trany`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "turd" }).addPattern((0, Pattern_1.pattern)`|turd`).addWhitelistedTerm("turducken")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "twat" }).addPattern((0, Pattern_1.pattern)`|twat`).addWhitelistedTerm("twattle")).addPhrase((phrase) => phrase.setMetadata({ originalWord: "vagina" }).addPattern((0, Pattern_1.pattern)`vagina`).addPattern((0, Pattern_1.pattern)`|v[?]gina`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "wank" }).addPattern((0, Pattern_1.pattern)`|wank`)).addPhrase((phrase) => phrase.setMetadata({ originalWord: "whore" }).addPattern((0, Pattern_1.pattern)`|wh[o]re|`).addPattern((0, Pattern_1.pattern)`|who[o]res[s]|`).addWhitelistedTerm("who're"));
    }
  });

  // node_modules/obscenity/dist/transformer/skip-non-alphabetic/index.js
  var require_skip_non_alphabetic = __commonJS({
    "node_modules/obscenity/dist/transformer/skip-non-alphabetic/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.skipNonAlphabeticTransformer = skipNonAlphabeticTransformer2;
      var Char_1 = require_Char();
      var Transformers_1 = require_Transformers();
      function skipNonAlphabeticTransformer2() {
        return (0, Transformers_1.createSimpleTransformer)((c) => (0, Char_1.isAlphabetic)(c) ? c : void 0);
      }
    }
  });

  // node_modules/obscenity/dist/index.js
  var require_dist = __commonJS({
    "node_modules/obscenity/dist/index.js"(exports) {
      "use strict";
      var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      }) : (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        o[k2] = m[k];
      }));
      var __exportStar = exports && exports.__exportStar || function(m, exports2) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      __exportStar(require_BuiltinStrategies(), exports);
      __exportStar(require_TextCensor(), exports);
      __exportStar(require_DataSet(), exports);
      __exportStar(require_BlacklistedTerm(), exports);
      __exportStar(require_Matcher(), exports);
      __exportStar(require_MatchPayload(), exports);
      __exportStar(require_RegExpMatcher(), exports);
      __exportStar(require_Nodes(), exports);
      __exportStar(require_ParserError(), exports);
      __exportStar(require_Pattern(), exports);
      __exportStar(require_english(), exports);
      __exportStar(require_collapse_duplicates(), exports);
      __exportStar(require_remap_characters(), exports);
      __exportStar(require_resolve_confusables(), exports);
      __exportStar(require_resolve_leetspeak(), exports);
      __exportStar(require_skip_non_alphabetic(), exports);
      __exportStar(require_Transformers(), exports);
      __exportStar(require_to_ascii_lowercase(), exports);
    }
  });

  // node_modules/obscenity/dist/index.mjs
  var import_index = __toESM(require_dist(), 1);
  var DataSet = import_index.default.DataSet;
  var ParserError = import_index.default.ParserError;
  var PhraseBuilder = import_index.default.PhraseBuilder;
  var RegExpMatcher = import_index.default.RegExpMatcher;
  var SyntaxKind = import_index.default.SyntaxKind;
  var TextCensor = import_index.default.TextCensor;
  var assignIncrementingIds = import_index.default.assignIncrementingIds;
  var asteriskCensorStrategy = import_index.default.asteriskCensorStrategy;
  var collapseDuplicatesTransformer = import_index.default.collapseDuplicatesTransformer;
  var compareMatchByPositionAndId = import_index.default.compareMatchByPositionAndId;
  var createSimpleTransformer = import_index.default.createSimpleTransformer;
  var createStatefulTransformer = import_index.default.createStatefulTransformer;
  var englishDataset = import_index.default.englishDataset;
  var englishRecommendedBlacklistMatcherTransformers = import_index.default.englishRecommendedBlacklistMatcherTransformers;
  var englishRecommendedTransformers = import_index.default.englishRecommendedTransformers;
  var englishRecommendedWhitelistMatcherTransformers = import_index.default.englishRecommendedWhitelistMatcherTransformers;
  var fixedCharCensorStrategy = import_index.default.fixedCharCensorStrategy;
  var fixedPhraseCensorStrategy = import_index.default.fixedPhraseCensorStrategy;
  var grawlixCensorStrategy = import_index.default.grawlixCensorStrategy;
  var keepEndCensorStrategy = import_index.default.keepEndCensorStrategy;
  var keepStartCensorStrategy = import_index.default.keepStartCensorStrategy;
  var parseRawPattern = import_index.default.parseRawPattern;
  var pattern = import_index.default.pattern;
  var randomCharFromSetCensorStrategy = import_index.default.randomCharFromSetCensorStrategy;
  var remapCharactersTransformer = import_index.default.remapCharactersTransformer;
  var resolveConfusablesTransformer = import_index.default.resolveConfusablesTransformer;
  var resolveLeetSpeakTransformer = import_index.default.resolveLeetSpeakTransformer;
  var skipNonAlphabeticTransformer = import_index.default.skipNonAlphabeticTransformer;
  var toAsciiLowerCaseTransformer = import_index.default.toAsciiLowerCaseTransformer;

  // scripts/bad-words-src.js
  var _matcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers
  });
  window.filterBadWords = function(text) {
    if (!text) return text;
    var matches = _matcher.getAllMatches(text, true);
    if (!matches.length) return text;
    var result = "";
    var lastIndex = 0;
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      var start = match.startIndex;
      var end = match.endIndex;
      if (start < lastIndex) continue;
      result += text.slice(lastIndex, start);
      var numBlocks = Math.min(match.matchLength, 5);
      var blocks = "";
      for (var j = 0; j < numBlocks; j++) blocks += "\u2588";
      result += blocks;
      lastIndex = end + 1;
    }
    result += text.slice(lastIndex);
    return result;
  };
})();
