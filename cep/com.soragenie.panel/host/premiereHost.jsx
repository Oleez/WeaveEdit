var weaveEdit = (function () {
  var TICKS_PER_SECOND = 254016000000;

  function getJson() {
    if (typeof JSON !== "undefined" && JSON && JSON.stringify && JSON.parse) {
      return JSON;
    }

    return {
      stringify: function (value) {
        return value.toSource();
      },
      parse: function (value) {
        return eval("(" + value + ")");
      }
    };
  }

  function stringify(value) {
    return getJson().stringify(value);
  }

  function parse(value) {
    return getJson().parse(value);
  }

  function normalizePath(filePath) {
    return String(filePath || "").replace(/\\/g, "/");
  }

  function secondsToTicks(seconds) {
    return String(Math.round(Number(seconds) * TICKS_PER_SECOND));
  }

  function makeTime(seconds) {
    var time = new Time();
    time.seconds = Number(seconds);
    return time;
  }

  function fail(message, details) {
    return stringify({
      ok: false,
      connected: true,
      message: message,
      details: details || [],
      placedCount: 0,
      blankCount: 0,
      importedCount: 0,
      appendOffsetSec: 0,
      skippedCount: 0,
      clippedCount: 0,
      workingRangeStartSec: 0,
      workingRangeEndSec: 0
    });
  }

  function readTextFile(filePath) {
    var file = new File(filePath);
    file.encoding = "UTF8";

    if (!file.exists) {
      throw new Error("Missing job file: " + filePath);
    }

    if (!file.open("r")) {
      throw new Error("Could not open job file: " + filePath);
    }

    var contents = file.read();
    file.close();
    return contents;
  }

  function selectFolderPath() {
    try {
      var folder = Folder.selectDialog("Choose media folder");
      if (!folder) {
        return stringify({
          status: "cancelled",
          path: null
        });
      }

      return stringify({
        status: "selected",
        path: normalizePath(folder.fsName)
      });
    } catch (error) {
      return stringify({
        status: "dialog_error",
        path: null,
        message: error.message || String(error)
      });
    }
  }

  function getTrackEndSec(track) {
    if (!track || !track.clips || track.clips.numItems < 1) {
      return 0;
    }

    return Number(track.clips[track.clips.numItems - 1].end.seconds || 0);
  }

  function getSequenceFrameRate(sequence) {
    try {
      var timebase = Number(sequence && sequence.timebase);
      if (timebase > 0) {
        return Math.round((TICKS_PER_SECOND / timebase) * 100) / 100;
      }
    } catch (error) {
      // Fall back below.
    }

    return 30;
  }

  function getRangeStatus(sequence) {
    var inTime = sequence && sequence.getInPointAsTime ? sequence.getInPointAsTime() : null;
    var outTime = sequence && sequence.getOutPointAsTime ? sequence.getOutPointAsTime() : null;
    var inSec = inTime ? Number(inTime.seconds || 0) : 0;
    var outSec = outTime ? Number(outTime.seconds || 0) : 0;
    var sequenceEndSec = sequence && sequence.end ? Number(sequence.end) / TICKS_PER_SECOND : 0;
    var hasMeaningfulInOut = inSec > 0.0001 || (outSec > 0 && outSec < sequenceEndSec - 0.0001);

    return {
      inSec: inSec,
      outSec: outSec,
      sequenceEndSec: sequenceEndSec,
      hasMeaningfulInOut: hasMeaningfulInOut
    };
  }

  function resolveActiveSequence() {
    if (!app || !app.project) {
      return null;
    }

    try {
      var active = app.project.activeSequence;
      if (active) {
        return active;
      }
    } catch (error) {
      // Fall through — some Premiere builds throw when no timeline tab is frontmost.
    }

    return null;
  }

  function getSequenceIdentity(sequence) {
    if (!sequence) {
      return { id: null, name: "" };
    }

    var id = "";
    var name = "";
    try {
      name = sequence.name || "";
    } catch (error) {
      name = "";
    }
    try {
      id = sequence.sequenceID || "";
    } catch (error) {
      id = "";
    }
    if (!id) {
      try {
        if (sequence.projectItem && sequence.projectItem.nodeId) {
          id = String(sequence.projectItem.nodeId);
        }
      } catch (error2) {
        id = "";
      }
    }
    if (!id && name) {
      id = "name:" + name;
    }

    return { id: id || null, name: name };
  }

  function getProjectIdentity() {
    if (!app || !app.project) {
      return { id: null, path: null };
    }

    var projectPath = "";
    var projectId = "";
    try {
      projectPath = app.project.path || "";
    } catch (error) {
      projectPath = "";
    }
    try {
      projectId = app.project.documentID || "";
    } catch (error) {
      projectId = "";
    }
    if (!projectId && projectPath) {
      projectId = "path:" + normalizePath(projectPath);
    }

    return {
      id: projectId || null,
      path: projectPath ? normalizePath(projectPath) : null
    };
  }

  function getStatus() {
    var identity = getProjectIdentity();
    if (!app || !app.project) {
      return stringify({
        ok: false,
        connected: true,
        projectId: identity.id,
        projectPath: identity.path,
        projectName: "",
        sequenceName: "",
        sequenceId: null,
        videoTracks: [],
      frameRate: 30,
        range: {
          inSec: 0,
          outSec: 0,
          sequenceEndSec: 0,
          hasMeaningfulInOut: false
        },
        message: "Premiere project is not available."
      });
    }

    var sequence = resolveActiveSequence();
    if (!sequence) {
      return stringify({
        ok: false,
        connected: true,
        projectId: identity.id,
        projectPath: identity.path,
        projectName: app.project.name || "",
        sequenceName: "",
        sequenceId: null,
        videoTracks: [],
        frameRate: 30,
        range: {
          inSec: 0,
          outSec: 0,
          sequenceEndSec: 0,
          hasMeaningfulInOut: false
        },
        message: "Click a sequence tab in the Premiere timeline — Weave follows whichever tab is active."
      });
    }

    var sequenceIdentity = getSequenceIdentity(sequence);
    var range = getRangeStatus(sequence);
    var videoTracks = [];
    for (var index = 0; index < sequence.videoTracks.numTracks; index += 1) {
      videoTracks.push({
        index: index,
        name: sequence.videoTracks[index].name || ("V" + (index + 1)),
        endSec: getTrackEndSec(sequence.videoTracks[index])
      });
    }

    return stringify({
      ok: true,
      connected: true,
      projectId: identity.id,
      projectPath: identity.path,
      projectName: app.project.name || "",
      sequenceName: sequenceIdentity.name,
      sequenceId: sequenceIdentity.id,
      videoTracks: videoTracks,
      range: range,
      frameRate: getSequenceFrameRate(sequence)
    });
  }

  function getPlayheadPosition() {
    try {
      var sequence = resolveActiveSequence();
      if (!sequence) {
        return "0";
      }

      // Premiere exposes the current time indicator via getPlayerPosition() (a Time
      // object) on most versions. Fall back gracefully when the API is absent.
      if (sequence.getPlayerPosition) {
        var position = sequence.getPlayerPosition();
        if (position && typeof position.seconds !== "undefined") {
          return String(Number(position.seconds) || 0);
        }
        if (position && typeof position.ticks !== "undefined") {
          return String((Number(position.ticks) || 0) / TICKS_PER_SECOND);
        }
      }
    } catch (error) {
      // Fall through to 0 below.
    }

    return "0";
  }

  function getTranscriptSegments() {
    var sequence = resolveActiveSequence();
    if (!sequence) {
      return stringify([]);
    }
    var markers = sequence.markers;
    var segments = [];

    if (!markers || !markers.getFirstMarker) {
      return stringify(segments);
    }

    var marker = markers.getFirstMarker();
    var index = 0;

    while (marker) {
      var text = String(marker.comments || marker.name || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (text) {
        var startSec = marker.start ? Number(marker.start.seconds || 0) : 0;
        var endSec = null;

        try {
          if (marker.end) {
            endSec = Number(marker.end.seconds || 0);
            if (!isFinite(endSec) || endSec <= startSec) {
              endSec = null;
            }
          }
        } catch (error) {
          endSec = null;
        }

        segments.push({
          id: "marker-" + (index + 1),
          startSec: startSec,
          endSec: endSec,
          text: text
        });
        index += 1;
      }

      marker = markers.getNextMarker(marker);
    }

    return stringify(segments);
  }

  function getAudioClips() {
    var sequence = resolveActiveSequence();
    if (!sequence) {
      return stringify([]);
    }
    var clips = [];

    for (var trackIndex = 0; trackIndex < sequence.audioTracks.numTracks; trackIndex += 1) {
      var track = sequence.audioTracks[trackIndex];
      if (!track || !track.clips) {
        continue;
      }

      for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex += 1) {
        var clip = track.clips[clipIndex];
        var mediaPath = "";

        try {
          if (clip.projectItem && clip.projectItem.getMediaPath) {
            mediaPath = normalizePath(clip.projectItem.getMediaPath());
          }
        } catch (error) {
          mediaPath = "";
        }

        if (!mediaPath) {
          continue;
        }

        clips.push({
          id: "audio-" + (trackIndex + 1) + "-" + (clipIndex + 1),
          trackIndex: trackIndex,
          name: clip.name || (clip.projectItem ? clip.projectItem.name : "Audio clip"),
          mediaPath: mediaPath,
          startSec: Number(clip.start.seconds || 0),
          endSec: Number(clip.end.seconds || 0),
          inPointSec: clip.inPoint ? Number(clip.inPoint.seconds || 0) : 0
        });
      }
    }

    return stringify(clips);
  }

  function findProjectItemByPath(projectItem, normalizedTargetPath) {
    if (!projectItem) {
      return null;
    }

    try {
      if (projectItem.getMediaPath) {
        var mediaPath = projectItem.getMediaPath();
        if (mediaPath && normalizePath(mediaPath) === normalizedTargetPath) {
          return projectItem;
        }
      }
    } catch (error) {
      // Skip synthetic items that do not expose a real media path.
    }

    if (projectItem.children && projectItem.children.numItems) {
      for (var index = 0; index < projectItem.children.numItems; index += 1) {
        var childResult = findProjectItemByPath(projectItem.children[index], normalizedTargetPath);
        if (childResult) {
          return childResult;
        }
      }
    }

    return null;
  }

  function getOrImportProjectItems(mediaPaths, details) {
    var root = app.project.rootItem;
    var insertionBin = app.project.getInsertionBin ? app.project.getInsertionBin() : root;
    var itemsByPath = {};
    var missingPaths = [];
    var importedCount = 0;

    for (var index = 0; index < mediaPaths.length; index += 1) {
      var normalizedPath = normalizePath(mediaPaths[index]);
      var existingItem = findProjectItemByPath(root, normalizedPath);

      if (existingItem) {
        itemsByPath[normalizedPath] = existingItem;
      } else {
        missingPaths.push(normalizedPath);
      }
    }

    if (missingPaths.length > 0) {
      var importResult = app.project.importFiles(missingPaths, true, insertionBin || root, false);
      if (!importResult) {
        details.push("Premiere reported a media import failure.");
      }

      importedCount = missingPaths.length;
    }

    for (var verifyIndex = 0; verifyIndex < mediaPaths.length; verifyIndex += 1) {
      var verifyPath = normalizePath(mediaPaths[verifyIndex]);
      if (!itemsByPath[verifyPath]) {
        var importedItem = findProjectItemByPath(root, verifyPath);
        if (importedItem) {
          itemsByPath[verifyPath] = importedItem;
        } else {
          details.push("Could not find imported item for " + verifyPath);
        }
      }
    }

    return {
      itemsByPath: itemsByPath,
      importedCount: importedCount
    };
  }

  function findPlacedTrackItem(track, projectItem, expectedStartSec) {
    for (var index = track.clips.numItems - 1; index >= 0; index -= 1) {
      var clip = track.clips[index];
      var startDiff = Math.abs(Number(clip.start.seconds) - expectedStartSec);

      if (clip.projectItem && clip.projectItem.nodeId === projectItem.nodeId && startDiff < 0.5) {
        return clip;
      }
    }

    return null;
  }

  function hasTrackCollision(track, startSec, endSec) {
    if (!track || !track.clips) {
      return false;
    }

    for (var index = 0; index < track.clips.numItems; index += 1) {
      var clip = track.clips[index];
      var clipStart = Number(clip.start.seconds || 0);
      var clipEnd = Number(clip.end.seconds || 0);
      if (clipEnd > startSec && clipStart < endSec) {
        return true;
      }
    }

    return false;
  }

  function runJobFromFile(filePath) {
    try {
      var rawJob = readTextFile(filePath);
      var job = parse(rawJob);
      return runJob(job);
    } catch (error) {
      return fail(error.message || String(error));
    }
  }

  function runJob(job) {
    if (!app || !app.project) {
      return fail("Premiere project is not available.");
    }

    var sequence = resolveActiveSequence();
    if (!sequence) {
      return fail("Click a sequence tab in the Premiere timeline first.");
    }

    var targetTrackIndex = Number(job.targetVideoTrackIndex || 0);
    if (targetTrackIndex < 0 || targetTrackIndex >= sequence.videoTracks.numTracks) {
      return fail("Target video track does not exist. Add the track in Premiere first.");
    }

    var targetTrack = sequence.videoTracks[targetTrackIndex];
    var details = [];
    var mediaPaths = [];
    var placementIndex;

    for (placementIndex = 0; placementIndex < job.placements.length; placementIndex += 1) {
      var placement = job.placements[placementIndex];
      if (placement.mediaPath) {
        mediaPaths.push(normalizePath(placement.mediaPath));
      }
    }

    var importState = getOrImportProjectItems(mediaPaths, details);
    var itemsByPath = importState.itemsByPath;
    var range = getRangeStatus(sequence);
    var appendOffsetSec = job.appendAtTrackEnd ? getTrackEndSec(targetTrack) : 0;
    var useSequenceInOut = Boolean(job.useSequenceInOut);
    var workingRangeStartSec = useSequenceInOut && range.hasMeaningfulInOut
      ? Number(job.rangeStartSec || range.inSec || 0)
      : 0;
    var workingRangeEndSec = useSequenceInOut && range.hasMeaningfulInOut
      ? Number(job.rangeEndSec || range.outSec || range.sequenceEndSec || 0)
      : range.sequenceEndSec;
    var placedCount = 0;
    var blankCount = 0;
    var skippedCount = 0;
    var clippedCount = 0;

    for (placementIndex = 0; placementIndex < job.placements.length; placementIndex += 1) {
      var currentPlacement = job.placements[placementIndex];
      var trackOffset = Number(currentPlacement.trackOffset || 0);
      var resolvedTrackIndex = targetTrackIndex + trackOffset;
      if (resolvedTrackIndex < 0 || resolvedTrackIndex >= sequence.videoTracks.numTracks) {
        details.push("Skipped " + currentPlacement.id + " because V" + (resolvedTrackIndex + 1) + " does not exist.");
        continue;
      }

      var resolvedTrack = sequence.videoTracks[resolvedTrackIndex];
      var durationSec = Math.max(0.3, Number(currentPlacement.durationSec || 0));
      var requestedStartSec = appendOffsetSec + Number(currentPlacement.startSec || 0);
      var requestedEndSec = appendOffsetSec + Number(currentPlacement.endSec || (currentPlacement.startSec + durationSec));
      var startSec = requestedStartSec;
      var endSec = requestedEndSec;
      var sourceInSec = isFinite(Number(currentPlacement.sourceInSec))
        ? Math.max(0, Number(currentPlacement.sourceInSec))
        : 0;

      if (useSequenceInOut && range.hasMeaningfulInOut) {
        if (requestedEndSec <= workingRangeStartSec || requestedStartSec >= workingRangeEndSec) {
          skippedCount += 1;
          details.push("Skipped " + currentPlacement.id + " because it falls outside the active In/Out range.");
          continue;
        }

        startSec = Math.max(requestedStartSec, workingRangeStartSec);
        endSec = Math.min(requestedEndSec, workingRangeEndSec);
        durationSec = Math.max(0.3, endSec - startSec);

        if (startSec !== requestedStartSec || endSec !== requestedEndSec) {
          clippedCount += 1;
        }
      }

      sourceInSec = Math.max(0, sourceInSec + Math.max(0, startSec - requestedStartSec));

      if (trackOffset > 0 && hasTrackCollision(resolvedTrack, startSec, endSec)) {
        details.push("Skipped " + currentPlacement.id + " because overlap track V" + (resolvedTrackIndex + 1) + " already has media in that range.");
        continue;
      }

      if (!currentPlacement.mediaPath || currentPlacement.strategy === "blank") {
        blankCount += 1;
        continue;
      }

      var projectItem = itemsByPath[normalizePath(currentPlacement.mediaPath)];
      if (!projectItem) {
        blankCount += 1;
        details.push("Missing media for placement " + currentPlacement.id);
        continue;
      }

      try {
        var sourceOutSec = isFinite(Number(currentPlacement.sourceOutSec)) && Number(currentPlacement.sourceOutSec) > sourceInSec
          ? Number(currentPlacement.sourceOutSec)
          : sourceInSec + durationSec;

        if (sourceOutSec - sourceInSec < durationSec - 0.001) {
          sourceOutSec = sourceInSec + durationSec;
        }

        if (projectItem.setInPoint) {
          projectItem.setInPoint(sourceInSec, 4);
        }

        if (projectItem.setOutPoint) {
          projectItem.setOutPoint(sourceOutSec, 4);
        }

        resolvedTrack.overwriteClip(projectItem, secondsToTicks(startSec));

        var trackItem = findPlacedTrackItem(resolvedTrack, projectItem, startSec);
        if (trackItem) {
          trackItem.end = makeTime(startSec + durationSec);
        }

        placedCount += 1;
      } catch (error) {
        blankCount += 1;
        details.push("Failed to place " + projectItem.name + ": " + (error.message || String(error)));
      }
    }

    return stringify({
      ok: true,
      message: "Placed " + placedCount + " media clips on V" + (targetTrackIndex + 1) + ".",
      placedCount: placedCount,
      blankCount: blankCount,
      importedCount: importState.importedCount,
      appendOffsetSec: appendOffsetSec,
      skippedCount: skippedCount,
      clippedCount: clippedCount,
      workingRangeStartSec: workingRangeStartSec,
      workingRangeEndSec: workingRangeEndSec,
      details: details
    });
  }

  function applySilenceCleanupFromFile(filePath) {
    try {
      var rawJob = readTextFile(filePath);
      var job = parse(rawJob);
      return applySilenceCleanup(job);
    } catch (error) {
      return stringify({
        ok: false,
        message: error.message || String(error),
        markerCount: 0,
        details: []
      });
    }
  }

  function applySilenceCleanup(job) {
    var sequence = resolveActiveSequence();
    if (!sequence) {
      return stringify({
        ok: false,
        message: "Open or activate a sequence first.",
        markerCount: 0,
        details: []
      });
    }

    var markers = sequence.markers;
    var details = [];
    var markerCount = 0;
    var spans = job.spans || [];

    if (!markers || !markers.createMarker) {
      return stringify({
        ok: false,
        message: "This Premiere version does not expose sequence markers to the panel.",
        markerCount: 0,
        details: ["Detected " + spans.length + " silent spans, but could not mark them automatically."]
      });
    }

    for (var index = 0; index < spans.length; index += 1) {
      var span = spans[index];
      try {
        var marker = markers.createMarker(Number(span.startSec || 0));
        marker.name = "Weave Edit silence";
        marker.comments = "Silent span on A" + (Number(span.trackIndex || 0) + 1) + ": " +
          Number(span.startSec || 0).toFixed(2) + "s - " + Number(span.endSec || 0).toFixed(2) +
          "s. Ripple delete this range after review.";
        if (marker.end) {
          marker.end = makeTime(Number(span.endSec || span.startSec || 0));
        }
        markerCount += 1;
      } catch (error) {
        details.push("Could not mark silence " + (index + 1) + ": " + (error.message || String(error)));
      }
    }

    return stringify({
      ok: true,
      message: "Marked " + markerCount + " silent spans for timeline cleanup. Review the markers, then ripple delete those ranges in Premiere.",
      markerCount: markerCount,
      details: details
    });
  }

  function readBridgeJob(filePath) {
    return parse(readTextFile(filePath));
  }

  function applyShortsMarkersFromFile(filePath) {
    try {
      var job = readBridgeJob(filePath) || {};
      var sequence = resolveActiveSequence();
      if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      if (!sequence.markers || !sequence.markers.createMarker) {
        return bridgeFail(new Error("This Premiere version does not expose sequence markers to the panel."));
      }

      var shorts = job.shorts || [];
      var details = [];
      var added = 0;
      for (var index = 0; index < shorts.length; index += 1) {
        var short = shorts[index] || {};
        try {
          var startSec = Number(short.startSec || 0);
          var endSec = Number(short.endSec || startSec);
          var marker = sequence.markers.createMarker(startSec);
          marker.name = String(short.markerName || ("Weave Short " + (index + 1)));
          marker.comments = String(short.markerComment || "");
          try {
            marker.end = makeTime(endSec);
          } catch (endError) {}
          try {
            marker.setColorByIndex(1);
          } catch (colorError) {}
          added += 1;
        } catch (markerError) {
          details.push("Could not mark short " + (index + 1) + ": " + (markerError.message || String(markerError)));
        }
      }
      details.unshift("Added " + added + " short marker(s).");
      return bridgeOk("Created " + added + " short marker(s).", details);
    } catch (error) {
      return bridgeFail(error);
    }
  }

  function bridgeOk(message, details) {
    return stringify({
      ok: true,
      message: message,
      details: details || []
    });
  }

  function bridgeFail(error) {
    return stringify({
      ok: false,
      message: error.message || String(error),
      details: []
    });
  }

  function findComponentByName(trackItem, needle) {
    if (!trackItem || !trackItem.components) {
      return null;
    }
    var lowered = String(needle).toLowerCase();
    for (var index = 0; index < trackItem.components.numItems; index += 1) {
      var component = trackItem.components[index];
      var label = String(component.displayName || component.matchName || "").toLowerCase();
      if (label.indexOf(lowered) !== -1) {
        return component;
      }
    }
    return null;
  }

  function findPropertyByName(component, needle) {
    if (!component || !component.properties) {
      return null;
    }
    var lowered = String(needle).toLowerCase();
    for (var index = 0; index < component.properties.numItems; index += 1) {
      var property = component.properties[index];
      var label = String(property.displayName || property.matchName || "").toLowerCase();
      if (label.indexOf(lowered) !== -1) {
        return property;
      }
    }
    return null;
  }

  function trySetAudioLevel(trackItem, value) {
    var volume = findComponentByName(trackItem, "volume");
    if (!volume) {
      return false;
    }
    var levelProperty = findPropertyByName(volume, "level") || (volume.properties && volume.properties.numItems > 0 ? volume.properties[0] : null);
    if (!levelProperty || !levelProperty.setValue) {
      return false;
    }
    try {
      levelProperty.setValue(value, 1);
      return true;
    } catch (error) {
      return false;
    }
  }

  function addAudioKeyframe(trackItem, timeSec, value) {
    var volume = findComponentByName(trackItem, "volume");
    if (!volume) {
      return false;
    }
    var levelProperty = findPropertyByName(volume, "level") || (volume.properties && volume.properties.numItems > 0 ? volume.properties[0] : null);
    if (!levelProperty) {
      return false;
    }
    try {
      if (levelProperty.setTimeVarying) {
        levelProperty.setTimeVarying(true);
      }
      if (levelProperty.addKey) {
        levelProperty.addKey(timeSec);
      }
      if (levelProperty.setValueAtKey) {
        levelProperty.setValueAtKey(timeSec, value, 1);
        return true;
      }
    } catch (error) {
      // fall through
    }
    return false;
  }

  function dbToPremiereLevel(db) {
    // Premiere clip Volume levels are encoded as a 0..1 normalized fader where
    // 0.5 == 0 dB and ~0.7 == +6 dB. Use the well-known curve published in the SDK.
    var clamped = Math.max(-96, Math.min(15, Number(db)));
    return Math.max(0, Math.min(1, Math.exp((clamped - 0) / 20) * 0.5));
  }

  function getAudioTrackClips(trackIndex) {
    var sequence = resolveActiveSequence();
    if (!sequence) {
      return [];
    }
    if (!sequence.audioTracks || trackIndex < 0 || trackIndex >= sequence.audioTracks.numTracks) {
      return [];
    }
    var track = sequence.audioTracks[trackIndex];
    var clips = [];
    if (track && track.clips) {
      for (var index = 0; index < track.clips.numItems; index += 1) {
        clips.push(track.clips[index]);
      }
    }
    return clips;
  }

  function noteOnSequence(sequence, timeSec, name, comment) {
    try {
      if (sequence && sequence.markers && sequence.markers.createMarker) {
        var marker = sequence.markers.createMarker(Number(timeSec || 0));
        marker.name = name || "Weave Edit";
        marker.comments = comment || "";
        return true;
      }
    } catch (error) {
      // ignore
    }
    return false;
  }

  function applyAudioPolishFromFile(filePath) {
    try {
      var actions = readBridgeJob(filePath) || [];
      var sequence = resolveActiveSequence();
    if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      var details = [];
      var appliedCount = 0;
      var fallbackCount = 0;

      for (var index = 0; index < actions.length; index += 1) {
        var action = actions[index];

        if (action.kind === "normalize_loudness") {
          var trackIndex = Math.max(0, Number(action.trackIndex || 0));
          var targetDb = Number(action.targetLufs || -14);
          // Conservative: cap normalization gain to +/- 6 dB so we never blow speakers.
          var targetGainDb = Math.max(-12, Math.min(6, -14 - targetDb + 6));
          var encodedLevel = dbToPremiereLevel(targetGainDb);
          var clips = getAudioTrackClips(trackIndex);
          var perClipApplied = 0;
          for (var clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
            if (trySetAudioLevel(clips[clipIndex], encodedLevel)) {
              perClipApplied += 1;
            }
          }
          if (perClipApplied > 0) {
            appliedCount += 1;
            details.push("Normalized A" + (trackIndex + 1) + " on " + perClipApplied + " clip(s) toward " + targetDb + " LUFS (gain " + targetGainDb.toFixed(1) + " dB).");
          } else if (noteOnSequence(sequence, 0, "Weave Edit normalize", "Target " + targetDb + " LUFS on A" + (trackIndex + 1) + ". Apply Loudness Radar to confirm.")) {
            fallbackCount += 1;
            details.push("Normalize fallback: marker added (A" + (trackIndex + 1) + " target " + targetDb + " LUFS).");
          }
          continue;
        }

        if (action.kind === "duck_under_voice") {
          var musicIndex = Math.max(0, Number(action.musicTrackIndex || 0));
          var voiceIndex = Math.max(0, Number(action.voiceTrackIndex || 0));
          var duckDb = Number(action.duckDb || -9);
          var voiceClips = getAudioTrackClips(voiceIndex);
          var musicClips = getAudioTrackClips(musicIndex);
          var duckedLevel = dbToPremiereLevel(duckDb);
          var normalLevel = dbToPremiereLevel(0);
          var duckCount = 0;
          for (var voiceClipIndex = 0; voiceClipIndex < voiceClips.length; voiceClipIndex += 1) {
            var voiceClip = voiceClips[voiceClipIndex];
            var startSec = Number(voiceClip.start && voiceClip.start.seconds);
            var endSec = Number(voiceClip.end && voiceClip.end.seconds);
            for (var musicClipIndex = 0; musicClipIndex < musicClips.length; musicClipIndex += 1) {
              var musicClip = musicClips[musicClipIndex];
              if (addAudioKeyframe(musicClip, startSec - 0.15, normalLevel) &&
                  addAudioKeyframe(musicClip, startSec, duckedLevel) &&
                  addAudioKeyframe(musicClip, endSec, duckedLevel) &&
                  addAudioKeyframe(musicClip, endSec + 0.25, normalLevel)) {
                duckCount += 1;
              }
            }
          }
          if (duckCount > 0) {
            appliedCount += 1;
            details.push("Ducked A" + (musicIndex + 1) + " under voice A" + (voiceIndex + 1) + " across " + duckCount + " span(s) at " + duckDb + " dB.");
          } else if (noteOnSequence(sequence, 0, "Weave Edit duck", "Duck A" + (musicIndex + 1) + " under voice A" + (voiceIndex + 1) + " by " + duckDb + " dB.")) {
            fallbackCount += 1;
            details.push("Duck fallback: marker added (music A" + (musicIndex + 1) + " under voice A" + (voiceIndex + 1) + ").");
          }
          continue;
        }

        if (action.kind === "set_audio_level") {
          var levelTrackIndex = Math.max(0, Number(action.trackIndex || 0));
          var keyframes = action.dbKeyframes || [];
          var levelClips = getAudioTrackClips(levelTrackIndex);
          var keyApplied = 0;
          for (var levelClipIndex = 0; levelClipIndex < levelClips.length; levelClipIndex += 1) {
            for (var kfIndex = 0; kfIndex < keyframes.length; kfIndex += 1) {
              var kf = keyframes[kfIndex];
              if (addAudioKeyframe(levelClips[levelClipIndex], Number(kf.timeSec || 0), dbToPremiereLevel(Number(kf.db || 0)))) {
                keyApplied += 1;
              }
            }
          }
          if (keyApplied > 0) {
            appliedCount += 1;
            details.push("Set " + keyApplied + " audio keyframes on A" + (levelTrackIndex + 1) + ".");
          }
        }
      }

      return bridgeOk("Audio polish: applied " + appliedCount + " action(s), " + fallbackCount + " marker fallback(s).", details);
    } catch (error) {
      return bridgeFail(error);
    }
  }

  function srtTimecode(seconds) {
    var totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    var ms = totalMs % 1000;
    var totalSec = Math.floor(totalMs / 1000);
    var sec = totalSec % 60;
    var totalMin = Math.floor(totalSec / 60);
    var min = totalMin % 60;
    var hr = Math.floor(totalMin / 60);
    function pad(value, length) {
      var output = String(value);
      while (output.length < length) {
        output = "0" + output;
      }
      return output;
    }
    return pad(hr, 2) + ":" + pad(min, 2) + ":" + pad(sec, 2) + "," + pad(ms, 3);
  }

  function buildSrtForCaptionRun(action) {
    var words = action.words || [];
    if (words.length === 0) {
      return null;
    }
    // Chunk into 3-5 word phrases so captions are readable.
    var lines = [];
    var phraseStart = words[0].startSec;
    var phraseEnd = words[0].endSec;
    var phraseText = words[0].word;
    var phraseSize = 1;
    for (var index = 1; index < words.length; index += 1) {
      var word = words[index];
      var endsPhrase = phraseSize >= 4 || /[.!?,]$/.test(phraseText) || (word.startSec - phraseEnd) > 0.4;
      if (endsPhrase) {
        lines.push({ start: phraseStart, end: phraseEnd, text: phraseText });
        phraseStart = word.startSec;
        phraseEnd = word.endSec;
        phraseText = word.word;
        phraseSize = 1;
      } else {
        phraseText += " " + word.word;
        phraseEnd = word.endSec;
        phraseSize += 1;
      }
    }
    lines.push({ start: phraseStart, end: phraseEnd, text: phraseText });

    var output = [];
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      var line = lines[lineIndex];
      output.push(String(lineIndex + 1));
      output.push(srtTimecode(line.start) + " --> " + srtTimecode(Math.max(line.end, line.start + 0.4)));
      output.push(line.text);
      output.push("");
    }
    return output.join("\n");
  }

  function writeTempFile(extension, contents) {
    var folder = Folder.temp;
    var fileName = "weave-edit-" + new Date().getTime() + "-" + Math.floor(Math.random() * 99999) + "." + extension;
    var file = new File(folder.fsName + "/" + fileName);
    file.encoding = "UTF8";
    if (!file.open("w")) {
      throw new Error("Could not open temp file for write: " + file.fsName);
    }
    file.write(contents);
    file.close();
    return file.fsName;
  }

  function ensureCaptionTrack(sequence) {
    // Use the highest video track index above the active set as the caption deck.
    var captionTrackIndex = sequence.videoTracks.numTracks - 1;
    return {
      track: sequence.videoTracks[captionTrackIndex],
      index: captionTrackIndex
    };
  }

  function applyCaptionsFromFile(filePath) {
    try {
      var actions = readBridgeJob(filePath) || [];
      var sequence = resolveActiveSequence();
    if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      var details = [];
      var imported = 0;
      var placed = 0;
      var fallback = 0;

      for (var index = 0; index < actions.length; index += 1) {
        var srt = buildSrtForCaptionRun(actions[index]);
        if (!srt) {
          continue;
        }
        try {
          var srtPath = writeTempFile("srt", srt);
          var importedOk = app.project.importFiles ? app.project.importFiles([srtPath], 1, app.project.rootItem, 0) : false;
          if (!importedOk) {
            throw new Error("importFiles returned false");
          }
          imported += 1;

          // Find the freshly imported caption item (last child of root).
          var rootChildren = app.project.rootItem.children;
          var captionItem = rootChildren && rootChildren.numItems > 0 ? rootChildren[rootChildren.numItems - 1] : null;
          if (captionItem) {
            var captionDeck = ensureCaptionTrack(sequence);
            if (captionDeck && captionDeck.track && captionDeck.track.overwriteClip) {
              captionDeck.track.overwriteClip(captionItem, secondsToTicks(actions[index].words[0].startSec || 0));
              placed += 1;
              details.push("Caption track V" + (captionDeck.index + 1) + " received " + (actions[index].words || []).length + " word run.");
              continue;
            }
          }
          throw new Error("Caption track or import target was missing");
        } catch (innerError) {
          if (noteOnSequence(sequence, (actions[index].words || [{}])[0].startSec || 0, "Weave Edit captions", "Import the generated .srt at this point. Caption deck insertion failed: " + (innerError.message || String(innerError)))) {
            fallback += 1;
            details.push("Caption fallback: marker added for word run #" + (index + 1) + ".");
          }
        }
      }

      return bridgeOk("Captions: imported " + imported + ", placed " + placed + ", fallback markers " + fallback + ".", details);
    } catch (error) {
      return bridgeFail(error);
    }
  }

  function applyColorMatchFromFile(filePath) {
    try {
      var actions = readBridgeJob(filePath) || [];
      var sequence = resolveActiveSequence();
    if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      var details = [];
      var applied = 0;
      var fallback = 0;

      // Walk every clip on every video track once and apply a gentle Lumetri Basic correction
      // for any placement that matches the action's placementId. We keep this safe because
      // setting values via setValue clamps inside Premiere's range.
      for (var actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        var action = actions[actionIndex];
        var matched = false;
        for (var trackIndex = 0; trackIndex < sequence.videoTracks.numTracks; trackIndex += 1) {
          var track = sequence.videoTracks[trackIndex];
          if (!track || !track.clips) {
            continue;
          }
          for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex += 1) {
            var clip = track.clips[clipIndex];
            if (!clip || String(clip.name || "").indexOf(String(action.placementId || "")) === -1 && String(clip.nodeId || "") !== String(action.placementId || "")) {
              continue;
            }
            var lumetri = findComponentByName(clip, "lumetri");
            if (!lumetri) {
              continue;
            }
            var exposure = findPropertyByName(lumetri, "exposure");
            var contrast = findPropertyByName(lumetri, "contrast");
            var saturation = findPropertyByName(lumetri, "saturation");
            try {
              if (exposure && exposure.setValue) exposure.setValue(0.15, 1);
              if (contrast && contrast.setValue) contrast.setValue(8, 1);
              if (saturation && saturation.setValue) saturation.setValue(110, 1);
              applied += 1;
              matched = true;
            } catch (error) {
              // continue to next clip
            }
          }
        }
        if (!matched && noteOnSequence(sequence, 0, "Weave Edit color match", "Match clip " + action.placementId + " to reference " + (action.referencePath || ""))) {
          fallback += 1;
        }
      }
      details.push("Applied " + applied + " Lumetri adjustments, " + fallback + " marker fallbacks.");
      return bridgeOk("Color match: applied " + applied + ", marker fallbacks " + fallback + ".", details);
    } catch (error) {
      return bridgeFail(error);
    }
  }

  function applyTransitionsFromFile(filePath) {
    try {
      var actions = readBridgeJob(filePath) || [];
      var sequence = resolveActiveSequence();
    if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      var details = [];
      var applied = 0;
      var fallback = 0;

      var qeProject = null;
      try {
        if (typeof qe !== "undefined" && qe && qe.project && qe.project.getActiveSequence) {
          qeProject = qe.project.getActiveSequence();
        }
      } catch (error) {
        qeProject = null;
      }

      for (var actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        var action = actions[actionIndex];
        var matched = false;
        if (qeProject) {
          try {
            // Walk QE video tracks to find the clip with a matching projectItem name fragment.
            for (var qeTrackIndex = 0; qeTrackIndex < qeProject.numVideoTracks; qeTrackIndex += 1) {
              var qeTrack = qeProject.getVideoTrackAt(qeTrackIndex);
              if (!qeTrack || !qeTrack.numItems) {
                continue;
              }
              for (var qeItemIndex = 0; qeItemIndex < qeTrack.numItems; qeItemIndex += 1) {
                var qeItem = qeTrack.getItemAt(qeItemIndex);
                if (!qeItem) {
                  continue;
                }
                if (String(qeItem.name || "").indexOf(String(action.placementId || "")) === -1) {
                  continue;
                }
                qeItem.addTransition(action.style === "dip_to_black" ? "Dip to Black" : "Cross Dissolve", true, "30", "30", "0", false, true);
                applied += 1;
                matched = true;
                break;
              }
              if (matched) {
                break;
              }
            }
          } catch (error) {
            matched = false;
          }
        }
        if (!matched) {
          var atSec = Number(action.atSec || 0);
          if (noteOnSequence(sequence, atSec, "Weave Edit transition", "Add " + (action.style || "cross_dissolve") + " transition (" + (Number(action.durationSec || 0.25) * 1000).toFixed(0) + "ms).")) {
            fallback += 1;
          }
        }
      }
      details.push("Applied " + applied + " transitions, " + fallback + " marker fallbacks.");
      return bridgeOk("Transitions: applied " + applied + ", marker fallbacks " + fallback + ".", details);
    } catch (error) {
      return bridgeFail(error);
    }
  }

  function applyExportFromFile(filePath) {
    try {
      var action = readBridgeJob(filePath) || {};
      var sequence = resolveActiveSequence();
    if (!sequence) {
        return bridgeFail(new Error("Open or activate a sequence first."));
      }
      var preset = String(action.preset || "match_source");
      var projectFolder = app.project.path ? Folder(File(app.project.path).parent.fsName) : Folder.desktop;
      var outputPath = projectFolder.fsName + "/" + (sequence.name || "weave-export") + "-" + preset + ".mp4";

      if (app.encoder && app.encoder.encodeSequence) {
        try {
          // Without an explicit .epr preset path, encodeSequence uses the sequence's default
          // export settings. removeOnComplete=0 keeps the queue entry, immediately=1 starts now.
          app.encoder.encodeSequence(sequence, outputPath, "", 0, 1);
          return bridgeOk("Queued export to " + outputPath + " with preset " + preset + ".", []);
        } catch (error) {
          // fall through to marker fallback
        }
      }

      if (noteOnSequence(sequence, 0, "Weave Edit export", "Open File > Export and use preset " + preset + ". Target path " + outputPath + ".")) {
        return bridgeOk("Export fallback: sequence marker added; AME bridge unavailable.", []);
      }
      return bridgeFail(new Error("AME encoder unavailable and marker fallback failed."));
    } catch (error) {
      return bridgeFail(error);
    }
  }

  return {
    getStatus: getStatus,
    getPlayheadPosition: getPlayheadPosition,
    getTranscriptSegments: getTranscriptSegments,
    getAudioClips: getAudioClips,
    pickFolder: selectFolderPath,
    runJob: function (rawJob) {
      try {
        return runJob(parse(rawJob));
      } catch (error) {
        return fail(error.message || String(error));
      }
    },
    runJobFromFile: runJobFromFile,
    applySilenceCleanupFromFile: applySilenceCleanupFromFile,
    applyShortsMarkersFromFile: applyShortsMarkersFromFile,
    applyAudioPolishFromFile: applyAudioPolishFromFile,
    applyCaptionsFromFile: applyCaptionsFromFile,
    applyColorMatchFromFile: applyColorMatchFromFile,
    applyTransitionsFromFile: applyTransitionsFromFile,
    applyExportFromFile: applyExportFromFile
  };
}());
