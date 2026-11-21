package com.bookhad.app.ai

import java.io.File
import java.text.Normalizer
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * Vietnamese Grapheme-to-Phoneme (G2P) & Sentence Chunker for Zero-Shot Neural TTS.
 *
 * 1. Automatically splits long book paragraphs into natural short sentences (<= 20–30 words)
 *    preserving paragraphIndex & charOffset for real-time highlighting and low peak tensor RAM.
 * 2. Decomposes Vietnamese syllables into (onset, vowel nucleus, coda, tone 1..6) and maps to
 *    IPA phoneme tokens from tokens.txt so all 6 Vietnamese tones (ngang, huyền, sắc, hỏi, ngã, nặng)
 *    are pronounced clearly by the neural acoustic model.
 */
class VietnameseG2P(private val tokenToId: Map<String, Long>) {

    companion object {
        const val TARGET_WORDS_PER_CHUNK = 22
        const val MAX_WORDS_PER_CHUNK = 28

        // Vietnamese 6-tone diacritic extraction table: char -> (base vowel, tone 1..6)
        // Tone 1=ngang, 2=huyền, 3=sắc, 4=hỏi, 5=ngã, 6=nặng
        private val VOWEL_TONE_MAP: Map<Char, Pair<Char, Int>> = mapOf(
            'à' to ('a' to 2), 'á' to ('a' to 3), 'ả' to ('a' to 4), 'ã' to ('a' to 5), 'ạ' to ('a' to 6),
            'ằ' to ('ă' to 2), 'ắ' to ('ă' to 3), 'ẳ' to ('ă' to 4), 'ẵ' to ('ă' to 5), 'ặ' to ('ă' to 6),
            'ầ' to ('â' to 2), 'ấ' to ('â' to 3), 'ẩ' to ('â' to 4), 'ẫ' to ('â' to 5), 'ậ' to ('â' to 6),
            'è' to ('e' to 2), 'é' to ('e' to 3), 'ẻ' to ('e' to 4), 'ẽ' to ('e' to 5), 'ẹ' to ('e' to 6),
            'ề' to ('ê' to 2), 'ế' to ('ê' to 3), 'ể' to ('ê' to 4), 'ễ' to ('ê' to 5), 'ệ' to ('ê' to 6),
            'ì' to ('i' to 2), 'í' to ('i' to 3), 'ỉ' to ('i' to 4), 'ĩ' to ('i' to 5), 'ị' to ('i' to 6),
            'ò' to ('o' to 2), 'ó' to ('o' to 3), 'ỏ' to ('o' to 4), 'õ' to ('o' to 5), 'ọ' to ('o' to 6),
            'ồ' to ('ô' to 2), 'ố' to ('ô' to 3), 'ổ' to ('ô' to 4), 'ỗ' to ('ô' to 5), 'ộ' to ('ô' to 6),
            'ờ' to ('ơ' to 2), 'ớ' to ('ơ' to 3), 'ở' to ('ơ' to 4), 'ỡ' to ('ơ' to 5), 'ợ' to ('ơ' to 6),
            'ù' to ('u' to 2), 'ú' to ('u' to 3), 'ủ' to ('u' to 4), 'ũ' to ('u' to 5), 'ụ' to ('u' to 6),
            'ừ' to ('ư' to 2), 'ứ' to ('ư' to 3), 'ử' to ('ư' to 4), 'ữ' to ('ư' to 5), 'ự' to ('ư' to 6),
            'ỳ' to ('y' to 2), 'ý' to ('y' to 3), 'ỷ' to ('y' to 4), 'ỹ' to ('y' to 5), 'ỵ' to ('y' to 6),
        )

        private val ONSET_TO_IPA: List<Pair<String, String>> = listOf(
            "ngh" to "ŋ",
            "ng" to "ŋ",
            "nh" to "ɲ",
            "ch" to "tɕ",
            "tr" to "ʈ",
            "th" to "tʰ",
            "ph" to "f",
            "kh" to "x",
            "gh" to "ɣ",
            "gi" to "z",
            "qu" to "kw",
            "đ" to "ɗ",
            "b" to "ɓ",
            "c" to "k",
            "k" to "k",
            "d" to "z",
            "g" to "ɣ",
            "h" to "h",
            "l" to "l",
            "m" to "m",
            "n" to "n",
            "p" to "p",
            "r" to "z",
            "s" to "s",
            "t" to "t",
            "v" to "v",
            "x" to "s",
        )

        private val VOWEL_TO_IPA: Map<String, String> = mapOf(
            "iê" to "iə", "yê" to "iə", "ia" to "iə", "ya" to "iə",
            "uô" to "uə", "ua" to "uə",
            "ươ" to "ɯə", "ưa" to "ɯə",
            "ă" to "a", "â" to "ə", "ê" to "e", "ô" to "o", "ơ" to "əː", "ư" to "ɯ",
            "a" to "aː", "e" to "ɛ", "i" to "i", "y" to "i", "o" to "ɔ", "u" to "u",
        )

        private val CODA_TO_IPA: List<Pair<String, String>> = listOf(
            "nh" to "ɲ",
            "ch" to "k",
            "ng" to "ŋ",
            "m" to "m",
            "n" to "n",
            "p" to "p",
            "t" to "t",
            "c" to "k",
            "i" to "j",
            "y" to "j",
            "o" to "w",
            "u" to "w",
        )

        private val TONE_IPA_SYMBOLS = arrayOf("", "˧˧", "˨˩", "˧˥", "˧˩˧", "˧ˀ˥", "˧ˀ˨")

        fun fromTokensFile(tokensFile: File): VietnameseG2P {
            val map = LinkedHashMap<String, Long>(256)
            if (tokensFile.exists()) {
                var idx = 0L
                tokensFile.forEachLine(Charsets.UTF_8) { raw ->
                    val line = raw.trimEnd('\r', '\n')
                    if (line.isNotEmpty()) {
                        val sep = max(line.lastIndexOf(' '), line.lastIndexOf('\t'))
                        if (sep > 0 && sep < line.length - 1) {
                            val parsed = line.substring(sep + 1).trim().toLongOrNull()
                            map[line.substring(0, sep)] = parsed ?: idx
                        } else {
                            map[line] = idx
                        }
                    }
                    idx++
                }
            }
            return VietnameseG2P(map)
        }

        /**
         * Splits long chapters/paragraphs into short natural sentences (<= 20–30 words each)
         * so ONNX tensors stay small and memory is released after every sentence.
         */
        fun chunkParagraphs(
            paragraphs: List<String>,
            startParagraphIndex: Int = 0,
            maxWordsPerChunk: Int = MAX_WORDS_PER_CHUNK,
        ): List<SentenceChunk> {
            val clampedMax = maxWordsPerChunk.coerceIn(12, 30)
            val softTarget = min(TARGET_WORDS_PER_CHUNK, clampedMax)
            val chunks = mutableListOf<SentenceChunk>()
            val safeStart = startParagraphIndex.coerceIn(0, max(0, paragraphs.size - 1))

            for (pIdx in safeStart until paragraphs.size) {
                val para = paragraphs[pIdx]
                if (para.isBlank()) continue
                val tokens = Regex("\\S+").findAll(para).toList()
                if (tokens.isEmpty()) continue

                var cursor = 0
                while (cursor < tokens.size) {
                    val hardEnd = min(cursor + clampedMax, tokens.size)
                    var splitEnd = hardEnd

                    if (hardEnd < tokens.size) {
                        // Prefer sentence-ending punctuation (. ! ? …) first, then clause punctuation (, ; :)
                        var sentenceBreak = -1
                        var clauseBreak = -1
                        val minBreak = min(cursor + 8, hardEnd - 1)
                        for (i in hardEnd - 1 downTo minBreak) {
                            val ch = tokens[i].value.lastOrNull()
                            if (ch == '.' || ch == '!' || ch == '?' || ch == '…') {
                                sentenceBreak = i + 1
                                break
                            }
                            if (clauseBreak == -1 && i >= cursor + softTarget - 8 &&
                                (ch == ',' || ch == ';' || ch == ':' || ch == '—')
                            ) {
                                clauseBreak = i + 1
                            }
                        }
                        splitEnd = when {
                            sentenceBreak > cursor -> sentenceBreak
                            clauseBreak > cursor -> clauseBreak
                            else -> min(cursor + softTarget, tokens.size)
                        }
                    }

                    val charStart = tokens[cursor].range.first
                    val charEnd = tokens[splitEnd - 1].range.last + 1
                    val slice = para.substring(charStart, charEnd).trim()
                    if (slice.isNotEmpty()) {
                        chunks.add(SentenceChunk(pIdx, charStart, slice))
                    }
                    cursor = splitEnd
                }
            }
            return chunks
        }
    }

