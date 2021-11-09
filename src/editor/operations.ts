/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import Range from "./range";
import { Part, Type } from "./parts";
import { Formatting } from "../components/views/rooms/MessageComposerFormatBar";

/**
 * Some common queries and transformations on the editor model
 */

/**
 * Formats a given range with a given action
 * @param {Range} range the range that should be formatted
 * @param {Formatting} action the action that should be performed on the range
 */
export function formatRange(range: Range, action: Formatting): void {
    // If the selection was empty we select the current word instead
    if (range.wasInitializedEmpty()) {
        selectRangeOfWordAtCaret(range);
    } else {
        // Remove whitespace or new lines in our selection
        range.trim();
    }

    // Edgecase when just selecting whitespace or new line.
    // There should be no reason to format whitespace, so we can just return.
    if (range.length == 0) {
        return;
    }

    switch (action) {
        case Formatting.Bold:
            toggleInlineFormat(range, "**");
            break;
        case Formatting.Italics:
            toggleInlineFormat(range, "_");
            break;
        case Formatting.Strikethrough:
            toggleInlineFormat(range, "<del>", "</del>");
            break;
        case Formatting.Code:
            formatRangeAsCode(range);
            break;
        case Formatting.Quote:
            formatRangeAsQuote(range);
            break;
        case Formatting.InsertLink:
            formatRangeAsLink(range);
            break;
    }
}

export function replaceRangeAndExpandSelection(range: Range, newParts: Part[]): void {
    const { model } = range;
    model.transform(() => {
        const oldLen = range.length;
        const addedLen = range.replace(newParts);
        const firstOffset = range.start.asOffset(model);
        const lastOffset = firstOffset.add(oldLen + addedLen);
        return model.startRange(firstOffset.asPosition(model), lastOffset.asPosition(model));
    });
}

export function replaceRangeAndMoveCaret(range: Range, newParts: Part[], offset = 0): void {
    const { model } = range;
    model.transform(() => {
        const oldLen = range.length;
        const addedLen = range.replace(newParts);
        const firstOffset = range.start.asOffset(model);
        const lastOffset = firstOffset.add(oldLen + addedLen + offset);
        return lastOffset.asPosition(model);
    });
}

/**
 * Replaces a range with formatting or removes existing formatting.
 * Then positions the cursor with respect to the prefix or suffix length.
 * @param {Range} range the previous value
 * @param {Part[]} newParts the new value
 * @param {boolean} rangeHasFormatting the new value
 * @param {number} formatStringLength the length of the format string, assumed to be 0 when not formatted
 */
export function replaceRangeAndAutoAdjustCaret(
    range: Range,
    newParts: Part[],
    rangeHasFormatting = false,
    formatStringLength = 0,
): void {
    const { model } = range;
    model.transform(() => {
        // Shift the initialPosition
        if (rangeHasFormatting) {
            const relativeOffset = range.getLastStartingPosition().offset - range.start.offset; // Always positive
            if (range.length - relativeOffset < formatStringLength) {
                const correctionOffset = (range.length - relativeOffset - formatStringLength);
                const newStart = range.getLastStartingPosition().asOffset(model).add(correctionOffset);
                range.setLastStartingPosition(newStart.asPosition(model));
            } else if (relativeOffset < formatStringLength) {
                const correctionOffset = formatStringLength - relativeOffset;
                const newStart = range.getLastStartingPosition().asOffset(model).add(correctionOffset);
                range.setLastStartingPosition(newStart.asPosition(model));
            }
        }
        const offset = range.replace(newParts) / 2;
        const atEnd = range.getLastStartingPosition().asOffset(model).atNodeEnd;
        const newStart = range.getLastStartingPosition().asOffset(model).add(offset, atEnd).asPosition(model);
        range.setLastStartingPosition(newStart);
        return range.getLastStartingPosition();
    });
}

const punctuation = [".", ",", "?", "!"];

const isPlainWord = (offset: number, part: Part) => {
    return part.text[offset] !== " " && !punctuation.includes(part.text[offset])
    && part.type !== Type.Newline && part.type === Type.Plain;
};

export function selectRangeOfWordAtCaret(range: Range): void {
    // Select right side of word
    range.expandForwardsWhile((_index, offset, part) => {
        return isPlainWord(offset, part);
    });
    // Select left side of word
    range.expandBackwardsWhile((_index, offset, part) => {
        return isPlainWord(offset, part);
    });
    // Trim possibly selected new lines
    range.trim();
}

export function rangeStartsAtBeginningOfLine(range: Range): boolean {
    const { model } = range;
    const startsWithPartial = range.start.offset !== 0;
    const isFirstPart = range.start.index === 0;
    const previousIsNewline = !isFirstPart && model.parts[range.start.index - 1].type === Type.Newline;
    return !startsWithPartial && (isFirstPart || previousIsNewline);
}

export function rangeEndsAtEndOfLine(range: Range): boolean {
    const { model } = range;
    const lastPart = model.parts[range.end.index];
    const endsWithPartial = range.end.offset !== lastPart.text.length;
    const isLastPart = range.end.index === model.parts.length - 1;
    const nextIsNewline = !isLastPart && model.parts[range.end.index + 1].type === Type.Newline;
    return !endsWithPartial && (isLastPart || nextIsNewline);
}

