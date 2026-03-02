# BiDi Fix for Claude Code - Project Guide

## What This Is

A VS Code/Cursor extension that patches Claude Code's WebView with BiDi (bidirectional text) support for RTL languages like Hebrew, Arabic, Persian, and Yiddish. Claude Code's WebView has a global CSS rule `* { direction: ltr; unicode-bidi: bidi-override }` that kills all BiDi rendering. This extension fixes that.

## How It Works

The extension appends CSS and JS to Claude Code's `webview/index.css` and `webview/index.js`. It does NOT replace or modify the original content - it only appends, wrapped in `/* BIDI-FIX-START */` / `/* BIDI-FIX-END */` markers.

### File Structure

```
extension.js       - Extension host: find Claude Code, patch/unpatch files, auto-apply on startup
bidi/styles.css    - CSS injected into webview/index.css
bidi/content.js    - JS injected into webview/index.js (BiDi engine)
package.json       - Extension manifest
```

### Patching Flow

1. `findClaudeCodeExtension()` locates Claude Code via VS Code API or filesystem scan
2. `createBackup()` backs up original files (`.bidi-backup` suffix)
3. `stripPatchFromFile()` removes any existing patch (for upgrades)
4. `appendPatch()` appends our CSS/JS to the target files
5. On startup, `autoApplyOnStartup()` waits 3 seconds then patches if needed

### Remove Flow

1. `restoreFromBackup()` copies `.bidi-backup` back to original, deletes backup
2. `markAsRemoved()` writes a `.bidi-removed` marker file in Claude Code's webview dir
3. Auto-apply checks this marker and skips if present
4. On extension version update, the marker is cleared so new versions auto-apply

## Key Design Decisions

### Why JS, not CSS-only

CSS `unicode-bidi: plaintext` uses first-strong-character detection, which fails for:
- Mixed content like "REST API - some Hebrew text" (English-first but Hebrew-majority)
- Tables needing column reorder and right-alignment
- Lists needing bullet repositioning
- Headings that should inherit direction from following content

### RTL Detection: Ratio-based with Hysteresis

- `getRTLRatio()` counts RTL characters vs total (excluding punctuation/numbers)
- Threshold to SET RTL: 30% (`RTL_THRESHOLD = 0.3`)
- Threshold to UNSET RTL: 10% (`RTL_THRESHOLD_LOW = 0.1`)
- Hysteresis prevents flickering near the threshold during streaming

### Code Block Exclusion

`getTextExcludingCode()` clones the element, removes all `<pre>` and `<code>` children, then gets textContent. Code is always English and would skew the RTL ratio.

### Heading Context

- Forward: RTL heading forces following siblings to RTL (until next heading)
- Reverse: LTR heading with ANY RTL characters flips to RTL if its next sibling has RTL content

### Debounce

MutationObserver fires `processAll()` with 2000ms debounce. This prevents flickering during streaming responses. True debounce (reset timer on each mutation), not throttle.

### Content Hash for Skip

`needsProcessing()` tracks `textContent.length + childElementCount` per element. Skips re-processing unchanged elements.

### Inline Styles Override Global Rule

Claude Code's `* { unicode-bidi: bidi-override }` has high specificity. We use inline `style.direction`, `style.textAlign`, and `style.unicodeBidi = 'embed'` to override it. CSS `!important` is avoided on properties that JS needs to control.

### User Bubble Alignment

RTL user messages get `container.style.alignItems = 'flex-end'` on the `userMessageContainer_` wrapper.

### Hash-Resilient Selectors

Claude Code uses CSS Modules with hashed class names (e.g., `answerText_hONcXw`). We use `[class*="answerText_"]` patterns that survive version updates.

## What NOT to Change

- Do not add npm dependencies. Zero dependencies is a security feature.
- Do not add network access.
- Do not use `!important` on CSS properties that the JS engine sets inline.
- Do not use `unicode-bidi: plaintext` on inline elements (span, strong, em) - it creates isolated BiDi contexts that break mixed LTR/RTL text.
- Do not process elements inside `<pre>` or `<code>` - code is always LTR.
- Do not reduce the debounce below 1000ms - it causes visible flickering during streaming.
- Do not use in-memory state for the "user removed" flag - it resets on window reload.
- Do not use `globalState` for the "user removed" flag - async update doesn't flush before reload.

## Common Pitfalls

1. `isPatched()` reads the last 16KB of the file. If `content.js` grows beyond 16KB, increase the read window.
2. `registerCommand()` is wrapped in try/catch because commands persist across activations and throw "already exists".
3. The `.bidi-removed` marker lives in Claude Code's webview dir (not our extension dir) so it survives VSIX reinstalls.
4. `applyPatch()` always strips old patch before appending - this ensures VSIX updates actually apply new code.
5. Auto-apply uses `vscode.commands.executeCommand('workbench.action.reloadWindow')` (no popup). Manual Apply uses `promptReload()` (popup with button).

## Testing

Test in Cursor with Claude Code installed. Open Claude Code panel via `Ctrl+Shift+P` > "Claude Code: Open" (NOT Cursor's built-in chat).

Test scenarios:
- First install: auto-apply + auto-reload
- Remove Patch: should not re-apply after reload
- Apply Patch after Remove: should work and re-enable auto-apply
- Claude Code update: patch should auto-reapply
- VSIX update: new code should replace old patch
- Streaming response: minimal flickering, elements should stabilize after streaming ends
- Mixed Hebrew/English content with code blocks, tables, lists, headings

## Logging

All logging goes to the "BiDi Fix" output channel (Output panel dropdown in VS Code/Cursor). No `console.log` calls.

## Publisher

VS Code Marketplace publisher: `Giosolo`
GitHub: `guyslo/bidi-claude-code`