    data class SentenceChunk(
        val paragraphIndex: Int,
        val charOffset: Int,
        val text: String,
    )

    /**
     * Converts a Vietnamese sentence into a sequence of IPA phoneme symbols preserving all 6 tones.
     */
    fun sentenceToIpaPhonemes(sentence: String): List<String> {
        val nfc = Normalizer.normalize(sentence.lowercase(Locale("vi", "VN")), Normalizer.Form.NFC)
        val out = ArrayList<String>(nfc.length * 2)
        val tokenRegex = Regex("[\\p{L}]+|[.,!?;:…—\\-]")

        for (match in tokenRegex.findAll(nfc)) {
            val tok = match.value
            if (tok.length == 1 && !tok[0].isLetter()) {
                out.add(tok)
                out.add(" ")
                continue
            }
            out.addAll(syllableToIpa(tok))
            out.add(" ")
        }
        if (out.isNotEmpty() && out.last() == " ") {
            out.removeAt(out.size - 1)
        }
        return out
    }

    /**
     * Encodes Vietnamese text into LongArray token IDs interleaved with blank ID (0) for VITS/OpenVoice V2.
     */
    fun textToTokenIds(sentence: String): LongArray {
        val blankId = tokenToId["_"] ?: tokenToId["<pad>"] ?: 0L
        val spaceId = tokenToId[" "] ?: tokenToId["<space>"] ?: 3L
        val bosId = tokenToId["^"] ?: tokenToId["<bos>"]
        val eosId = tokenToId["$"] ?: tokenToId["<eos>"]

        val phonemes = sentenceToIpaPhonemes(sentence)
        val ids = ArrayList<Long>(phonemes.size * 2 + 4)
        if (bosId != null) {
            ids.add(bosId)
            ids.add(blankId)
        }

        for (sym in phonemes) {
            if (sym == " ") {
                ids.add(spaceId)
                ids.add(blankId)
                continue
            }
            val direct = tokenToId[sym]
            if (direct != null) {
                ids.add(direct)
                ids.add(blankId)
            } else {
                // Character-level fallback for multi-codepoint IPA symbols if vocab uses single chars
                for (ch in sym) {
                    val chId = tokenToId[ch.toString()]
                    if (chId != null) {
                        ids.add(chId)
                        ids.add(blankId)
                    }
                }
            }
        }

        if (eosId != null) ids.add(eosId)
        return ids.toLongArray()
    }

