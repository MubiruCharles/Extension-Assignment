
(function () {
  
    function Searcher(pattern, options) {
        options = options || {};

        // Aproximately where in the text is the pattern expected to be found?
        var MATCH_LOCATION = options.location || 0,

            
            MATCH_DISTANCE = options.distance || 100,

            MATCH_THRESHOLD = options.threshold || 0.6,


            pattern = options.caseSensitive ? pattern : pattern.toLowerCase(),
            patternLen = pattern.length;

        if (patternLen > 32) {
            throw new Error('Pattern length is too long');
        }

        var matchmask = 1 << (patternLen - 1);

        /**
         * Initialise the alphabet for the Bitap algorithm.
         * @return {Object} Hash of character locations.
         * @private
         */
        var pattern_alphabet = (function () {
            var mask = {},
                i = 0;

            for (i = 0; i < patternLen; i++) {
                mask[pattern.charAt(i)] = 0;
            }

            for (i = 0; i < patternLen; i++) {
                mask[pattern.charAt(i)] |= 1 << (pattern.length - i - 1);
            }

            return mask;
        })();

      
        function match_bitapScore(e, x) {
            var accuracy = e / patternLen,
                proximity = Math.abs(MATCH_LOCATION - x);

            if (!MATCH_DISTANCE) {
                // Dodge divide by zero error.
                return proximity ? 1.0 : accuracy;
            }
            return accuracy + (proximity / MATCH_DISTANCE);
        }

        
        this.search = function (text) {
            text = options.caseSensitive ? text : text.toLowerCase();

            if (pattern === text) {
                // Exact match
                return {
                    isMatch: true,
                    score: 0
                };
            }

            var i, j,
                // Set starting location at beginning text and initialise the alphabet.
                textLen = text.length,
                // Highest score beyond which we give up.
                scoreThreshold = MATCH_THRESHOLD,
                // Is there a nearby exact match? (speedup)
                bestLoc = text.indexOf(pattern, MATCH_LOCATION),

                binMin, binMid,
                binMax = patternLen + textLen,

                lastRd, start, finish, rd, charMatch,

                score = 1,

                locations = [];

            if (bestLoc != -1) {
                scoreThreshold = Math.min(match_bitapScore(0, bestLoc), scoreThreshold);
                // What about in the other direction? (speedup)
                bestLoc = text.lastIndexOf(pattern, MATCH_LOCATION + patternLen);

                if (bestLoc != -1) {
                    scoreThreshold = Math.min(match_bitapScore(0, bestLoc), scoreThreshold);
                }
            }

            bestLoc = -1;

            for (i = 0; i < patternLen; i++) {
                // Scan for the best match; each iteration allows for one more error.
                // Run a binary search to determine how far from 'MATCH_LOCATION' we can stray at this
                // error level.
                binMin = 0;
                binMid = binMax;
                while (binMin < binMid) {
                    if (match_bitapScore(i, MATCH_LOCATION + binMid) <= scoreThreshold) {
                        binMin = binMid;
                    } else {
                        binMax = binMid;
                    }
                    binMid = Math.floor((binMax - binMin) / 2 + binMin);
                }

                // Use the result from this iteration as the maximum for the next.
                binMax = binMid;
                start = Math.max(1, MATCH_LOCATION - binMid + 1);
                finish = Math.min(MATCH_LOCATION + binMid, textLen) + patternLen;

                // Initialize the bit array
                rd = Array(finish + 2);

                rd[finish + 1] = (1 << i) - 1;

                for (j = finish; j >= start; j--) {
                    
                    charMatch = pattern_alphabet[text.charAt(j - 1)];
                    if (i === 0) {
                        // First pass: exact match.
                        rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
                    } else {
                        // Subsequent passes: fuzzy match.
                        rd[j] = ((rd[j + 1] << 1) | 1) & charMatch | (((lastRd[j + 1] | lastRd[j]) << 1) | 1) | lastRd[j + 1];
                    }
                    if (rd[j] & matchmask) {
                        score = match_bitapScore(i, j - 1);
                       
                        if (score <= scoreThreshold) {
                            // Told you so.
                            scoreThreshold = score;
                            bestLoc = j - 1;
                            locations.push(bestLoc);

                            if (bestLoc > MATCH_LOCATION) {
                                // When passing loc, don't exceed our current distance from loc.
                                start = Math.max(1, 2 * MATCH_LOCATION - bestLoc);
                            } else {
                                // Already passed loc, downhill from here on in.
                                break;
                            }
                        }
                    }
                }
                
                if (match_bitapScore(i + 1, MATCH_LOCATION) > scoreThreshold) {
                    break;
                }
                lastRd = rd;
            }

            return {
                isMatch: bestLoc >= 0,
                score: score
            };

        }
    }

    /**
     * @param {Array} list
     * @param {Object} options
     * @public
     */
    function Fuse(list, options) {
        options = options || {};
        var keys = options.keys;

        /**
         * Searches for all the items whose keys (fuzzy) match the pattern.
         * @param {String} pattern The pattern string to fuzzy search on.
         * @return {Array} A list of all serch matches.
         * @public
         */
        this.search = function (pattern) {
            //console.time('total');

            var searcher = new Searcher(pattern, options),
                i, j, item, text, dataLen = list.length,
                bitapResult, rawResults = [], resultMap = {},
                rawResultsLen, existingResult, results = [],
                compute = null;

          
            function analyzeText(text, entity, index) {
                // Check if the text can be searched
                if (text !== undefined && text !== null && typeof text === 'string') {

                    // Get the result
                    bitapResult = searcher.search(text);

                    // If a match is found, add the item to <rawResults>, including its score
                    if (bitapResult.isMatch) {

                        //console.log(bitapResult.score);

                        // Check if the item already exists in our results
                        existingResult = resultMap[index];
                        if (existingResult) {
                            // Use the lowest score
                            existingResult.score = Math.min(existingResult.score, bitapResult.score);
                        } else {
                            // Add it to the raw result list
                            resultMap[index] = {
                                item: entity,
                                score: bitapResult.score
                            };
                            rawResults.push(resultMap[index]);
                        }
                    }
                }
            }

            if (typeof list[0] === 'string') {
                // Iterate over every item
                for (i = 0; i < dataLen; i++) {
                    analyzeText(list[i], i, i);
                }
            } else {
                
                for (i = 0; i < dataLen; i++) {
                    item = list[i];
                    // Iterate over every key
                    for (j = 0; j < keys.length; j++) {
                        analyzeText(item[keys[j]], item, i);
                    }
                }
            }

           
            rawResults.sort(function (a, b) {
                return a.score - b.score;
            });
           
            rawResultsLen = rawResults.length;
            for (i = 0; i < rawResultsLen; i++) {
                results.push(options.id ? rawResults[i].item[options.id] : rawResults[i].item);
            }

            return results;
        }
    }

    //Export to Common JS Loader
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        if (typeof module.setExports === 'function') {
            module.setExports(Fuse);
        } else {
            module.exports = Fuse;
        }
    } else {
        window.Fuse = Fuse;
    }

})();