/**
 * Parsing functions for spec-superflow core engine
 * Ported from spec-superflow/src/parsing/requirement-blocks.ts
 * Ported from spec-superflow/src/parsing/change-parser.ts
 */
/**
 * Regex for requirement headers (### Requirement: Name)
 */
export const REQUIREMENT_HEADER_REGEX = /^###\s*Requirement:\s*(.+)\s*$/i;
/**
 * Normalize a requirement name (trim)
 * Aligned with spec-superflow: only trim, do NOT lowercase
 * (lowercasing loses case information needed for cross-referencing)
 */
export function normalizeRequirementName(name) {
    return name.trim();
}
function normalizeLineEndings(content) {
    return content.replace(/\r\n?/g, '\n');
}
/**
 * Extract the requirements section from a spec file
 * Aligned with spec-superflow: returns structured parts
 */
export function extractRequirementsSection(content) {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split('\n');
    const reqHeaderIndex = lines.findIndex((l) => /^##\s+Requirements\s*$/i.test(l));
    if (reqHeaderIndex === -1) {
        const before = content.trimEnd();
        const headerLine = '## Requirements';
        return {
            before: before ? before + '\n\n' : '',
            headerLine,
            preamble: '',
            bodyBlocks: [],
            after: '\n',
        };
    }
    let endIndex = lines.length;
    for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) {
            endIndex = i;
            break;
        }
    }
    const before = lines.slice(0, reqHeaderIndex).join('\n');
    const headerLine = lines[reqHeaderIndex];
    const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);
    const blocks = [];
    let cursor = 0;
    const preambleLines = [];
    while (cursor < sectionBodyLines.length &&
        !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor])) {
        preambleLines.push(sectionBodyLines[cursor]);
        cursor++;
    }
    while (cursor < sectionBodyLines.length) {
        const headerLineCandidate = sectionBodyLines[cursor];
        const headerMatch = headerLineCandidate.match(REQUIREMENT_HEADER_REGEX);
        if (!headerMatch) {
            cursor++;
            continue;
        }
        const name = normalizeRequirementName(headerMatch[1]);
        cursor++;
        const bodyLines = [headerLineCandidate];
        while (cursor < sectionBodyLines.length &&
            !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]) &&
            !/^##\s+/.test(sectionBodyLines[cursor])) {
            bodyLines.push(sectionBodyLines[cursor]);
            cursor++;
        }
        const raw = bodyLines.join('\n').trimEnd();
        blocks.push({ headerLine: headerLineCandidate, name, raw });
    }
    const after = lines.slice(endIndex).join('\n');
    const preamble = preambleLines.join('\n').trimEnd();
    return {
        before: before.trimEnd() ? before + '\n' : before,
        headerLine,
        preamble,
        bodyBlocks: blocks,
        after: after.startsWith('\n') ? after : '\n' + after,
    };
}
/**
 * Parse requirement blocks from a section body
 */
function parseRequirementBlocksFromSection(sectionBody) {
    if (!sectionBody)
        return [];
    const lines = normalizeLineEndings(sectionBody).split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && !REQUIREMENT_HEADER_REGEX.test(lines[i]))
            i++;
        if (i >= lines.length)
            break;
        const headerLine = lines[i];
        const m = headerLine.match(REQUIREMENT_HEADER_REGEX);
        if (!m) {
            i++;
            continue;
        }
        const name = normalizeRequirementName(m[1]);
        const buf = [headerLine];
        i++;
        while (i < lines.length &&
            !REQUIREMENT_HEADER_REGEX.test(lines[i]) &&
            !/^##\s+/.test(lines[i])) {
            buf.push(lines[i]);
            i++;
        }
        blocks.push({ headerLine, name, raw: buf.join('\n').trimEnd() });
    }
    return blocks;
}
/**
 * Parse removed requirement names from a section body
 */