    private fun syllableToIpa(rawSyllable: String): List<String> {
        var tone = 1 // ngang default
        val sb = StringBuilder(rawSyllable.length)
        for (ch in rawSyllable) {
            val mapped = VOWEL_TONE_MAP[ch]
            if (mapped != null) {
                sb.append(mapped.first)
                tone = mapped.second
            } else {
                sb.append(ch)
            }
        }
        var rest = sb.toString()
        val phonemes = ArrayList<String>(6)

        // 1. Extract onset consonant
        for ((grapheme, ipa) in ONSET_TO_IPA) {
            if (rest.startsWith(grapheme)) {
                phonemes.add(ipa)
                rest = rest.substring(grapheme.length)
                break
            }
        }

        // 2. Extract coda consonant if syllable has a vowel before it
        var codaIpa: String? = null
        if (rest.length >= 2) {
            for ((grapheme, ipa) in CODA_TO_IPA) {
                if (rest.endsWith(grapheme) && rest.length > grapheme.length) {
                    codaIpa = ipa
                    rest = rest.substring(0, rest.length - grapheme.length)
                    break
                }
            }
        }

        // 3. Map vowel nucleus (diphthongs first, then monophthongs)
        var vIdx = 0
        while (vIdx < rest.length) {
            if (vIdx + 1 < rest.length) {
                val pair = rest.substring(vIdx, vIdx + 2)
                val pairIpa = VOWEL_TO_IPA[pair]
                if (pairIpa != null) {
                    phonemes.add(pairIpa)
                    vIdx += 2
                    continue
                }
            }
            val single = rest[vIdx].toString()
            phonemes.add(VOWEL_TO_IPA[single] ?: single)
            vIdx++
        }

        if (codaIpa != null) {
            phonemes.add(codaIpa)
        }

        // 4. Append Vietnamese lexical tone marker (1..6)
        val toneSym = TONE_IPA_SYMBOLS.getOrElse(tone) { "" }
        if (toneSym.isNotEmpty()) {
            phonemes.add(toneSym)
        }
        return phonemes
    }
}