export function formatRangeAsQuote(range: Range): void {
    const { model, parts } = range;
    const { partCreator } = model;
    for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (part.type === Type.Newline) {
            parts.splice(i + 1, 0, partCreator.plain("> "));
        }
    }
    parts.unshift(partCreator.plain("> "));
    if (!rangeStartsAtBeginningOfLine(range)) {
        parts.unshift(partCreator.newline());
    }
    if (!rangeEndsAtEndOfLine(range)) {
        parts.push(partCreator.newline());
    }
    parts.push(partCreator.newline());

    if (range.wasInitializedEmpty()) {
        replaceRangeAndAutoAdjustCaret(range, parts, false);
    } else {
        replaceRangeAndExpandSelection(range, parts);
    }
}

export function formatRangeAsCode(range: Range): void {
    const { model, parts } = range;
    const { partCreator } = model;

    const hasBlockFormatting = (range.length > 0)
        && range.text.startsWith("```")
        && range.text.endsWith("```");

    const needsBlockFormatting = parts.some(p => p.type === Type.Newline);

    if (hasBlockFormatting) {
        // Remove previously pushed backticks and new lines
        parts.shift();
        parts.pop();
        if (parts[0]?.text == "\n" && parts[parts.length - 1]?.text == "\n") {
            parts.shift();
            parts.pop();
        }
    } else if (needsBlockFormatting) {
        parts.unshift(partCreator.plain("```"), partCreator.newline());
        if (!rangeStartsAtBeginningOfLine(range)) {
            parts.unshift(partCreator.newline());
        }
        parts.push(
            partCreator.newline(),
            partCreator.plain("```"));
        if (!rangeEndsAtEndOfLine(range)) {
            parts.push(partCreator.newline());
        }
    } else {
        toggleInlineFormat(range, "`");
        return;
    }

    replaceRangeAndExpandSelection(range, parts);
}

export function formatRangeAsLink(range: Range) {
    const { model, parts } = range;
    const { partCreator } = model;
    parts.unshift(partCreator.plain("["));
    parts.push(partCreator.plain("]()"));
    // We set offset to -1 here so that the caret lands between the brackets
    replaceRangeAndMoveCaret(range, parts, -1);
}

// parts helper methods
const isBlank = part => !part.text || !/\S/.test(part.text);
const isNL = part => part.type === Type.Newline;

export function toggleInlineFormat(range: Range, prefix: string, suffix = prefix): void {
    const { model, parts } = range;
    const { partCreator } = model;

    // compute paragraph [start, end] indexes
    const paragraphIndexes = [];
    let startIndex = 0;
    // start at i=2 because we look at i and up to two parts behind to detect paragraph breaks at their end
    for (let i = 2; i < parts.length; i++) {
        // paragraph breaks can be denoted in a multitude of ways,
        // - 2 newline parts in sequence
        // - newline part, plain(<empty or just spaces>), newline part

        // bump startIndex onto the first non-blank after the paragraph ending
        if (isBlank(parts[i - 2]) && isNL(parts[i - 1]) && !isNL(parts[i]) && !isBlank(parts[i])) {
            startIndex = i;
        }

        // if at a paragraph break, store the indexes of the paragraph
        if (isNL(parts[i - 1]) && isNL(parts[i])) {
            paragraphIndexes.push([startIndex, i - 1]);
            startIndex = i + 1;
        } else if (isNL(parts[i - 2]) && isBlank(parts[i - 1]) && isNL(parts[i])) {
            paragraphIndexes.push([startIndex, i - 2]);
            startIndex = i + 1;
        }
    }

    const lastNonEmptyPart = parts.map(isBlank).lastIndexOf(false);
    // If we have not yet included the final paragraph then add it now
    if (startIndex <= lastNonEmptyPart) {
        paragraphIndexes.push([startIndex, lastNonEmptyPart + 1]);
    }

    // keep track of how many things we have inserted as an offset:=0
    let offset = 0;
    paragraphIndexes.forEach(([startIdx, endIdx]) => {
        // for each paragraph apply the same rule
        const base = startIdx + offset;
        const index = endIdx + offset;

        const isFormatted = (index - base > 0) &&
            parts[base].text.startsWith(prefix) &&
            parts[index - 1].text.endsWith(suffix);

        if (isFormatted) {
            // remove prefix and suffix formatting string
            const partWithoutPrefix = parts[base].serialize();
            partWithoutPrefix.text = partWithoutPrefix.text.substr(prefix.length);
            parts[base] = partCreator.deserializePart(partWithoutPrefix);

            const partWithoutSuffix = parts[index - 1].serialize();
            const suffixPartText = partWithoutSuffix.text;
            partWithoutSuffix.text = suffixPartText.substring(0, suffixPartText.length - suffix.length);
            parts[index - 1] = partCreator.deserializePart(partWithoutSuffix);
        } else {
            parts.splice(index, 0, partCreator.plain(suffix)); // splice in the later one first to not change offset
            parts.splice(base, 0, partCreator.plain(prefix));
            offset += 2; // offset index to account for the two items we just spliced in
        }
    });

    // If the user didn't select something initially, we want to just restore
    // the caret position instead of making a new selection.
    if (range.wasInitializedEmpty() && prefix === suffix) {
        // Check if we need to add a offset for a toggle or untoggle
        const hasFormatting = range.text.startsWith(prefix) && range.text.endsWith(suffix);
        replaceRangeAndAutoAdjustCaret(range, parts, hasFormatting, prefix.length);
    } else {
        replaceRangeAndExpandSelection(range, parts);
    }
}
