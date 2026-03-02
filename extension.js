// BiDi Fix for Claude Code - VS Code/Cursor Extension
// Patches Claude Code's webview/index.css and webview/index.js with BiDi support.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const MARKER_START = '/* BIDI-FIX-START */';
const MARKER_END = '/* BIDI-FIX-END */';
const BACKUP_SUFFIX = '.bidi-backup';
const REMOVED_SUFFIX = '.bidi-removed';
const LOG_PREFIX = 'BiDi Fix:';

let outputChannel = null;

function log(msg) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('BiDi Fix');
  }
  outputChannel.appendLine('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

// =============================================================================
// File utilities
// =============================================================================

/**
 * Finds the Claude Code extension directory.
 * Tries the VS Code API first, then scans common extension directories.
 */
function findClaudeCodeExtension() {
  try {
    const ext = vscode.extensions.getExtension('anthropic.claude-code');
    if (ext) return ext.extensionPath;
  } catch {}

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const searchPaths = [
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.vscode', 'extensions'),
  ];
  if (process.env.VSCODE_EXTENSIONS) {
    searchPaths.push(process.env.VSCODE_EXTENSIONS);
  }

  for (const dir of searchPaths) {
    try {
      if (!fs.existsSync(dir)) continue;
      const matches = fs.readdirSync(dir)
        .filter(e => e.startsWith('anthropic.claude-code-'))
        .map(e => path.join(dir, e))
        .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })
        .sort().reverse();
      if (matches.length > 0) return matches[0];
    } catch {}
  }
  return null;
}

/**
 * Creates a backup if one doesn't already exist.
 */
function createBackup(filePath) {
  const backupPath = filePath + BACKUP_SUFFIX;
  if (fs.existsSync(backupPath)) return true;
  try {
    fs.copyFileSync(filePath, backupPath);
    return true;
  } catch (error) {
    log('Failed to create backup: ' + filePath + ' - ' + error.message);
    return false;
  }
}

/**
 * Restores a file from its backup and removes the backup.
 */
function restoreFromBackup(filePath) {
  const backupPath = filePath + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) return false;
  try {
    fs.copyFileSync(backupPath, filePath);
    try { fs.unlinkSync(backupPath); } catch (e) { log('Failed to remove backup: ' + e.message); }
    return true;
  } catch (error) {
    log('Failed to restore: ' + filePath + ' - ' + error.message);
    return false;
  }
}

/**
 * Creates a marker file to signal that the user explicitly removed the patch.
 */
function markAsRemoved(extensionPath) {
  const markerPath = path.join(extensionPath, 'webview', REMOVED_SUFFIX);
  try {
    fs.writeFileSync(markerPath, '', 'utf8');
  } catch (err) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Failed to create marker: ' + markerPath + ' - ' + err.message);
  }
}

/**
 * Removes the "user removed" marker, allowing auto-apply to run again.
 */
function clearRemovedMarker(extensionPath) {
  const markerPath = path.join(extensionPath, 'webview', REMOVED_SUFFIX);
  try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}
}

/**
 * Checks if the user has explicitly removed the patch.
 */
function wasRemovedByUser(extensionPath) {
  const markerPath = path.join(extensionPath, 'webview', REMOVED_SUFFIX);
  try { return fs.existsSync(markerPath); } catch { return false; }
}

/**
 * Checks if a file contains our patch marker.
 * Reads only the last 16KB to avoid loading multi-MB files fully.
 */
function isPatched(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 16384);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    return buf.toString('utf8').includes(MARKER_START);
  } catch {
    return false;
  }
}

/**
 * Appends a patch file to a target file.
 */
function appendPatch(targetPath, patchPath, separator) {
  try {
    const patchContent = fs.readFileSync(patchPath, 'utf8');
    fs.appendFileSync(targetPath, (separator || '\n') + patchContent, 'utf8');
    return true;
  } catch (error) {
    log('Failed to patch: ' + targetPath + ' - ' + error.message);
    return false;
  }
}

