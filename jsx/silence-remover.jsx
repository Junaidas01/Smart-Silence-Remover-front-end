function log(msg) {
    $.writeln("[SSR] " + msg);
}

// ─── Sequence Access ──────────────────────────────────────────────────────────

function getActiveSequence() {
    if (!app || !app.project) return null;
    return app.project.activeSequence || null;
}

// ─── Public: Read-Only Metadata (no token required) ──────────────────────────

function getSequenceInfo() {
    try {
        var seq = getActiveSequence();
        if (!seq) {
            return JSON.stringify({ error: "No active sequence found. Please open a sequence in Premiere Pro." });
        }

        var ticksPerSecond = 254016000000;
        var duration       = seq.end;
        var frameRate      = seq.getSettings().videoFrameRate;

        return JSON.stringify({
            name:        seq.name,
            duration:    duration / ticksPerSecond,
            audioTracks: seq.audioTracks.numTracks,
            videoTracks: seq.videoTracks.numTracks,
            fps:         frameRate.seconds > 0 ? (frameRate.ticks / ticksPerSecond) : 0
        });
    } catch (e) {
        return JSON.stringify({ error: "Error reading sequence: " + e.message });
    }
}

// ─── Protected: Clip Path Access (token required) ────────────────────────────

function getSourceClipPaths() {

    try {
        var seq = getActiveSequence();
        if (!seq) return JSON.stringify({ error: "No active sequence." });

        var result = [];
        var tracks = seq.audioTracks;

        for (var t = 0; t < tracks.numTracks; t++) {
            var track = tracks[t];
            if (track.isMuted()) continue;

            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                try {
                    var mediaPath = clip.projectItem.getMediaPath();
                    if (!mediaPath || mediaPath === "") continue;
                    result.push({
                        path:        mediaPath,
                        trackIndex:  t,
                        seqStartSec: clip.start.seconds,
                        seqEndSec:   clip.end.seconds,
                        srcInSec:    clip.inPoint.seconds,
                        srcOutSec:   clip.outPoint.seconds
                    });
                } catch (inner) { /* adjustment layers etc. */ }
            }
        }

        if (result.length === 0) {
            return JSON.stringify({ error: "No media clips found on unmuted audio tracks." });
        }
        return JSON.stringify({ clips: result });

    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}

// ─── Protected: Deletion Engine (token required on every call) ───────────────

function prepareForDeletion() {

    try {
        var seq = getActiveSequence();
        if (!seq) return JSON.stringify({ error: "No active sequence." });

        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return JSON.stringify({ error: "QE sequence access failed. Click the timeline." });

        for (var v = 0; v < seq.videoTracks.numTracks; v++) seq.videoTracks[v].setTargeted(true);
        for (var a = 0; a < seq.audioTracks.numTracks; a++) seq.audioTracks[a].setTargeted(true);

        log("Deletion prepared. Tracks targeted.");
        return JSON.stringify({ success: true });

    } catch (e) {
        return JSON.stringify({ error: "Prepare failed: " + e.message });
    }
}

function deleteSingleRange(startSec, endSec) {

    // Basic sanity check on range values to prevent abuse
    if (typeof startSec !== "number" || typeof endSec !== "number") {
        return JSON.stringify({ error: "Invalid range parameters." });
    }
    if (startSec < 0 || endSec <= startSec || (endSec - startSec) > 3600) {
        return JSON.stringify({ error: "Range out of bounds." });
    }

    try {
        var seq   = getActiveSequence();
        var qeSeq = qe.project.getActiveSequence();
        if (!seq || !qeSeq) return JSON.stringify({ error: "Sequence lost." });

        seq.setInPoint(startSec);
        seq.setOutPoint(endSec);
        qeSeq.extract();

        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ error: "Extraction failed: " + e.message });
    }
}

function finalizeDeletion() {

    try {
        var seq = getActiveSequence();
        if (seq) {
            seq.clearInPoint();
            seq.clearOutPoint();
        }
        log("Deletion finalized.");
        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ error: "Finalize failed: " + e.message });
    }
}

// Deprecated stub — kept so any old cached call doesn't throw a script error
function rippleDeleteRanges() {
    return JSON.stringify({ error: "Deprecated. Use granular deletion API." });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getTempAudioPath() {
    try {
        return JSON.stringify({ path: Folder.temp.fsName + "/ssr_tmp.wav" });
    } catch (e) {
        return JSON.stringify({ path: "C:/Temp/ssr_tmp.wav" });
    }
}

function undoLastOperation() {
    try {
        app.executeCommand(app.findCommandId("Undo"));
        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
