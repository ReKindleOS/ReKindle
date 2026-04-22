import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// Initialised once at script-load time (deferred), not on first call,
// so Kindle's JIT-less V8 pays the setup cost before the user types.
var _matcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers,
});

// Drop-in replacement for the old regex-based filterBadWords.
// Handles leet-speak & Unicode confusables via obscenity transformers.
// endIndex is inclusive per obscenity's MatchPayload contract.
window.filterBadWords = function(text) {
    if (!text) return text;
    var matches = _matcher.getAllMatches(text, true); // sorted by startIndex
    if (!matches.length) return text;

    var result = '';
    var lastIndex = 0;

    for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        var start = match.startIndex;
        var end = match.endIndex; // inclusive

        if (start < lastIndex) continue; // skip overlapping matches

        result += text.slice(lastIndex, start);

        var numBlocks = Math.min(match.matchLength, 5);
        var blocks = '';
        for (var j = 0; j < numBlocks; j++) blocks += '\u2588'; // █
        result += blocks;

        lastIndex = end + 1;
    }

    result += text.slice(lastIndex);
    return result;
};