/**
 * Strips injected content between MARKER_START and MARKER_END from a file.
 * Fallback when backup is unavailable.
 */
function stripPatchFromFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const startIdx = content.lastIndexOf(MARKER_START);
    const endIdx = content.lastIndexOf(MARKER_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return false;
    // Remove from the newline/semicolon before MARKER_START to end of MARKER_END
    let stripFrom = startIdx;
    while (stripFrom > 0 && (content[stripFrom - 1] === '\n' || content[stripFrom - 1] === ';')) {
      stripFrom--;
    }
    const stripTo = endIdx + MARKER_END.length;
    content = content.substring(0, stripFrom) + content.substring(stripTo);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    log('Failed to strip patch from: ' + filePath + ' - ' + error.message);
    return false;
  }
}

// =============================================================================
// Patch operations
// =============================================================================

/**
 * Applies the BiDi patch to Claude Code's webview files.
 */
async function applyPatch() {
  const extensionPath = findClaudeCodeExtension();
  if (!extensionPath) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Could not find Claude Code extension. Is it installed?');
    return false;
  }

  const cssTarget = path.join(extensionPath, 'webview', 'index.css');
  const jsTarget = path.join(extensionPath, 'webview', 'index.js');

  if (!fs.existsSync(cssTarget) || !fs.existsSync(jsTarget)) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Claude Code webview files not found at ' + extensionPath);
    return false;
  }

  // If already patched, strip old patch first (ensures latest code is applied)
  if (isPatched(cssTarget)) {
    stripPatchFromFile(cssTarget);
  }
  if (isPatched(jsTarget)) {
    stripPatchFromFile(jsTarget);
  }

  if (!createBackup(cssTarget) || !createBackup(jsTarget)) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Could not create backups. Check file permissions.');
    return false;
  }

  const cssPatch = path.join(__dirname, 'bidi', 'styles.css');
  const jsPatch = path.join(__dirname, 'bidi', 'content.js');

  if (!fs.existsSync(cssPatch) || !fs.existsSync(jsPatch)) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' BiDi patch files missing from extension.');
    return false;
  }

  let ok = true;
  if (!isPatched(cssTarget)) {
    if (!appendPatch(cssTarget, cssPatch, '\n')) {
      vscode.window.showErrorMessage(LOG_PREFIX + ' Failed to patch CSS file.');
      ok = false;
    }
  }
  if (ok && !isPatched(jsTarget)) {
    if (!appendPatch(jsTarget, jsPatch, '\n;\n')) {
      vscode.window.showErrorMessage(LOG_PREFIX + ' Failed to patch JS file.');
      ok = false;
    }
  }

  if (ok) {
    log('Patch applied to ' + extensionPath);
    clearRemovedMarker(extensionPath);
  }
  return ok;
}

/**
 * Removes the BiDi patch. Tries backup first, falls back to marker-based stripping.
 */
async function removePatch() {
  const extensionPath = findClaudeCodeExtension();
  if (!extensionPath) {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Could not find Claude Code extension.');
    return false;
  }

  log('Removing patch from ' + extensionPath);

  const cssTarget = path.join(extensionPath, 'webview', 'index.css');
  const jsTarget = path.join(extensionPath, 'webview', 'index.js');

  // Try restoring from backups first
  const cssRestored = restoreFromBackup(cssTarget);
  const jsRestored = restoreFromBackup(jsTarget);

  if (cssRestored && jsRestored) {
    log('Restored from backups.');
    markAsRemoved(extensionPath);
    return true;
  }

  // Fallback: strip patch content between markers
  let stripped = false;
  if (!cssRestored && isPatched(cssTarget)) {
    stripped = stripPatchFromFile(cssTarget) || stripped;
  }
  if (!jsRestored && isPatched(jsTarget)) {
    stripped = stripPatchFromFile(jsTarget) || stripped;
  }

  if (stripped) {
    log('Stripped patch using markers.');
    markAsRemoved(extensionPath);
    return true;
  }

  if (!isPatched(cssTarget) && !isPatched(jsTarget)) {
    vscode.window.showInformationMessage(LOG_PREFIX + ' No patch found to remove.');
  } else {
    vscode.window.showErrorMessage(LOG_PREFIX + ' Failed to remove patch.');
  }
  return false;
}