function parseRemovedNames(sectionBody) {
    if (!sectionBody)
        return [];
    const names = [];
    const lines = normalizeLineEndings(sectionBody).split('\n');
    for (const line of lines) {
        const m = line.match(REQUIREMENT_HEADER_REGEX);
        if (m) {
            names.push(normalizeRequirementName(m[1]));
            continue;
        }
        const bullet = line.match(/^\s*-\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
        if (bullet) {
            names.push(normalizeRequirementName(bullet[1]));
        }
    }
    return names;
}
/**
 * Parse renamed pairs from a section body
 */
function parseRenamedPairs(sectionBody) {
    if (!sectionBody)
        return [];
    const pairs = [];
    const lines = normalizeLineEndings(sectionBody).split('\n');
    let current = {};
    for (const line of lines) {
        const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
        const toMatch = line.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
        if (fromMatch) {
            current.from = normalizeRequirementName(fromMatch[1]);
        }
        else if (toMatch) {
            current.to = normalizeRequirementName(toMatch[1]);
            if (current.from && current.to) {
                pairs.push({ from: current.from, to: current.to });
                current = {};
            }
        }
    }
    return pairs;
}
/**
 * Split top-level ## sections from content
 */
function splitTopLevelSections(content) {
    const lines = content.split('\n');
    const result = {};
    const indices = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^##\s+(.+)$/);
        if (m) {
            indices.push({ title: m[1].trim(), index: i });
        }
    }
    for (let i = 0; i < indices.length; i++) {
        const current = indices[i];
        const next = indices[i + 1];
        const body = lines
            .slice(current.index + 1, next ? next.index : lines.length)
            .join('\n');
        result[current.title] = body;
    }
    return result;
}
/**
 * Get a section by name (case-insensitive)
 */
function getSectionCaseInsensitive(sections, desired) {
    const target = desired.toLowerCase();
    for (const [title, body] of Object.entries(sections)) {
        if (title.toLowerCase() === target)
            return { body, found: true };
    }
    return { body: '', found: false };
}
/**
 * Parse a delta spec markdown into a DeltaPlan
 * Aligned with spec-superflow: uses section-based parsing
 */
export function parseDeltaSpec(content) {
    const normalized = normalizeLineEndings(content);
    const sections = splitTopLevelSections(normalized);
    const addedLookup = getSectionCaseInsensitive(sections, 'ADDED Requirements');
    const modifiedLookup = getSectionCaseInsensitive(sections, 'MODIFIED Requirements');
    const removedLookup = getSectionCaseInsensitive(sections, 'REMOVED Requirements');
    const renamedLookup = getSectionCaseInsensitive(sections, 'RENAMED Requirements');
    const added = parseRequirementBlocksFromSection(addedLookup.body);
    const modified = parseRequirementBlocksFromSection(modifiedLookup.body);
    const removedNames = parseRemovedNames(removedLookup.body);
    const renamedPairs = parseRenamedPairs(renamedLookup.body);
    return {
        added,
        modified,
        removed: removedNames,
        renamed: renamedPairs,
        sectionPresence: {
            added: addedLookup.found,
            modified: modifiedLookup.found,
            removed: removedLookup.found,
            renamed: renamedLookup.found,
        },
    };
}
/**
 * Extract a section by heading from markdown content
 */
function extractSection(content, heading) {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split('\n');
    const headingRegex = new RegExp(`^##\\s+${heading.replace(/\s+/g, '\\s+')}\\s*$`, 'i');
    const idx = lines.findIndex((l) => headingRegex.test(l));
    if (idx === -1)
        return '';
    let endIdx = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) {
            endIdx = i;
            break;
        }
    }
    return lines.slice(idx + 1, endIdx).join('\n').trim();
}
/**
 * Parse a change markdown file
 * Aligned with spec-superflow/src/parsing/change-parser.ts
 */
export function parseChangeMarkdown(content, changeName) {
    const why = extractSection(content, 'Why');
    const whatChanges = extractSection(content, 'What Changes');
    const deltas = [];
    const deltaSectionRegex = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im;
    const sections = content.split(/(?=^##\s)/m);
    for (const section of sections) {
        const match = section.match(deltaSectionRegex);
        if (match) {
            const operation = match[1].toUpperCase();
            const body = section.substring(match[0].length).trim();
            const descLines = [];
            for (const line of body.split('\n')) {
                if (/^###\s+/.test(line))
                    break;
                const trimmed = line.trim();
                if (trimmed)
                    descLines.push(trimmed);
            }
            deltas.push({
                spec: '',
                operation,
                description: descLines.join('\n'),
            });
        }
    }
    return {
        name: changeName,
        why,
        whatChanges,
        deltas,
    };
}
//# sourceMappingURL=requirement-blocks.js.map