/**
 * Returns the current patch status.
 */
function checkStatus() {
  const extensionPath = findClaudeCodeExtension();
  if (!extensionPath) {
    return { patched: false, message: 'Claude Code extension not found.' };
  }

  const cssTarget = path.join(extensionPath, 'webview', 'index.css');
  const jsTarget = path.join(extensionPath, 'webview', 'index.js');
  const cssPatched = isPatched(cssTarget);
  const jsPatched = isPatched(jsTarget);
  const hasBackup = fs.existsSync(cssTarget + BACKUP_SUFFIX);

  if (cssPatched && jsPatched) {
    return {
      patched: true,
      message: 'BiDi patch is APPLIED.\nClaude Code: ' + extensionPath + '\nBackup: ' + (hasBackup ? 'Yes' : 'No'),
    };
  }
  return {
    patched: false,
    message: 'BiDi patch is NOT applied.\nClaude Code: ' + extensionPath,
  };
}

// =============================================================================
// Extension lifecycle
// =============================================================================

async function promptReload(message) {
  const action = await vscode.window.showInformationMessage(message, 'Reload Window');
  if (action === 'Reload Window') {
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

function registerCommand(context, id, handler) {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  } catch {
    // Command may already exist from a previous activation
  }
}

function activate(context) {
  log('Activating...');

  registerCommand(context, 'bidi-claude-code.apply', async () => {
    try {
      const success = await applyPatch();
      if (success) {
        await promptReload('BiDi Fix applied to Claude Code! Reload window to activate.');
      }
    } catch (error) {
      vscode.window.showErrorMessage(LOG_PREFIX + ' ' + error.message);
    }
  });

  registerCommand(context, 'bidi-claude-code.remove', async () => {
    try {
      const success = await removePatch();
      if (success) {
        vscode.window.showInformationMessage(LOG_PREFIX + ' Patch removed.');
      }
    } catch (error) {
      vscode.window.showErrorMessage(LOG_PREFIX + ' ' + error.message);
    }
  });

  registerCommand(context, 'bidi-claude-code.status', () => {
    try {
      const status = checkStatus();
      const extensionPath = findClaudeCodeExtension();
      const removed = extensionPath && wasRemovedByUser(extensionPath);
      const extra = removed ? '\nAuto-apply: Disabled (use Apply command to re-enable)' : '';
      if (status.patched) {
        vscode.window.showInformationMessage(status.message + extra);
      } else {
        vscode.window.showWarningMessage(status.message + extra);
      }
    } catch (error) {
      vscode.window.showErrorMessage(LOG_PREFIX + ' ' + error.message);
    }
  });

  autoApplyOnStartup(context);
}

async function autoApplyOnStartup(context) {
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const status = checkStatus();
    if (status.patched) {
      log('Patch already applied.');
      return;
    }

    const extensionPath = findClaudeCodeExtension();
    if (!extensionPath) {
      log('Claude Code not found, skipping auto-apply.');
      return;
    }

    // On fresh install or version update, clear any old "removed" marker
    const currentVersion = require('./package.json').version;
    const lastVersion = context.globalState.get('version');
    if (lastVersion !== currentVersion) {
      context.globalState.update('version', currentVersion);
      clearRemovedMarker(extensionPath);
    }

    // If user explicitly removed the patch, don't re-apply automatically
    if (wasRemovedByUser(extensionPath)) {
      log('Patch was removed by user, skipping auto-apply.');
      return;
    }

    log('Auto-applying patch...');
    const success = await applyPatch();
    if (success) {
      log('Reloading window to activate patch...');
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (error) {
    log('Auto-apply failed: ' + error.message);
  }
}

function deactivate() {
  log('Deactivated.');
}

module.exports = { activate, deactivate };
